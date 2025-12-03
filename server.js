const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const TILE_SIZE = 40;
const COLS = 19; 
const ROWS = 15;
const TILE = { EMPTY: 0, HARD: 1, SOFT: 2 };
const ITEM = { BLAST: 1, SPEED: 2 };

let rooms = {};

function createMap() {
    let map = [];
    for (let r = 0; r < ROWS; r++) {
        let row = [];
        for (let c = 0; c < COLS; c++) {
            // Bordes y pilares fijos
            if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 || (r % 2 === 0 && c % 2 === 0)) {
                row.push(TILE.HARD);
            } else {
                // Generación aleatoria
                row.push(Math.random() < 0.5 ? TILE.SOFT : TILE.EMPTY);
            }
        }
        map.push(row);
    }

    // FORZAR LIMPIEZA DE ZONAS DE SPAWN (Las 4 esquinas)
    // Esquina Superior Izquierda (Jugador 1)
    map[1][1] = TILE.EMPTY; map[1][2] = TILE.EMPTY; map[2][1] = TILE.EMPTY;
    // Esquina Inferior Derecha (Jugador 2)
    map[ROWS-2][COLS-2] = TILE.EMPTY; map[ROWS-2][COLS-3] = TILE.EMPTY; map[ROWS-3][COLS-2] = TILE.EMPTY;
    // Esquina Superior Derecha (Jugador 3)
    map[1][COLS-2] = TILE.EMPTY; map[1][COLS-3] = TILE.EMPTY; map[2][COLS-2] = TILE.EMPTY;
    // Esquina Inferior Izquierda (Jugador 4)
    map[ROWS-2][1] = TILE.EMPTY; map[ROWS-2][2] = TILE.EMPTY; map[ROWS-3][1] = TILE.EMPTY;

    return map;
}

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('joinLobby', (username) => {
        socket.username = username;
        socket.emit('roomList', rooms);
    });

    // RECONEXIÓN
    socket.on('rejoinGame', (data) => {
        const { roomName, username } = data;
        const room = rooms[roomName];
        
        if (room && room.started) {
            // Buscar si el jugador existe en la sala (por nombre)
            const playerKey = Object.keys(room.players).find(key => room.players[key].name === username && !room.players[key].isBot);
            
            if (playerKey) {
                // Recuperar jugador
                const player = room.players[playerKey];
                // Actualizar ID del socket en el objeto jugador y en el mapa de la sala
                delete room.players[playerKey]; // Borrar referencia vieja
                room.players[socket.id] = player; // Asignar nueva referencia
                player.id = socket.id; // Actualizar ID interno
                
                socket.username = username;
                socket.roomId = roomName;
                socket.join(roomName);
                
                socket.emit('gameStarted', room); // Re-enviar estado inicial
                console.log(`Usuario ${username} reconectado a ${roomName}`);
            } else {
                socket.emit('error', 'No se pudo recuperar la sesión.');
            }
        }
    });

    socket.on('createRoom', (data) => {
        const { name, difficulty } = data;
        if (rooms[name]) return;
        rooms[name] = {
            id: name,
            difficulty: difficulty || 'medium',
            players: {},
            map: createMap(),
            bombs: [],
            items: [],
            started: false,
            owner: socket.id
        };
        joinRoom(socket, name);
    });

    socket.on('joinRoom', (roomName) => {
        joinRoom(socket, roomName);
    });

    socket.on('startGame', () => {
        const room = getRoom(socket);
        if (room && room.owner === socket.id && !room.started) {
            room.started = true;
            const playerCount = Object.keys(room.players).length;
            if (playerCount < 4) {
                for (let i = playerCount; i < 4; i++) {
                    const botId = `bot_${Date.now()}_${i}`;
                    room.players[botId] = createPlayer(botId, true, i, room.difficulty);
                }
            }
            io.to(room.id).emit('gameStarted', room);
            startGameLoop(room.id);
        }
    });

    socket.on('input', (data) => {
        const room = getRoom(socket);
        if (room && room.started && room.players[socket.id]) {
            const p = room.players[socket.id];
            if (p.dead) return;
            p.keys = data; 
            if (data.space) placeBomb(room, p);
        }
    });

    socket.on('chatMsg', (msg) => {
        const room = getRoom(socket);
        if (room) {
            const fullMsg = { user: socket.username, text: msg };
            io.to(room.id).emit('chatUpdate', fullMsg);
        }
    });

    socket.on('disconnect', () => {
        const room = getRoom(socket);
        if (room) {
            // Si la partida NO ha empezado, borramos al jugador
            if (!room.started) {
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) {
                    delete rooms[room.id]; 
                } else if (room.owner === socket.id) {
                    room.owner = Object.keys(room.players)[0]; 
                }
                io.emit('roomList', rooms);
            } else {
                // Si la partida YA empezó, NO borramos al jugador inmediatamente
                // para permitir reconexión. (Se podría añadir un timeout aquí para limpiar)
                console.log(`Jugador ${socket.username} desconectado de partida en curso.`);
            }
        }
    });
});

function joinRoom(socket, roomName) {
    const room = rooms[roomName];
    if (!room || room.started || Object.keys(room.players).length >= 4) return;

    socket.join(roomName);
    socket.roomId = roomName;
    
    const idx = Object.keys(room.players).length;
    room.players[socket.id] = createPlayer(socket.username, false, idx, room.difficulty);

    io.to(roomName).emit('updateLobby', room);
    io.emit('roomList', rooms);
}

function createPlayer(name, isBot, idx, difficulty) {
    const positions = [
        {x: 1, y: 1}, {x: COLS-2, y: ROWS-2}, {x: COLS-2, y: 1}, {x: 1, y: ROWS-2}
    ];
    const colors = ["#3498db", "#e74c3c", "#f1c40f", "#9b59b6"];
    
    return {
        id: isBot ? `bot_${idx}` : null, // ID temporal para bots
        name: isBot ? `BOT (${difficulty})` : name,
        gx: positions[idx].x,
        gy: positions[idx].y,
        x: positions[idx].x * TILE_SIZE,
        y: positions[idx].y * TILE_SIZE,
        color: colors[idx],
        isBot: isBot,
        difficulty: difficulty,
        lives: 3,
        speed: 4, 
        blastRange: 1,
        keys: {},
        dead: false,
        invincible: 0,
        facing: {x:0, y:1},
        moveTimer: 0,
        currentDir: null
    };
}

function getRoom(socket) {
    return rooms[socket.roomId];
}

function placeBomb(room, p) {
    // Verificar si ya hay bomba en esa casilla
    if (room.bombs.some(b => b.gx === p.gx && b.gy === p.gy)) return;
    
    // Usar el ID del socket o el ID del bot
    const ownerId = p.isBot ? p.id : Object.keys(room.players).find(key => room.players[key] === p);
    room.bombs.push({
        gx: p.gx, gy: p.gy,
        timer: 180, 
        ownerId: ownerId, 
        range: p.blastRange,
        passable: true // NUEVO: Permite caminar sobre ella al principio
    });
}

function startGameLoop(roomId) {
    const interval = setInterval(() => {
        const room = rooms[roomId];
        if (!room) { clearInterval(interval); return; }

        // 1. Actualizar Jugadores
        Object.keys(room.players).forEach(key => {
            const p = room.players[key];
            // Asegurar que p.id esté definido para colisiones
            if (!p.isBot) p.id = key; 

            if (p.dead) return;
            if (p.invincible > 0) p.invincible--;

            if (p.isBot) updateBotAI(room, p);

            let dx = 0, dy = 0;
            if (p.keys.up) dy = -p.speed;
            if (p.keys.down) dy = p.speed;
            if (p.keys.left) dx = -p.speed;
            if (p.keys.right) dx = p.speed;

            if (dx !== 0 || dy !== 0) {
                const margin = 10;
                const nx = p.x + dx;
                const ny = p.y + dy;
                
                // Pasamos el ID del jugador a checkCollision para verificar bombas propias
                if (!checkCollision(room, nx + margin, ny + margin, p.id) &&
                    !checkCollision(room, nx + TILE_SIZE - margin, ny + margin, p.id) &&
                    !checkCollision(room, nx + margin, ny + TILE_SIZE - margin, p.id) &&
                    !checkCollision(room, nx + TILE_SIZE - margin, ny + TILE_SIZE - margin, p.id)) {
                    p.x = nx;
                    p.y = ny;
                    if(dx!==0) p.facing = {x: Math.sign(dx), y:0};
                    if(dy!==0) p.facing = {x:0, y: Math.sign(dy)};
                }
                
                p.gx = Math.floor((p.x + TILE_SIZE/2) / TILE_SIZE);
                p.gy = Math.floor((p.y + TILE_SIZE/2) / TILE_SIZE);

                // Recoger items
                if (room.items) {
                    const itemIdx = room.items.findIndex(i => i.gx === p.gx && i.gy === p.gy);
                    if (itemIdx !== -1) {
                        const item = room.items[itemIdx];
                        if (item.type === ITEM.BLAST) {
                            p.blastRange++;
                        } else if (item.type === ITEM.SPEED) {
                            p.speed = Math.min(p.speed + 1, 8); // Max speed 8
                        }
                        room.items.splice(itemIdx, 1);
                    }
                }
            }
        });

        // 2. Actualizar Bombas
        room.bombs.forEach((b, idx) => {
            b.timer--;
            
            // Lógica de "Passable": Si el dueño se aleja, deja de ser atravesable
            if (b.passable) {
                // Buscar al dueño en players
                let owner = null;
                if (b.ownerId.startsWith('bot_')) {
                    // Buscar bot por ID interno
                    owner = Object.values(room.players).find(pl => pl.id === b.ownerId);
                } else {
                    owner = room.players[b.ownerId];
                }

                if (owner) {
                    const dist = Math.abs(owner.x - b.gx * TILE_SIZE) + Math.abs(owner.y - b.gy * TILE_SIZE);
                    if (dist > TILE_SIZE) {
                        b.passable = false;
                    }
                } else {
                    b.passable = false; // Si el dueño se fue, ya no es atravesable
                }
            }

            if (b.timer <= 0) {
                room.bombs.splice(idx, 1);
                explodeBomb(room, b);
            }
        });

        io.to(roomId).emit('gameState', {
            players: room.players,
            bombs: room.bombs,
            items: room.items,
            map: room.map 
        });

        // 3. Verificar Fin del Juego
        const aliveHumans = Object.values(room.players).filter(p => !p.dead && !p.isBot);
        const aliveTotal = Object.values(room.players).filter(p => !p.dead);

        // Si no quedan humanos vivos, termina (aunque queden bots)
        if (aliveHumans.length === 0) {
            io.to(roomId).emit('gameOver', "IA (Todos los humanos murieron)");
            clearInterval(interval);
            delete rooms[roomId];
        } 
        // Si solo queda 1 jugador (humano o bot) y había más de 1 al principio
        else if (aliveTotal.length <= 1 && Object.keys(room.players).length > 1) {
            io.to(roomId).emit('gameOver', aliveTotal.length > 0 ? aliveTotal[0].name : "Nadie");
            clearInterval(interval);
            delete rooms[roomId];
        }

    }, 1000 / 60);
}

function checkCollision(room, px, py, playerId) {
    const c = Math.floor(px / TILE_SIZE);
    const r = Math.floor(py / TILE_SIZE);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
    if (room.map[r][c] !== TILE.EMPTY) return true;
    
    // Verificar bombas
    const bomb = room.bombs.find(b => b.gx === c && b.gy === r);
    if (bomb) {
        // Si la bomba es atravesable Y soy el dueño, NO hay colisión
        if (bomb.passable && bomb.ownerId === playerId) {
            return false;
        }
        return true; // Colisión normal
    }
    return false;
}

function explodeBomb(room, b) {
    const dirs = [{x:0,y:0}, {x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
    let explosionData = [];

    dirs.forEach(d => {
        for(let i=0; i<=b.range; i++) {
            if (d.x===0 && d.y===0 && i>0) continue;
            const tx = b.gx + (d.x * i);
            const ty = b.gy + (d.y * i);
            
            if (ty < 0 || ty >= ROWS || tx < 0 || tx >= COLS) break;
            if (room.map[ty][tx] === TILE.HARD) break;

            explosionData.push({x: tx, y: ty});

            Object.values(room.players).forEach(p => {
                if (!p.dead && Math.abs(p.gx - tx) < 0.5 && Math.abs(p.gy - ty) < 0.5) {
                    if (p.invincible <= 0) {
                        p.lives--;
                        p.invincible = 120;
                        if (p.lives <= 0) p.dead = true;
                    }
                }
            });

            if (room.map[ty][tx] === TILE.SOFT) {
                room.map[ty][tx] = TILE.EMPTY;
                // 30% chance to spawn item
                if (Math.random() < 0.3) {
                    const type = Math.random() < 0.5 ? ITEM.BLAST : ITEM.SPEED;
                    room.items.push({ gx: tx, gy: ty, type: type });
                }
                break;
            }
        }
    });
    io.to(room.id).emit('explosion', explosionData);
}

function updateBotAI(room, bot) {
    if (bot.moveTimer > 0) { bot.moveTimer--; return; }

    const centerX = bot.gx * TILE_SIZE;
    const centerY = bot.gy * TILE_SIZE;
    const dist = Math.abs(bot.x - centerX) + Math.abs(bot.y - centerY);

    if (bot.currentDir && dist > 8) return; 

    bot.x = centerX; bot.y = centerY; 

    // 1. Analizar Entorno
    const danger = isSpotDangerous(room, bot.gx, bot.gy);
    const validMoves = getBotValidMoves(room, bot);
    
    let bestDir = null;

    if (danger) {
        // MODO HUIR: Buscar casilla segura
        const safeMoves = validMoves.filter(d => !isSpotDangerous(room, bot.gx + d.x, bot.gy + d.y));
        
        if (safeMoves.length > 0) {
            bestDir = safeMoves[Math.floor(Math.random() * safeMoves.length)];
        } else {
            if (validMoves.length > 0) bestDir = validMoves[Math.floor(Math.random() * validMoves.length)];
        }
    } else {
        // MODO ATAQUE / FARMEO
        const adj = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
        let targets = 0;
        
        // Buscar bloques blandos adyacentes
        adj.forEach(d => {
            const r = bot.gy + d.y;
            const c = bot.gx + d.x;
            if (r>=0 && r<ROWS && c>=0 && c<COLS && room.map[r][c] === TILE.SOFT) targets++;
        });

        // Buscar jugadores cercanos
        if (bot.difficulty !== 'easy') {
            adj.forEach(d => {
                for(let i=1; i<=3; i++) {
                    const r = bot.gy + (d.y*i);
                    const c = bot.gx + (d.x*i);
                    if (r<0 || r>=ROWS || c<0 || c>=COLS || room.map[r][c] !== TILE.EMPTY) break;
                    const targetPlayer = Object.values(room.players).find(p => !p.dead && p.id !== bot.id && p.gx === c && p.gy === r);
                    if (targetPlayer) targets++;
                }
            });
        }

        let wantBomb = targets > 0;
        let bombChance = 0.1; 
        if (bot.difficulty === 'medium') bombChance = 0.4;
        if (bot.difficulty === 'hard') bombChance = 0.8;

        if (wantBomb && Math.random() < bombChance) {
            // Solo poner bomba si hay ruta de escape
            if (validMoves.length > 0) {
                placeBomb(room, bot);
                bot.moveTimer = 0; 
                return; 
            }
        }

        if (validMoves.length > 0) {
            const keepDir = bot.currentDir && validMoves.some(d => d.x === bot.currentDir.x && d.y === bot.currentDir.y);
            if (keepDir && Math.random() < 0.7) {
                bestDir = bot.currentDir;
            } else {
                bestDir = validMoves[Math.floor(Math.random() * validMoves.length)];
            }
        }
    }

    if (bestDir) {
        bot.keys = { up: bestDir.y<0, down: bestDir.y>0, left: bestDir.x<0, right: bestDir.x>0 };
        bot.currentDir = bestDir;
    } else {
        bot.keys = {};
        bot.currentDir = null;
    }

    let reactionTime = 30;
    if (bot.difficulty === 'medium') reactionTime = 15;
    if (bot.difficulty === 'hard') reactionTime = 8;
    if (danger) reactionTime = Math.max(2, reactionTime / 2);

    bot.moveTimer = reactionTime;
}

function isSpotDangerous(room, x, y) {
    for (let b of room.bombs) {
        if (b.gx === x) {
            const dist = Math.abs(b.gy - y);
            if (dist <= b.range) {
                let blocked = false;
                const min = Math.min(b.gy, y);
                const max = Math.max(b.gy, y);
                for(let r=min+1; r<max; r++) {
                    if (room.map[r][x] !== TILE.EMPTY) { blocked = true; break; }
                }
                if (!blocked) return true;
            }
        } else if (b.gy === y) {
            const dist = Math.abs(b.gx - x);
            if (dist <= b.range) {
                let blocked = false;
                const min = Math.min(b.gx, x);
                const max = Math.max(b.gx, x);
                for(let c=min+1; c<max; c++) {
                    if (room.map[y][c] !== TILE.EMPTY) { blocked = true; break; }
                }
                if (!blocked) return true;
            }
        }
    }
    return false;
}

function getBotValidMoves(room, bot) {
    const dirs = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
    return dirs.filter(d => {
        const tx = (bot.gx + d.x) * TILE_SIZE + 20;
        const ty = (bot.gy + d.y) * TILE_SIZE + 20;
        return !checkCollision(room, tx, ty, bot.id);
    });
}

http.listen(3000, () => {
    console.log('Servidor escuchando en http://localhost:3000');
});
