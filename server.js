const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const players = {};
let bombPlanted = false;
let teamCounter = 0; // 用於輪流分配隊伍 (Alpha / Bravo)

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    // 自動分配陣營 (輪流分入 Alpha 或 Bravo)
    const assignedTeam = (teamCounter % 2 === 0) ? 'Alpha' : 'Bravo';
    teamCounter++;

    players[socket.id] = {
        x: 0,
        y: 0.9,
        z: 0,
        ry: 0,
        hp: 100,
        team: assignedTeam
    };

    // 告知該玩家他的陣營
    socket.emit('assignTeam', assignedTeam);

    // 傳送當前所有玩家狀態
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('currentPlayers', players);

    // 接收玩家移動
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].ry = data.ry;
            players[socket.id].team = data.team;

            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: data.x,
                y: data.y,
                z: data.z,
                ry: data.ry,
                team: data.team
            });
        }
    });

    // 接收玩家射擊廣播
    socket.on('playerShoot', (data) => {
        socket.broadcast.emit('playerShot', {
            id: socket.id,
            px: data.px, py: data.py, pz: data.pz,
            dx: data.dx, dy: data.dy, dz: data.dz
        });
    });

    // 接收命中判定（伺服器確認友軍免傷與扣血）
    socket.on('playerHit', (targetId) => {
        const attacker = players[socket.id];
        const target = players[targetId];

        // 確保雙方存在且不是同一隊（防範友軍傷害）
        if (attacker && target && attacker.team !== target.team) {
            target.hp -= 25; // 每槍扣 25 血
            if (target.hp <= 0) {
                target.hp = 0;
                io.to(targetId).emit('die');
            } else {
                io.to(targetId).emit('getHit', target.hp);
            }
        }
    });

    // 炸彈安裝 / 拆除狀態同步
    socket.on('toggleBomb', (status) => {
        bombPlanted = status;
        io.emit('bombStatus', bombPlanted);

        if (bombPlanted) {
            // 設置 40 秒後若未拆除則炸彈爆炸（Alpha 隊獲勝或 Bravo 隊獲勝判定）
            setTimeout(() => {
                if (bombPlanted) {
                    io.emit('gameOver', '炸彈爆炸！Bravo 隊（叛軍）獲勝！');
                    bombPlanted = false;
                }
            }, 40000);
        } else {
            io.emit('gameOver', '炸彈已被 Alpha 隊拆除！特種部隊獲勝！');
        }
    });

    // 玩家斷線處理
    socket.on('disconnect', () => {
        console.log(`玩家離線: ${socket.id}`);
        delete players[socket.id];
        io.emit('removePlayer', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器正在運行於 http://localhost:${PORT}`);
});