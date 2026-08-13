const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 讓伺服器自動託管同一資料夾下的靜態網頁檔案（index.html）
app.use(express.static(__dirname));

// 儲存所有線上玩家的資料
const players = {};
let bombPlanted = false;

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    // 初始化新玩家
    players[socket.id] = {
        x: (Math.random() - 0.5) * 8,
        y: 0.9,
        z: (Math.random() - 0.5) * 8,
        ry: 0,
        hp: 100
    };

    // 告訴大家有新玩家加入，並把目前炸彈狀態同步給他
    io.emit('currentPlayers', players);
    socket.emit('bombStatus', bombPlanted);

    // 接收玩家移動資料並廣播
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].ry = data.ry;
            socket.broadcast.emit('playerMoved', { id: socket.id, ...players[socket.id] });
        }
    });

    // 接收玩家開火事件
    socket.on('playerShoot', (data) => {
        socket.broadcast.emit('playerShot', { id: socket.id, ...data });
    });

    // 接收子彈擊中判定
    socket.on('playerHit', (targetId) => {
        if (players[targetId]) {
            players[targetId].hp -= 20;
            io.to(targetId).emit('getHit', players[targetId].hp);
            if (players[targetId].hp <= 0) {
                io.to(targetId).emit('die');
            }
        }
    });

    // 接收炸彈安裝/拆除事件
    socket.on('toggleBomb', (status) => {
        bombPlanted = status;
        io.emit('bombStatus', bombPlanted);
    });

    // 玩家離線
    socket.on('disconnect', () => {
        console.log(`玩家離線: ${socket.id}`);
        delete players[socket.id];
        io.emit('removePlayer', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 多人伺服器已啟動！請在瀏覽器輸入: http://localhost:${PORT}`);
});