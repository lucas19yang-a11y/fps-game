const express=require("express");
const http=require("http");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
app.use(express.static(__dirname));

const PORT=process.env.PORT||3000;
const players=new Map();
let round={state:"WAITING",time:120,c4:false,c4Time:0,score:{red:0,blue:0}};
let timer=null;
let bullets=[];
let countdown=null;

const MAP=73;
const SITE={x:0,y:.9,z:-35,radius:4};
const OBSTACLES=[];
for(let i=0;i<30;i++){ // Must match client layout approximately; server collision is authoritative.
  // Deterministic obstacle layout instead of Math.random so every server restart is reproducible.
  const a=(i*137.508)*Math.PI/180;
  const r=20+(i%6)*8;
  const x=Math.sin(a)*r,z=Math.cos(a)*r*.85;
  if(Math.hypot(x,z)<14){i--;continue}
  OBSTACLES.push({x,z,half:1.5});
}

const WEAPONS={
 ak47:{mag:30,reserve:90,rate:105,damage:34,head:2.0,bulletSpeed:60,maxLife:2},
 g18:{mag:20,reserve:100,rate:85,damage:22,head:1.7,bulletSpeed:65,maxLife:1.7}
};

function dist(a,b){return Math.hypot(a.x-b.x,a.z-b.z)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function collides(x,z,r=.55){
 if(Math.abs(x)>MAP||Math.abs(z)>MAP)return true;
 for(const o of OBSTACLES){
   if(x>o.x-o.half-r&&x<o.x+o.half+r&&z>o.z-o.half-r&&z<o.z+o.half+r)return true;
 }
 return false;
}
function sanitizeName(n){return String(n||"玩家").replace(/[<>]/g,"").slice(0,16)||"玩家"}
function publicPlayers(){const out={};for(const [id,p] of players)out[id]={id,name:p.name,x:p.x,y:p.y,z:p.z,rotY:p.rotY,team:p.team,hp:p.hp,kills:p.kills,status:p.status,weapon:p.weapon};return out}
function emitScore(){io.emit("scoreUpdate",round.score)}
function stopTimers(){if(timer){clearInterval(timer);timer=null}if(countdown){clearInterval(countdown);countdown=null}}
function endRound(winner,reason){
 if(round.state!=="LIVE")return;
 round.state="ROUND_OVER";stopTimers();bullets=[];round.c4=false;round.c4Time=0;
 round.score[winner]++;io.emit("gameOver",{winner,reason});emitScore();
 setTimeout(()=>{if(players.size>=2)startRound();else{round.state="WAITING";io.emit("resetToWaiting")}},5000);
}
function checkElimination(){
 let red=0,blue=0;
 for(const p of players.values())if(p.status==="active"){if(p.team==="red")red++;else if(p.team==="blue")blue++}
 if(red===0&&blue>0)endRound("blue","防守方成功殲滅所有進攻方！");
 else if(blue===0&&red>0)endRound("red","進攻方成功殲滅所有防守方！");
}
function startRound(){
 stopTimers();round.state="LIVE";round.time=120;round.c4=false;round.c4Time=0;bullets=[];
 let i=0;for(const p of players.values()){p.hp=100;p.status="active";p.x=p.team==="red"?-10:10;p.z=p.team==="red"?-10:10;p.y=.9;i++}
 io.emit("restartRound",publicPlayers());io.emit("updateMatchTimer",round.time);
 timer=setInterval(()=>{
   if(round.state!=="LIVE")return;
   round.time--;io.emit("updateMatchTimer",round.time);
   if(round.c4){round.c4Time--;io.emit("c4Tick",round.c4Time);if(round.c4Time<=0)endRound("red","C4 成功引爆！")}
   else if(round.time<=0)endRound("blue","時間耗盡，防守方成功守住");
 },1000);
}
function startCountdown(){
 stopTimers();round.state="COUNTDOWN";let n=3;io.emit("startCountdown",n);
 countdown=setInterval(()=>{n--;io.emit("updateCountdown",n);if(n<=0){clearInterval(countdown);countdown=null;io.emit("gameStarted");startRound()}},1000);
}
function maybeStart(){if(players.size>=2&&round.state==="WAITING")startCountdown()}

setInterval(()=>{
 if(round.state!=="LIVE")return;
 const dt=.033,speed=60;
 for(let i=bullets.length-1;i>=0;i--){
  const b=bullets[i];b.x+=b.vx*speed*dt;b.y+=b.vy*speed*dt;b.z+=b.vz*speed*dt;b.life-=dt;
  if(b.life<=0||Math.abs(b.x)>MAP+10||Math.abs(b.z)>MAP+10){bullets.splice(i,1);continue}
  let hit=false;
  // World collision
  if(collides(b.x,b.z,.08)){bullets.splice(i,1);continue}
  for(const [id,t] of players){
   if(id===b.ownerId||t.status!=="active")continue;
   const dx=t.x-b.x,dz=t.z-b.z,dy=(t.y+.9)-b.y;
   if(Math.abs(dx)<.65&&Math.abs(dz)<.65&&Math.abs(dy)<1.0){
    const w=WEAPONS[b.weapon]||WEAPONS.ak47;
    const head=b.y>(t.y+1.45);
    const damage=Math.round(w.damage*(head?w.head:1));
    t.hp=Math.max(0,t.hp-damage);io.to(id).emit("damaged",t.hp);io.to(b.ownerId).emit("hitConfirmed",{damage,head});
    hit=true;
    if(t.hp<=0){t.status="dead";const killer=players.get(b.ownerId);if(killer){killer.kills++;io.to(b.ownerId).emit("updateKills",killer.kills)}io.emit("killFeed",{killer:killer?.name||"玩家",victim:t.name,head});checkElimination()}
    break;
   }
  }
  if(hit)bullets.splice(i,1);
 }
 io.emit("updateBullets",bullets);
},33);

io.on("connection",socket=>{
 const idx=players.size;
 players.set(socket.id,{id:socket.id,name:"玩家",team:idx%2===0?"red":"blue",weapon:"ak47",x:idx%2===0?-10:10,y:.9,z:idx%2===0?-10:10,rotY:0,hp:100,kills:0,status:"active",lastMove:0,lastShot:0});
 socket.emit("currentPlayers",publicPlayers());socket.broadcast.emit("newPlayer",players.get(socket.id));
 socket.on("joinGame",data=>{const p=players.get(socket.id);if(!p)return;p.name=sanitizeName(data.name);p.team=data.team==="blue"?"blue":"red";p.weapon=WEAPONS[data.weapon]?data.weapon:"ak47";});
 socket.on("playerMovement",m=>{
   const p=players.get(socket.id);if(!p||p.status!=="active"||round.state!=="LIVE")return;
   const now=Date.now();if(now-p.lastMove<40)return;
   const nx=Number(m.x),ny=Number(m.y),nz=Number(m.z),nr=Number(m.rotY);
   if(!Number.isFinite(nx)||!Number.isFinite(ny)||!Number.isFinite(nz)||!Number.isFinite(nr))return;
   // Validate speed and collision. Client sends absolute coordinates; server rejects impossible jumps.
   const dt=Math.max(.04,Math.min(.25,(now-p.lastMove)/1000));
   const maxStep=18*dt+.9;
   const d=Math.hypot(nx-p.x,nz-p.z);
   if(d>maxStep||collides(nx,nz))return;
   p.x=clamp(nx,-MAP,MAP);p.z=clamp(nz,-MAP,MAP);p.y=clamp(ny,.9,3);p.rotY=nr;p.lastMove=now;
   socket.broadcast.emit("playerMoved",p);
 });
 socket.on("shoot",d=>{
   const p=players.get(socket.id);if(!p||p.status!=="active"||round.state!=="LIVE")return;
   const w=WEAPONS[p.weapon];const now=Date.now();if(now-p.lastShot<w.rate*.85)return;
   const x=Number(d.x),y=Number(d.y),z=Number(d.z),dx=Number(d.dirX),dy=Number(d.dirY),dz=Number(d.dirZ);
   if(![x,y,z,dx,dy,dz].every(Number.isFinite))return;
   const len=Math.hypot(dx,dy,dz);if(len<.9||len>1.1)return;
   // Muzzle must be near player; direction is normalized server-side.
   if(Math.hypot(x-p.x,y-(p.y+.7),z-p.z)>3)return;
   const vx=dx/len,vy=dy/len,vz=dz/len;
   bullets.push({ownerId:socket.id,weapon:p.weapon,x,y,z,vx,vy,vz,life:w.maxLife});
   p.lastShot=now;
 });
 socket.on("plantC4",()=>{
   const p=players.get(socket.id);if(!p||round.state!=="LIVE"||p.team!=="red"||p.status!=="active"||round.c4)return;
   if(dist(p,SITE)>SITE.radius)return;round.c4=true;round.c4Time=40;io.emit("c4Planted",true);io.emit("c4Tick",40);
 });
 socket.on("defuseC4",()=>{
   const p=players.get(socket.id);if(!p||round.state!=="LIVE"||p.team!=="blue"||p.status!=="active"||!round.c4)return;
   if(dist(p,SITE)>SITE.radius)return;round.c4=false;round.c4Time=0;io.emit("c4Defused",true);io.emit("c4Tick",0);
 });
 socket.on("disconnect",()=>{
   players.delete(socket.id);io.emit("playerDisconnected",socket.id);
   if(players.size<2){stopTimers();bullets=[];round.state="WAITING";round.c4=false;io.emit("resetToWaiting")}
   else maybeStart();
 });
 maybeStart();
});

server.listen(PORT,()=>console.log(`FPS server running on ${PORT}`));