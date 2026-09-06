const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 設定當前根目錄為靜態資源資料夾
app.use(express.static(path.join(__dirname)));

// 根路徑直接對應到 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const players = {};
let c4State = { planted: false, timer: 30, site: { x: 0, z: -25 } };

setInterval(() => {
    if (c4State.planted) {
        c4State.timer -= 1;
        if (c4State.timer <= 0) {
            io.emit('gameOver', { reason: 'c4_explosion', winner: 'red' });
            c4State.planted = false;
        }
    }
}, 1000);

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    socket.on('joinGame', (data) => {
        players[socket.id] = {
            id: socket.id,
            name: data.name || `玩家_${socket.id.substring(0, 4)}`,
            team: data.team || 'red',
            weapon: data.weapon || 'ak47',
            x: 0, y: 0.9, z: 0,
            rotY: 0,
            hp: 100
        };

        socket.emit('currentPlayers', players);
        socket.emit('c4Status', c4State);
        socket.broadcast.emit('newPlayer', players[socket.id]);
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

    socket.on('shoot', (shootData) => {
        socket.broadcast.emit('playerShot', { id: socket.id, ...shootData });
    });

    socket.on('plantC4', () => {
        if (!c4State.planted) {
            c4State.planted = true;
            c4State.timer = 30;
            io.emit('c4Planted', c4State);
        }
    });

    socket.on('defuseC4', () => {
        if (c4State.planted) {
            c4State.planted = false;
            io.emit('c4Defused');
        }
    });

    socket.on('disconnect', () => {
        console.log(`玩家離開: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在運行於 http://localhost:${PORT}`);
});