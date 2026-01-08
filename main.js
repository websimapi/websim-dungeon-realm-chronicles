import { ASSETS } from './assets.js';
import { Renderer } from './renderer.js';
import nipplejs from 'nipplejs';
import { TILE_SIZE, CLASSES, ENEMY_TYPES, MAP_SIZE, TURBO_MAX, TURBO_CHARGE_RATE } from './constants.js';
import { audio } from './audio_manager.js';

// --- Global State ---
const canvas = document.getElementById('game-canvas');
const renderer = new Renderer(canvas);
const room = new WebsimSocket();

let gameState = {
    joined: false,
    localPlayer: null,
    keys: {},
    map: [],
    enemies: {},
    projectiles: [],
    generators: [],
    effects: [],
    lastTime: 0
};

// --- Initialization ---

async function init() {
    await audio.load();
    await renderer.loadImages(ASSETS);
    await room.initialize();
    
    // Generate static map (pseudorandom but same for everyone based on coords)
    generateMap();

    setupInputs();
    setupNetworking();

    // UI Updates
    document.getElementById('connection-status').innerText = "Connected. Choose Class.";
    
    requestAnimationFrame(gameLoop);
}

function generateMap() {
    // Simple room generation
    gameState.map = Array(MAP_SIZE).fill(0).map(() => Array(MAP_SIZE).fill(0));
    for(let y=5; y<MAP_SIZE-5; y++) {
        for(let x=5; x<MAP_SIZE-5; x++) {
            if (Math.random() > 0.1) gameState.map[y][x] = 1;
        }
    }
}

// --- Networking ---

function setupNetworking() {
    room.subscribePresence((presence) => {
        // Just triggering re-renders or checks if needed
    });

    room.subscribeRoomState((state) => {
        // Sync enemies and objects from host
        if (state.enemies) gameState.enemies = state.enemies;
        if (state.generators) gameState.generators = state.generators;
        // Simple interpolation could go here
    });

    room.onmessage = (e) => {
        const data = e.data;
        if (data.type === 'damage') {
            audio.play('hit');
            // Show damage number logic here
        }
    };
}

// --- Input Handling ---

function setupInputs() {
    window.addEventListener('keydown', (e) => {
        gameState.keys[e.code] = true;
        if (e.code === 'Space') performAttack();
    });
    window.addEventListener('keyup', (e) => gameState.keys[e.code] = false);

    // Mobile
    if (/Mobi|Android/i.test(navigator.userAgent)) {
        document.getElementById('mobile-controls').classList.remove('hidden');
        const manager = nipplejs.create({
            zone: document.getElementById('nipple-zone'),
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white'
        });

        manager.on('move', (evt, data) => {
            if (data.vector) {
                // Simulate WASD based on vector
                gameState.keys['KeyW'] = data.vector.y > 0.3;
                gameState.keys['KeyS'] = data.vector.y < -0.3;
                gameState.keys['KeyA'] = data.vector.x < -0.3;
                gameState.keys['KeyD'] = data.vector.x > 0.3;
            }
        });
        
        manager.on('end', () => {
             gameState.keys['KeyW'] = false;
             gameState.keys['KeyS'] = false;
             gameState.keys['KeyA'] = false;
             gameState.keys['KeyD'] = false;
        });

        document.getElementById('btn-attack').addEventListener('touchstart', (e) => { e.preventDefault(); performAttack(); });
        document.getElementById('btn-turbo').addEventListener('touchstart', (e) => { e.preventDefault(); activateTurbo(); });
        document.getElementById('btn-magic').addEventListener('touchstart', (e) => { e.preventDefault(); usePotion(); });
    }
}

// --- Game Logic ---

window.selectClass = (className) => {
    const stats = CLASSES[className];
    const spawnX = 10 + Math.random() * 5;
    const spawnY = 10 + Math.random() * 5;

    gameState.localPlayer = {
        id: room.clientId,
        class: className,
        x: spawnX,
        y: spawnY,
        hp: stats.hp,
        maxHp: stats.hp,
        turbo: 0,
        xp: 0,
        level: 1,
        sprite: className,
        lastAttack: 0,
        flash: 0,
        dead: false
    };

    room.updatePresence(gameState.localPlayer);

    document.getElementById('title-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    audio.playBGM();

    gameState.joined = true;
};

window.respawn = () => {
    const p = gameState.localPlayer;
    if (!p) return;
    p.hp = p.maxHp;
    p.x = 10;
    p.y = 10;
    p.dead = false;
    document.getElementById('game-over-screen').classList.add('hidden');
    room.updatePresence(p);
};

function performAttack() {
    if (!gameState.localPlayer || gameState.localPlayer.dead) return;
    
    const now = Date.now();
    const stats = CLASSES[gameState.localPlayer.class];
    
    if (now - gameState.localPlayer.lastAttack < stats.cd) return;
    gameState.localPlayer.lastAttack = now;

    // Logic depending on class
    if (stats.type === 'melee') {
        // Simple hitbox check in front
        // In a real game, this would be a directional sector check
        // We will broadcast an attack event
        room.send({
            type: 'attack',
            id: room.clientId,
            x: gameState.localPlayer.x,
            y: gameState.localPlayer.y,
            damage: stats.damage,
            class: gameState.localPlayer.class
        });
        audio.play('hit'); // Swing sound actually
        
        // Host will calculate hits
    } else {
        // Projectile
        room.send({
            type: 'shoot',
            id: room.clientId,
            x: gameState.localPlayer.x,
            y: gameState.localPlayer.y,
            damage: stats.damage,
            vx: 0, vy: 0 // Would calculate based on facing
        });
        audio.play('magic');
    }
}

function updatePhysics(dt) {
    if (!gameState.localPlayer || gameState.localPlayer.dead) return;

    const p = gameState.localPlayer;
    const stats = CLASSES[p.class];
    let dx = 0;
    let dy = 0;
    const speed = stats.speed * dt * 4; // Tuning

    if (gameState.keys['KeyW'] || gameState.keys['ArrowUp']) { dx -= speed; dy -= speed; }
    if (gameState.keys['KeyS'] || gameState.keys['ArrowDown']) { dx += speed; dy += speed; }
    if (gameState.keys['KeyA'] || gameState.keys['ArrowLeft']) { dx -= speed; dy += speed; }
    if (gameState.keys['KeyD'] || gameState.keys['ArrowRight']) { dx += speed; dy -= speed; }

    // Collision Check (Simple bounds)
    const newX = p.x + dx;
    const newY = p.y + dy;

    if (newX > 0 && newX < MAP_SIZE && newY > 0 && newY < MAP_SIZE) {
        // Wall Check
        if (gameState.map[Math.floor(newY)][Math.floor(newX)] === 1) {
            p.x = newX;
            p.y = newY;
        }
    }

    // Regen Turbo
    if (p.turbo < TURBO_MAX) p.turbo += TURBO_CHARGE_RATE;

    // Update UI
    document.getElementById('p-hp-text').innerText = `${Math.ceil(p.hp)}/${p.maxHp}`;
    document.getElementById('hp-bar').style.width = `${(p.hp/p.maxHp)*100}%`;
    document.getElementById('turbo-bar').style.width = `${(p.turbo/TURBO_MAX)*100}%`;

    // Sync to server every few frames or if moved significant amount
    // For smoothness in this demo, we sync every frame (Websim handles throttling usually)
    room.updatePresence(p);
}

// Host Logic (Simple AI and Spawning)
function updateHostLogic() {
    // Only the alphabetically first peer acts as host
    const peers = Object.keys(room.peers).sort();
    if (peers[0] !== room.clientId) return;

    // 1. Manage Enemies
    let stateUpdates = {};
    let enemies = gameState.enemies || {};
    let enemyList = Object.entries(enemies);
    
    // Spawn if low count
    if (enemyList.length < 10) {
        const id = 'e_' + Date.now() + Math.random();
        enemies[id] = {
            id,
            type: Math.random() > 0.3 ? 'goblin' : 'skeleton',
            x: 15 + Math.random() * 20,
            y: 15 + Math.random() * 20,
            hp: 30,
            maxHp: 30,
            sprite: Math.random() > 0.3 ? 'goblin' : 'skeleton',
            flash: 0
        };
        stateUpdates.enemies = enemies;
    }

    // Move Enemies towards nearest player
    const playerIds = Object.keys(room.presence);
    
    enemyList.forEach(([eId, enemy]) => {
        if (!enemy) return;
        
        // Find nearest player
        let target = null;
        let minDist = 999;
        
        playerIds.forEach(pid => {
            const p = room.presence[pid];
            if (!p || p.dead) return;
            const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
            if (dist < minDist) {
                minDist = dist;
                target = p;
            }
        });

        if (target && minDist < 20) { // Aggro range
            const dx = target.x - enemy.x;
            const dy = target.y - enemy.y;
            // Normalize
            const len = Math.hypot(dx, dy);
            if (len > 1) { // Stop if touching
                enemy.x += (dx/len) * 0.05;
                enemy.y += (dy/len) * 0.05;
            }
            
            // Damage Player if close
            if (len < 1.0) {
                 room.requestPresenceUpdate(target.id, { type: 'damage', amount: 1 });
            }
        }
        
        if (enemy.flash > 0) enemy.flash -= 0.1;
    });

    stateUpdates.enemies = enemies;
    room.updateRoomState(stateUpdates);
}

// Handle Update Requests (Damage taken)
room.subscribePresenceUpdateRequests((req, fromId) => {
    if (req.type === 'damage') {
        const p = gameState.localPlayer;
        if (p && !p.dead) {
            p.hp -= req.amount;
            p.flash = 1.0;
            audio.play('hit');
            if (p.hp <= 0) {
                p.dead = true;
                p.hp = 0;
                document.getElementById('game-over-screen').classList.remove('hidden');
            }
            room.updatePresence(p);
        }
    }
});

room.onmessage = (evt) => {
    const data = evt.data;
    if (data.type === 'attack') {
        // Visual effect
        // If Host: Calculate damage to enemies
        const peers = Object.keys(room.peers).sort();
        if (peers[0] === room.clientId) {
            let enemies = gameState.enemies || {};
            let hit = false;
            Object.values(enemies).forEach(e => {
                const dist = Math.hypot(e.x - data.x, e.y - data.y);
                if (dist < 3) { // Melee range
                    e.hp -= data.damage;
                    e.flash = 1.0;
                    hit = true;
                    if (e.hp <= 0) {
                        delete enemies[e.id];
                        // Grant XP? Simplification: Just remove
                    }
                }
            });
            if (hit) room.updateRoomState({ enemies });
        }
    }
};


// --- Main Loop ---

function gameLoop(timestamp) {
    const dt = (timestamp - gameState.lastTime) / 1000;
    gameState.lastTime = timestamp;

    if (gameState.joined) {
        updatePhysics(dt);
        
        // Update Camera to follow player
        renderer.updateCamera(gameState.localPlayer.x, gameState.localPlayer.y);
    }
    
    // Run Host logic periodically
    updateHostLogic();

    renderer.clear();
    renderer.drawLevel(gameState.map);

    // Collect all renderable entities
    let entities = [];
    
    // Players
    Object.keys(room.presence).forEach(key => {
        const p = room.presence[key];
        if (p && !p.dead) {
            entities.push({
                ...p,
                type: 'player'
            });
        }
    });

    // Enemies
    if (gameState.enemies) {
        Object.values(gameState.enemies).forEach(e => {
            if (e) entities.push({...e, type: 'enemy'});
        });
    }

    renderer.drawEntities(entities, room.clientId);

    if (gameState.localPlayer && gameState.localPlayer.flash > 0) {
        gameState.localPlayer.flash -= dt * 5;
    }

    requestAnimationFrame(gameLoop);
}

// Start
init();