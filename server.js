const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let players = {};
let matchTimer = 120;
let matchInterval = null;
let c4Planted = false;
let c4Timer = null;
let isMatchRunning = false;
let bullets = [];

function startServerMatchTimer() {
    if (matchInterval) clearInterval(matchInterval);
    matchTimer = 120;
    c4Planted = false;
    if (c4Timer) clearTimeout(c4Timer);
    isMatchRunning = true;
    bullets = [];

    matchInterval = setInterval(() => {
        matchTimer--;
        io.emit('updateMatchTimer', matchTimer);

        if (matchTimer <= 0) {
            endRound('blue', '時間耗盡，防守方成功守住');
        }
    }, 1000);
}

function endRound(winner, reason) {
    if (!isMatchRunning) return;
    isMatchRunning = false;

    if (matchInterval) clearInterval(matchInterval);
    if (c4Timer) clearTimeout(c4Timer);
    c4Planted = false;
    bullets = [];

    io.emit('gameOver', { winner, reason });

    setTimeout(() => {
        if (Object.keys(players).length >= 2) {
            resetAndStartNewRound();
        } else {
            io.emit('resetToWaiting');
        }
    }, 5000);
}

function resetAndStartNewRound() {
    let index = 0;
    for (let id in players) {
        players[id].hp = 100;
        players[id].status = 'active';
        players[id].x = (index === 0) ? -10 : 10;
        players[id].z = (index === 0) ? -10 : 10;
        players[id].y = 0.9;
        index++;
    }

    io.emit('restartRound', players);
    startServerMatchTimer();
}

// 伺服器端實體子彈更新與碰撞判定
setInterval(() => {
    if (!isMatchRunning) return;

    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        const dt = 0.033;
        
        // 子彈飛行速度
        const bulletSpeed = 60.0;
        b.x += b.vx * bulletSpeed * dt;
        b.y += b.vy * bulletSpeed * dt;
        b.z += b.vz * bulletSpeed * dt;
        
        b.life -= dt;

        if (b.life <= 0) {
            bullets.splice(i, 1);
            continue;
        }

        let hit = false;
        for (let id in players) {
            if (id !== b.ownerId && players[id].status === 'active') {
                const target = players[id];
                const dx = Math.abs(target.x - b.x);
                const dy = Math.abs((target.y + 0.9) - b.y);
                const dz = Math.abs(target.z - b.z);

                // 判定子彈是否打中玩家
                if (dx < 0.8 && dy < 1.2 && dz < 0.8) {
                    hit = true;
                    target.hp -= 25;
                    io.to(id).emit('damaged', target.hp);

                    if (target.hp <= 0) {
                        target.hp = 0;
                        target.status = 'dead';
                        if (players[b.ownerId]) {
                            players[b.ownerId].kills += 1;
                            io.to(b.ownerId).emit('updateKills', players[b.ownerId].kills);
                        }
                        checkTeamElimination();
                    }
                    break;
                }
            }
        }

        if (hit) {
            bullets.splice(i, 1);
        }
    }

    io.emit('updateBullets', bullets);
}, 33);

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    players[socket.id] = {
        id: socket.id,
        x: (Object.keys(players).length % 2 === 0) ? -10 : 10,
        y: 0.9,
        z: (Object.keys(players).length % 2 === 0) ? -10 : 10,
        rotY: 0,
        team: 'red',
        hp: 100,
        kills: 0,
        status: 'active'
    };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);

    if (Object.keys(players).length === 2 && !isMatchRunning) {
        startCountdownAndGame();
    }

    socket.on('joinGame', (data) => {
        if (players[socket.id]) {
            players[socket.id].name = data.name;
            players[socket.id].team = data.team;
            players[socket.id].weapon = data.weapon;
        }
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id] && players[socket.id].status === 'active') {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotY = movementData.rotY;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // 接收從槍口射出的實體子彈
    socket.on('shoot', (data) => {
        if (!isMatchRunning) return;

        bullets.push({
            ownerId: socket.id,
            x: data.x,
            y: data.y,
            z: data.z,
            vx: data.dirX,
            vy: data.dirY,
            vz: data.dirZ,
            life: 2.0
        });
    });

    socket.on('plantC4', () => {
        if (!isMatchRunning || c4Planted) return;
        c4Planted = true;
        io.emit('c4Planted', true);

        let c4TimeLeft = 40;
        c4Timer = setInterval(() => {
            c4TimeLeft--;
            if (c4TimeLeft <= 0) {
                clearInterval(c4Timer);
                endRound('red', 'C4 成功引爆！');
            }
        }, 1000);
    });

    socket.on('defuseC4', () => {
        if (!isMatchRunning || !c4Planted) return;
        c4Planted = false;
        if (c4Timer) clearInterval(c4Timer);
        io.emit('c4Defused', true);
    });

    socket.on('disconnect', () => {
        console.log(`玩家斷線: ${socket.id}`);
        delete players[socket.id];
        
        if (Object.keys(players).length < 2) {
            if (matchInterval) clearInterval(matchInterval);
            if (c4Timer) clearTimeout(c4Timer);
            isMatchRunning = false;
            io.emit('resetToWaiting');
        }
        io.emit('playerDisconnected', socket.id);
    });
});

function startCountdownAndGame() {
    io.emit('startCountdown', 3);
    let count = 3;
    const countdownInterval = setInterval(() => {
        count--;
        io.emit('updateCountdown', count);
        if (count <= 0) {
            clearInterval(countdownInterval);
            io.emit('gameStarted');
            startServerMatchTimer();
        }
    }, 1000);
}

function checkTeamElimination() {
    let redAlive = 0;
    let blueAlive = 0;

    for (let id in players) {
        if (players[id].status === 'active') {
            if (players[id].team === 'red') redAlive++;
            if (players[id].team === 'blue') blueAlive++;
        }
    }

    if (redAlive === 0 && Object.keys(players).length >= 2) {
        endRound('blue', '防守方成功殲滅所有進攻方！');
    } else if (blueAlive === 0 && Object.keys(players).length >= 2) {
        endRound('red', '進攻方成功殲滅所有防守方！');
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在運行於 http://localhost:${PORT}`);
});