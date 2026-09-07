const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 託管靜態檔案（假設你的 index.html 放在專案根目錄）
app.use(express.static(__dirname));

let players = {};
let matchTimer = 120;
let matchInterval = null;
let c4Planted = false;

function startServerMatchTimer() {
    if (matchInterval) clearInterval(matchInterval);
    matchTimer = 120;
    c4Planted = false;

    matchInterval = setInterval(() => {
        matchTimer--;
        io.emit('updateMatchTimer', matchTimer);

        if (matchTimer <= 0) {
            clearInterval(matchInterval);
            io.emit('timeOut', { winner: 'blue', reason: '時間耗盡，防守方成功守住' });
        }
    }, 1000);
}

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    // 初始化玩家資料
    players[socket.id] = {
        id: socket.id,
        x: 0,
        y: 0.9,
        z: 0,
        rotY: 0,
        team: 'red',
        status: 'active'
    };

    // 傳送現有玩家給新加入者
    socket.emit('currentPlayers', players);
    
    // 廣播給其他人
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // 如果達到兩人，開始倒數或遊戲
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

    socket.on('shoot', (data) => {
        socket.broadcast.emit('playerShot', { id: socket.id, ...data });
    });

    socket.on('plantC4', () => {
        if (!c4Planted) {
            c4Planted = true;
            io.emit('c4Planted', true);
        }
    });

    socket.on('defuseC4', () => {
        if (c4Planted) {
            c4Planted = false;
            io.emit('c4Defused', true);
        }
    });

    socket.on('disconnect', () => {
        console.log(`玩家斷線: ${socket.id}`);
        delete players[socket.id];
        
        if (Object.keys(players).length < 2) {
            if (matchInterval) clearInterval(matchInterval);
            io.emit('resetToWaiting');
        }

        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在運行於 http://localhost:${PORT}`);
});