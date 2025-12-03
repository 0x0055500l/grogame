const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const TILE_SIZE = 40;

// Estado local
let gameState = { players: {}, bombs: [], items: [], map: [] };
let myId = null;
let explosions = [];
let chatVisible = true;

// --- UI LOGIC ---
// Intentar reconexión al cargar
window.onload = () => {
    const savedUser = localStorage.getItem('bomber_user');
    const savedRoom = localStorage.getItem('bomber_room');
    
    if (savedUser && savedRoom) {
        // Intentar reconectar
        socket.emit('rejoinGame', { username: savedUser, roomName: savedRoom });
    }
};

function login() {
    const name = document.getElementById('username').value;
    if(name) {
        socket.emit('joinLobby', name);
        localStorage.setItem('bomber_user', name); // Guardar nombre
        showScreen('lobby-screen');
    }
}

function createRoom() {
    const name = document.getElementById('roomName').value;
    const diff = document.getElementById('difficulty').value;
    if(name) {
        socket.emit('createRoom', { name, difficulty: diff });
        localStorage.setItem('bomber_room', name); // Guardar sala
    }
}

function joinRoom(name) {
    socket.emit('joinRoom', name);
    localStorage.setItem('bomber_room', name); // Guardar sala
}

function startGame() {
    socket.emit('startGame');
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if(el) el.classList.add('active');
}

function toggleChat() {
    chatVisible = !chatVisible;
    const wrapper = document.getElementById('chat-wrapper');
    if(chatVisible) wrapper.classList.remove('chat-hidden');
    else wrapper.classList.add('chat-hidden');
}

// --- SOCKET EVENTS ---
socket.on('roomList', (rooms) => {
    const list = document.getElementById('room-list');
    list.innerHTML = '';
    Object.values(rooms).forEach(r => {
        const li = document.createElement('li');
        li.className = 'room-item';
        li.innerHTML = `
            <div>
                <span style="font-weight:bold; font-size:18px">${r.id}</span>
                <span style="color:#aaa; font-size:14px"> (${r.difficulty})</span>
            </div>
            <div>
                <span>${Object.keys(r.players).length}/4</span>
                <button style="padding:5px 15px; margin:0 0 0 10px;" onclick="joinRoom('${r.id}')">Unirse</button>
            </div>`;
        list.appendChild(li);
    });
});

socket.on('updateLobby', (room) => {
    showScreen('waiting-screen');
    document.getElementById('room-title').innerText = "SALA: " + room.id;
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    Object.values(room.players).forEach(p => {
        const li = document.createElement('li');
        li.className = 'room-item';
        li.innerText = p.name;
        list.appendChild(li);
    });

    if(room.owner === socket.id) {
        document.getElementById('btnStart').style.display = 'block';
    } else {
        document.getElementById('btnStart').style.display = 'none';
    }
});

socket.on('gameStarted', (room) => {
    showScreen('none'); 
    document.getElementById('game-container').style.display = 'flex';
    myId = socket.id;
    gameState.map = room.map;
    requestAnimationFrame(render);
});

socket.on('gameState', (state) => {
    gameState.players = state.players;
    gameState.bombs = state.bombs;
    gameState.items = state.items || [];
    gameState.map = state.map;
    updateHUD();
});

socket.on('explosion', (data) => {
    data.forEach(pos => {
        explosions.push({x: pos.x * TILE_SIZE, y: pos.y * TILE_SIZE, life: 1.0});
    });
});

socket.on('chatUpdate', (msg) => {
    const div = document.getElementById('chat-msgs');
    const p = document.createElement('div');
    p.innerHTML = `<b style="color:#f1c40f">${msg.user}:</b> ${msg.text}`;
    div.appendChild(p);
    div.scrollTop = div.scrollHeight;
});

socket.on('gameOver', (winner) => {
    alert("JUEGO TERMINADO! Ganador: " + winner);
    // Limpiar sesión al terminar
    localStorage.removeItem('bomber_room');
    location.reload();
});

socket.on('error', (msg) => {
    alert(msg);
    localStorage.removeItem('bomber_room'); // Si falla reconexión, limpiar
    location.reload();
});

// --- INPUTS (PC & MOBILE) ---
const keys = { up: false, down: false, left: false, right: false, space: false };

// PC
window.addEventListener('keydown', e => {
    if(document.activeElement === document.getElementById('chat-input')) return;
    updateKey(e.key, true);
});
window.addEventListener('keyup', e => updateKey(e.key, false));

// MOBILE
document.querySelectorAll('.btn').forEach(btn => {
    const k = btn.getAttribute('data-key');
    const start = (e) => { e.preventDefault(); updateKey(k, true); btn.style.background = "rgba(255,255,255,0.5)"; };
    const end = (e) => { e.preventDefault(); updateKey(k, false); btn.style.background = ""; };
    
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', end);
    btn.addEventListener('touchstart', start);
    btn.addEventListener('touchend', end);
});

function updateKey(key, val) {
    if(key === 'ArrowUp') keys.up = val;
    if(key === 'ArrowDown') keys.down = val;
    if(key === 'ArrowLeft') keys.left = val;
    if(key === 'ArrowRight') keys.right = val;
    if(key === ' ' || key === 'Space') keys.space = val;
    socket.emit('input', keys);
}

document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') {
        socket.emit('chatMsg', e.target.value);
        e.target.value = '';
    }
});

// --- RENDER LOOP ---
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mapa
    for(let r=0; r<gameState.map.length; r++) {
        for(let c=0; c<gameState.map[0].length; c++) {
            const x = c * TILE_SIZE;
            const y = r * TILE_SIZE;
            const tile = gameState.map[r][c];
            
            // Suelo (Checkerboard)
            if((r+c)%2===0) { 
                ctx.fillStyle = "#27ae60"; 
                ctx.fillRect(x,y,TILE_SIZE,TILE_SIZE); 
            } else {
                ctx.fillStyle = "#2ecc71"; 
                ctx.fillRect(x,y,TILE_SIZE,TILE_SIZE); 
            }
            
            if(tile === 1) { // Hard (3D Effect)
                ctx.fillStyle = "#34495e"; ctx.fillRect(x,y,TILE_SIZE,TILE_SIZE);
                ctx.fillStyle = "#2c3e50"; ctx.fillRect(x+4,y+4,TILE_SIZE-4,TILE_SIZE-4); // Sombra
                ctx.fillStyle = "#5d6d7e"; ctx.fillRect(x,y,TILE_SIZE-4,TILE_SIZE-4); // Luz
                ctx.fillStyle = "#34495e"; ctx.fillRect(x+4,y+4,TILE_SIZE-8,TILE_SIZE-8); // Cara
            } else if(tile === 2) { // Soft (Ladrillo)
                ctx.fillStyle = "#d35400"; ctx.fillRect(x,y,TILE_SIZE,TILE_SIZE);
                ctx.fillStyle = "#e67e22"; ctx.fillRect(x+2,y+2,TILE_SIZE-4,TILE_SIZE-4);
                // Detalles
                ctx.fillStyle = "#a04000";
                ctx.fillRect(x, y+10, TILE_SIZE, 2);
                ctx.fillRect(x+10, y, 2, 10);
            }
        }
    }
    // Bombas (Gradiente y Pulso)
    gameState.bombs.forEach(b => {
        const cx = b.gx * TILE_SIZE + TILE_SIZE/2;
        const cy = b.gy * TILE_SIZE + TILE_SIZE/2;
        const pulse = Math.sin(Date.now()/100) * 2;

        // Sombra
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath(); ctx.ellipse(cx, cy+12, 10, 4, 0, 0, Math.PI*2); ctx.fill();

        // Cuerpo
        const grad = ctx.createRadialGradient(cx-5, cy-5, 2, cx, cy, 15);
        grad.addColorStop(0, "#555");
        grad.addColorStop(1, "black");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, 14 + (b.timer<30?pulse:0), 0, Math.PI*2); ctx.fill();
        
        // Mecha
        if(b.timer < 30) { ctx.fillStyle = "red"; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2); ctx.fill(); }
    });

    // Items
    if (gameState.items) {
        gameState.items.forEach(item => {
            const x = item.gx * TILE_SIZE;
            const y = item.gy * TILE_SIZE;
            const float = Math.sin(Date.now() / 200) * 3;

            // Sombra
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.beginPath(); ctx.ellipse(x + TILE_SIZE/2, y + TILE_SIZE - 8, 8, 3, 0, 0, Math.PI*2); ctx.fill();

            if (item.type === 1) { // BLAST
                // Icono de bomba flotante
                ctx.fillStyle = "#e74c3c"; // Rojo
                ctx.beginPath(); ctx.arc(x + TILE_SIZE/2, y + TILE_SIZE/2 + float, 10, 0, Math.PI*2); ctx.fill();
                
                // Mecha
                ctx.strokeStyle = "white";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x + TILE_SIZE/2, y + TILE_SIZE/2 + float - 10);
                ctx.quadraticCurveTo(x + TILE_SIZE/2 + 5, y + TILE_SIZE/2 + float - 15, x + TILE_SIZE/2 + 8, y + TILE_SIZE/2 + float - 12);
                ctx.stroke();

                // Brillo
                ctx.fillStyle = "rgba(255,255,255,0.5)";
                ctx.beginPath(); ctx.arc(x + TILE_SIZE/2 - 3, y + TILE_SIZE/2 + float - 3, 3, 0, Math.PI*2); ctx.fill();
            } else if (item.type === 2) { // SPEED (Shoe)
                // Icono de zapato/ala
                ctx.fillStyle = "#3498db"; // Azul
                ctx.beginPath(); ctx.arc(x + TILE_SIZE/2, y + TILE_SIZE/2 + float, 10, 0, Math.PI*2); ctx.fill();
                
                // Dibujo simple de bota/ala
                ctx.fillStyle = "white";
                ctx.beginPath();
                // Forma de bota
                const bx = x + TILE_SIZE/2 - 4;
                const by = y + TILE_SIZE/2 + float - 4;
                ctx.moveTo(bx, by);
                ctx.lineTo(bx, by + 8);
                ctx.lineTo(bx + 8, by + 8);
                ctx.lineTo(bx + 8, by + 4);
                ctx.lineTo(bx + 4, by + 4);
                ctx.lineTo(bx + 4, by);
                ctx.fill();
            }
        });
    }

    // Explosiones (Partículas)
    // Explosiones (Partículas)
    explosions.forEach((e, i) => {
        ctx.globalAlpha = e.life;
        const size = TILE_SIZE * (1.5 - e.life*0.5);
        
        const grad = ctx.createRadialGradient(e.x+TILE_SIZE/2, e.y+TILE_SIZE/2, 0, e.x+TILE_SIZE/2, e.y+TILE_SIZE/2, size/2);
        grad.addColorStop(0, "yellow");
        grad.addColorStop(0.5, "orange");
        grad.addColorStop(1, "rgba(255,0,0,0)");
        
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(e.x + TILE_SIZE/2, e.y + TILE_SIZE/2, size/2, 0, Math.PI*2); ctx.fill();
        
        ctx.globalAlpha = 1.0;
        e.life -= 0.05;
        if(e.life <= 0) explosions.splice(i, 1);
    });

    // Jugadores
    Object.values(gameState.players).forEach(p => {
        if(p.dead) return;
        if(p.invincible > 0 && Math.floor(Date.now()/100)%2===0) return;

        // Animación simple de rebote
        const bounce = (p.keys && (p.keys.up||p.keys.down||p.keys.left||p.keys.right)) ? Math.sin(Date.now()/100)*2 : 0;

        // Sombra
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath(); ctx.ellipse(p.x + TILE_SIZE/2, p.y + TILE_SIZE - 5, 12, 5, 0, 0, Math.PI*2); ctx.fill();

        // Cuerpo
        ctx.fillStyle = p.color;
        roundRect(ctx, p.x+5, p.y+5 - Math.abs(bounce), TILE_SIZE-10, TILE_SIZE-10, 8);
        ctx.fill();
        
        // Nombre
        ctx.fillStyle = "white";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.shadowColor = "black"; ctx.shadowBlur = 4;
        ctx.fillText(p.name, p.x + TILE_SIZE/2, p.y - 8);
        ctx.shadowBlur = 0;

        // Ojos
        ctx.fillStyle = "white";
        const eyeOffX = p.facing.x * 4;
        const eyeOffY = p.facing.y * 2;
        ctx.fillRect(p.x + 10 + eyeOffX, p.y + 10 + eyeOffY - Math.abs(bounce), 6, 6);
        ctx.fillRect(p.x + 24 + eyeOffX, p.y + 10 + eyeOffY - Math.abs(bounce), 6, 6);
    });

    requestAnimationFrame(render);
}

function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function updateHUD() {
    const hud = document.getElementById('hud');
    hud.innerHTML = '';
    Object.values(gameState.players).forEach(p => {
        const div = document.createElement('div');
        div.style.color = p.color;
        div.style.textShadow = "1px 1px 2px black";
        div.innerText = `${p.name}: ${p.dead ? '💀' : '❤️'.repeat(p.lives)}`;
        hud.appendChild(div);
    });
}
