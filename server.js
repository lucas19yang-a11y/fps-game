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

function startServerMatchTimer() {
    if (matchInterval) clearInterval(matchInterval);
    matchTimer = 120;
    c4Planted = false;
    if (c4Timer) clearTimeout(c4Timer);

    matchInterval = setInterval(() => {
        matchTimer--;
        io.emit('updateMatchTimer', matchTimer);

        if (matchTimer <= 0) {
            clearInterval(matchInterval);
            if (c4Timer) clearTimeout(c4Timer);
            io.emit('gameOver', { winner: 'blue', reason: '時間耗盡，防守方成功守住' });
            resetRound();
        }
    }, 1000);
}

function resetRound() {
    if (matchInterval) clearInterval(matchInterval);
    if (c4Timer) clearTimeout(c4Timer);
    c4Planted = false;
    for (let id in players) {
        players[id].hp = 100;
        players[id].status = 'active';
    }
}

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    players[socket.id] = {
        id: socket.id,
        x: 0,
        y: 0.9,
        z: 0,
        rotY: 0,
        team: 'red',
        hp: 100,
        kills: 0,
        status: 'active'
    };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', players[socket.id]);

    if (Object.keys(players).length === 2) {
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

    socket.on('joinGame', (data) => {
        if (players[socket.id]) {
            players[socket.id].name = data.name;
            players[socket.id].team = data.team;
            players[socket.id].weapon = data.weapon;
        }
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotY = movementData.rotY;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // 處理開槍與命中判定
    socket.on('shoot', (data) => {
        socket.broadcast.emit('playerShot', { id: socket.id, ...data });

        for (let id in players) {
            if (id !== socket.id && players[id].status === 'active') {
                const target = players[id];
                const dist = Math.hypot(target.x - data.x, target.z - data.z);
                
                // 30公尺內命中扣血 (每發扣 25 血，四槍擊殺)
                if (dist < 30) {
                    target.hp -= 25;
                    io.to(id).emit('damaged', target.hp);

                    if (target.hp <= 0) {
                        target.hp = 0;
                        target.status = 'dead';
                        if (players[socket.id]) {
                            players[socket.id].kills += 1;
                            io.to(socket.id).emit('updateKills', players[socket.id].kills);
                        }
                        checkTeamElimination();
                    }
                    break;
                }
            }
        }
    });

    socket.on('plantC4', () => {
        if (!c4Planted) {
            c4Planted = true;
            io.emit('c4Planted', true);

            let c4TimeLeft = 40;
            c4Timer = setInterval(() => {
                c4TimeLeft--;
                if (c4TimeLeft <= 0) {
                    clearInterval(c4Timer);
                    if (matchInterval) clearInterval(matchInterval);
                    io.emit('gameOver', { winner: 'red', reason: 'C4 成功引爆！' });
                    resetRound();
                }
            }, 1000);
        }
    });

    socket.on('defuseC4', () => {
        if (c4Planted) {
            c4Planted = false;
            if (c4Timer) clearInterval(c4Timer);
            io.emit('c4Defused', true);
        }
    });

    socket.on('disconnect', () => {
        console.log(`玩家斷線: ${socket.id}`);
        delete players[socket.id];
        if (Object.keys(players).length < 2) {
            resetRound();
            io.emit('resetToWaiting');
        }
        io.emit('playerDisconnected', socket.id);
    });
});

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
        resetRound();
        io.emit('gameOver', { winner: 'blue', reason: '防守方成功殲滅所有進攻方！' });
    } else if (blueAlive === 0 && Object.keys(players).length >= 2) {
        resetRound();
        io.emit('gameOver', { winner: 'red', reason: '進攻方成功殲滅所有防守方！' });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在運行於 http://localhost:${PORT}`);
});