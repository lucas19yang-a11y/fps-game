const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const players = {};
let gameState = 'waiting'; // 'waiting' (等待第二人), 'countdown' (倒數3秒), 'playing' (對局中)
let countdownTimer = 3;
let c4State = { planted: false, timer: 30, site: { x: 0, z: -25 } };

// 遊戲大廳狀態主迴圈
setInterval(() => {
    if (gameState === 'countdown') {
        countdownTimer -= 1;
        io.emit('updateCountdown', countdownTimer);
        if (countdownTimer <= 0) {
            gameState = 'playing';
            io.emit('gameStarted');
        }
    }
}, 1000);

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    socket.on('joinGame', (data) => {
        // 判定玩家身份：如果遊戲已經在進行或倒數中，新玩家就是「等待下一局 (spectating)」
        let status = 'active';
        if (gameState === 'playing' || gameState === 'countdown') {
            status = 'spectating';
        }

        players[socket.id] = {
            id: socket.id,
            name: data.name || `玩家_${socket.id.substring(0, 4)}`,
            team: data.team || 'red',
            weapon: data.weapon || 'ak47',
            x: 0, y: 0.9, z: 0,
            rotY: 0,
            hp: 100,
            status: status
        };

        // 回傳目前玩家列表與遊戲狀態給自己
        socket.emit('currentPlayers', players);
        socket.emit('gameState', { gameState, countdownTimer });
        socket.emit('c4Status', c4State);

        // 廣播給其他人
        socket.broadcast.emit('newPlayer', players[socket.id]);

        // 如果原本在等待，且這是第二個玩家加入，觸發 3 秒倒數！
        if (gameState === 'waiting' && Object.keys(players).length >= 2) {
            gameState = 'countdown';
            countdownTimer = 3;
            io.emit('startCountdown', countdownTimer);
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

    socket.on('shoot', (shootData) => {
        if (players[socket.id] && players[socket.id].status === 'active') {
            socket.broadcast.emit('playerShot', { id: socket.id, ...shootData });
        }
    });

    socket.on('plantC4', () => {
        if (players[socket.id]?.status === 'active' && !c4State.planted) {
            c4State.planted = true;
            c4State.timer = 30;
            io.emit('c4Planted', c4State);
        }
    });

    socket.on('defuseC4', () => {
        if (players[socket.id]?.status === 'active' && c4State.planted) {
            c4State.planted = false;
            io.emit('c4Defused');
        }
    });

    socket.on('disconnect', () => {
        console.log(`玩家離開: ${socket.id}`);
        delete players[socket.id];
        socket.broadcast.emit('playerDisconnected', socket.id);

        // 如果場上只剩 1 人或 0 人，重置回等待狀態
        if (Object.keys(players).length < 2) {
            gameState = 'waiting';
            io.emit('resetToWaiting');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在運行於 http://localhost:${PORT}`);
});