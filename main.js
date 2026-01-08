import { ASSETS } from './assets.js';
import { Renderer } from './renderer.js';
import nipplejs from 'nipplejs';
import { TILE_SIZE, CLASSES, ENEMY_TYPES, MAP_SIZE, TURBO_MAX, TURBO_CHARGE_RATE, MAGIC_COOLDOWN, ATTACK_DURATION, ENEMY_ATTACK_COOLDOWN } from './constants.js';
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
    lastTime: 0,
    turboOn: false,
    mousePos: { x: 0, y: 0 },
    targetMove: null
};

// --- Initialization ---

async function init() {
    await audio.load();
    await renderer.loadImages(ASSETS);
    await room.initialize();
    
    // Generate static map (Deterministic)
    generateMap();

    setupInputs();
    setupNetworking();

    // UI Updates
    document.getElementById('connection-status').innerText = "Connected. Choose Class.";
    
    requestAnimationFrame(gameLoop);
}

function generateMap() {
    // Simple room generation with seeded randomness for consistency across clients
    gameState.map = Array(MAP_SIZE).fill(0).map(() => Array(MAP_SIZE).fill(0));
    
    // Simple LCG Seeding
    let seed = 12345;
    const random = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    for(let y=5; y<MAP_SIZE-5; y++) {
        for(let x=5; x<MAP_SIZE-5; x++) {
            if (random() > 0.1) gameState.map[y][x] = 1;
        }
    }
    
    // Ensure spawn area is clear
    for(let y=10; y<15; y++) {
        for(let x=10; x<15; x++) {
            gameState.map[y][x] = 1;
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
    // Click/Tap to move
    renderer.canvas.addEventListener('pointerdown', (e) => {
        if (!gameState.joined || gameState.localPlayer.dead) return;
        
        const gridPos = renderer.screenToGrid(e.clientX, e.clientY);
        
        // Basic bounds check
        if (gridPos.x >= 0 && gridPos.x < MAP_SIZE && gridPos.y >= 0 && gridPos.y < MAP_SIZE) {
            gameState.targetMove = gridPos;
            // Feedback
            audio.play('coin', false, 0.2); 
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        gameState.keys[e.code] = true;
        gameState.targetMove = null; // Key override
        if (e.code === 'Space') performAttack();
        if (e.code === 'KeyE') useMagic();
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') gameState.turboOn = true;
    });
    window.addEventListener('keyup', (e) => {
        gameState.keys[e.code] = false;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') gameState.turboOn = false;
    });

    window.addEventListener('mousemove', (e) => {
        gameState.mousePos.x = e.clientX;
        gameState.mousePos.y = e.clientY;
    });

    // Detect Mobile
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
        document.getElementById('mobile-controls').classList.remove('hidden');
        document.getElementById('ctrl-desktop').style.display = 'none'; // Hide desktop instructions
        
        const manager = nipplejs.create({
            zone: document.getElementById('nipple-zone'),
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white',
            size: 100
        });

        manager.on('move', (evt, data) => {
            if (data.vector) {
                gameState.targetMove = null;
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

        const btnAttack = document.getElementById('btn-attack');
        const btnTurbo = document.getElementById('btn-turbo');
        const btnMagic = document.getElementById('btn-magic');

        const bindTouch = (elem, startFn, endFn) => {
            elem.addEventListener('touchstart', (e) => { e.preventDefault(); if(startFn) startFn(); });
            if(endFn) elem.addEventListener('touchend', (e) => { e.preventDefault(); endFn(); });
        };

        bindTouch(btnAttack, performAttack);
        bindTouch(btnTurbo, () => gameState.turboOn = true, () => gameState.turboOn = false);
        bindTouch(btnMagic, useMagic);
    } else {
        // Is Desktop
        document.getElementById('desktop-controls-hint').classList.remove('hidden');
        document.getElementById('ctrl-mobile').style.display = 'none';
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
        facing: 0,
        attackStart: 0,
        lastAttack: 0,
        lastMagic: 0,
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

function useMagic() {
    if (!gameState.localPlayer || gameState.localPlayer.dead) return;
    const p = gameState.localPlayer;
    const now = Date.now();
    
    if (now - (p.lastMagic || 0) < MAGIC_COOLDOWN) return;
    p.lastMagic = now;

    // Magic Effect: Radial Blast
    audio.play('magic', false, 1.2);
    
    // Send event
    room.send({
        type: 'magic_blast',
        id: room.clientId,
        x: p.x,
        y: p.y,
        damage: 50 // High damage
    });
}

function performAttack() {
    if (!gameState.localPlayer || gameState.localPlayer.dead) return;
    
    const now = Date.now();
    const p = gameState.localPlayer;
    const stats = CLASSES[p.class];
    
    if (now - p.lastAttack < stats.cd) return;
    p.lastAttack = now;
    p.attackStart = now; // Local visual
    
    // Determine attack angle
    const angle = p.facing; 
    
    // Logic depending on class
    if (stats.type === 'melee') {
        room.send({
            type: 'attack',
            id: room.clientId,
            x: p.x,
            y: p.y,
            angle: angle, // Send direction
            damage: stats.damage,
            class: p.class
        });
        audio.play('hit'); // Swing sound actually
        
        // Also update presence immediately so others see animation start
        room.updatePresence(p);

    } else {
        // Projectile velocity based on angle
        // Convert screen angle back to Iso velocity? 
        // Our 'facing' is screen angle.
        // Screen velocity:
        const svx = Math.cos(angle) * 10;
        const svy = Math.sin(angle) * 10;
        
        // To get Grid/Iso Velocity roughly:
        // x_grid = (x_screen/2 + y_screen) / TILE_W? No, simpler to just use screen coords for projectiles visually
        // But logic uses grid.
        // Approx:
        const speed = 0.5;
        // Map screen angle to grid vector roughly:
        // 0 (Right) -> x+ y- (Down-Right)
        // PI/2 (Down) -> x+ y+
        // PI (Left) -> x- y+
        // -PI/2 (Up) -> x- y-
        
        // This mapping depends on the Iso projection.
        // Screen X = (gx - gy) * W
        // Screen Y = (gx + gy) * H
        // Let's just pass the screen angle and handle it.
        
        room.send({
            type: 'shoot',
            id: room.clientId,
            x: p.x,
            y: p.y,
            angle: angle,
            damage: stats.damage
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
    
    // Turbo Logic
    let currentSpeed = stats.speed * dt * 4; 
    if (gameState.turboOn && p.turbo > 0) {
        currentSpeed *= 1.6; 
        p.turbo = Math.max(0, p.turbo - dt * 30); 
    } else {
        if (p.turbo < TURBO_MAX) p.turbo += TURBO_CHARGE_RATE;
    }

    // Input Movement
    let hasInput = false;
    if (gameState.keys['KeyW'] || gameState.keys['ArrowUp']) { dx -= currentSpeed; dy -= currentSpeed; hasInput = true; }
    if (gameState.keys['KeyS'] || gameState.keys['ArrowDown']) { dx += currentSpeed; dy += currentSpeed; hasInput = true; }
    if (gameState.keys['KeyA'] || gameState.keys['ArrowLeft']) { dx -= currentSpeed; dy += currentSpeed; hasInput = true; }
    if (gameState.keys['KeyD'] || gameState.keys['ArrowRight']) { dx += currentSpeed; dy -= currentSpeed; hasInput = true; }

    // Click to Move
    if (!hasInput && gameState.targetMove) {
        const dist = Math.hypot(gameState.targetMove.x - p.x, gameState.targetMove.y - p.y);
        if (dist < 0.2) {
            gameState.targetMove = null;
        } else {
            const ang = Math.atan2(gameState.targetMove.y - p.y, gameState.targetMove.x - p.x);
            const step = Math.min(dist, currentSpeed);
            dx = Math.cos(ang) * step;
            dy = Math.sin(ang) * step;
        }
    }

    // Update Facing
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) {
        // Desktop: Face Mouse
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        p.facing = Math.atan2(gameState.mousePos.y - cy, gameState.mousePos.x - cx);
    } else {
        // Mobile or Auto-Move
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
            const sx = (dx - dy);
            const sy = (dx + dy);
            p.facing = Math.atan2(sy, sx);
        }
    }

    // Collision Check - Independent Axes for Sliding with Corner Assist
    
    const checkCollision = (x, y) => {
        const tX = Math.floor(x);
        const tY = Math.floor(y);
        if (tX < 0 || tX >= MAP_SIZE || tY < 0 || tY >= MAP_SIZE) return true; // Blocked (Out of bounds)
        // 1 is floor (walkable), 0 is wall (blocked)
        // If map[tY] exists and map[tY][tX] is 1, it is safe. Otherwise blocked.
        return !(gameState.map[tY] && gameState.map[tY][tX] === 1);
    };

    // X Axis
    let nextX = p.x + dx;
    if (!checkCollision(nextX, p.y)) {
        p.x = nextX;
    } else {
        // Wall Slide / Corner Assist for X movement
        // If we are stuck moving X, check if we can slide Y to align with a gap
        // If p.y is close to a tile boundary (e.g. 10.1 or 10.9) and the diagonal tile is free
        const fractY = p.y - Math.floor(p.y);
        if (fractY < 0.3) {
            // We are near top of tile, check if moving UP helps (align to top tile)
            if (!checkCollision(nextX, p.y - 0.4)) dy -= currentSpeed * 0.5;
        } else if (fractY > 0.7) {
            // We are near bottom of tile, check if moving DOWN helps
            if (!checkCollision(nextX, p.y + 0.4)) dy += currentSpeed * 0.5;
        }
        gameState.targetMove = null;
    }

    // Y Axis
    let nextY = p.y + dy;
    // Note: Use updated p.x from X-step or original?
    // Independent axis usually implies using updated p.x for Y check can cause "sticky" feeling on corners
    // But it also prevents entering walls. 
    // We will use current p.x (which might be updated).
    
    if (!checkCollision(p.x, nextY)) {
        p.y = nextY;
    } else {
        // Wall Slide / Corner Assist for Y movement
        const fractX = p.x - Math.floor(p.x);
        if (fractX < 0.3) {
            if (!checkCollision(p.x - 0.4, nextY)) dx -= currentSpeed * 0.5;
        } else if (fractX > 0.7) {
            if (!checkCollision(p.x + 0.4, nextY)) dx += currentSpeed * 0.5;
        }
        gameState.targetMove = null;
    }

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
            flash: 0,
            knockbackVX: 0,
            knockbackVY: 0
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

        // Apply knockback first (if any)
        if (enemy.knockbackVX || enemy.knockbackVY) {
            enemy.x += enemy.knockbackVX;
            enemy.y += enemy.knockbackVY;

            const damp = 0.9;
            enemy.knockbackVX *= damp;
            enemy.knockbackVY *= damp;

            if (Math.hypot(enemy.knockbackVX, enemy.knockbackVY) < 0.005) {
                enemy.knockbackVX = 0;
                enemy.knockbackVY = 0;
            }
        }

        // Movement toward target
        if (target && minDist < 20) { // Aggro range
            const dx = target.x - enemy.x;
            const dy = target.y - enemy.y;
            const len = Math.hypot(dx, dy);
            
            if (len > 1) {
                // Move towards player
                enemy.x += (dx/len) * 0.05;
                enemy.y += (dy/len) * 0.05;
            }

            // Attack logic...
            const now = Date.now();
            if (len < 1.0) {
                 if (now - (enemy.lastAttack || 0) > ENEMY_ATTACK_COOLDOWN) {
                     enemy.lastAttack = now;
                     // Trigger attack animation state for enemy? (Not implemented in view, but logic holds)
                     room.requestPresenceUpdate(target.id, { type: 'damage', amount: 10 }); // Increased damage but slower hit
                 }
            }
        }

        // Separation (Boids-style)
        let sepX = 0;
        let sepY = 0;
        enemyList.forEach(([otherId, other]) => {
            if (eId === otherId) return;
            const dist = Math.hypot(enemy.x - other.x, enemy.y - other.y);
            if (dist < 1.0) { // Separation threshold
                const push = (1.0 - dist) * 0.05;
                const ang = Math.atan2(enemy.y - other.y, enemy.x - other.x);
                sepX += Math.cos(ang) * push;
                sepY += Math.sin(ang) * push;
            }
        });
        enemy.x += sepX;
        enemy.y += sepY;
        
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
    if (data.type === 'magic_blast') {
        // Visual for magic (could be a particle effect, for now just logic)
        // If Host: Calculate AOE damage
        const peers = Object.keys(room.peers).sort();
        if (peers[0] === room.clientId) {
            let enemies = gameState.enemies || {};
            let hit = false;
            Object.values(enemies).forEach(e => {
                const dist = Math.hypot(e.x - data.x, e.y - data.y);
                if (dist < 8) { // Large Radius
                    e.hp -= data.damage;
                    e.flash = 1.0;
                    hit = true;

                    // Knockback away from blast center
                    const dx = e.x - data.x;
                    const dy = e.y - data.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const kbStrength = 0.4;
                    const nx = dx / len;
                    const ny = dy / len;
                    e.knockbackVX = (e.knockbackVX || 0) + nx * kbStrength;
                    e.knockbackVY = (e.knockbackVY || 0) + ny * kbStrength;

                    if (e.hp <= 0) delete enemies[e.id];
                }
            });
            if (hit) room.updateRoomState({ enemies });
        }
    }

    if (data.type === 'attack') {
        // Update visual state of the attacker if it's another player
        const attacker = room.presence[data.id];
        if (attacker) {
            attacker.attackStart = Date.now();
            attacker.facing = data.angle; // Snap to attack angle
        }

        // If Host: Calculate damage to enemies
        const peers = Object.keys(room.peers).sort();
        if (peers[0] === room.clientId) {
            let enemies = gameState.enemies || {};
            let hit = false;
            
            // Define attack sector based on angle (data.angle)
            // data.angle is Screen Space angle.
            // Need to convert enemy relative pos to screen space to check sector?
            // Or just use distance for now + crude directional check?
            // Sticking to distance for simplicity as converting every enemy pos to screen space in logic is heavy?
            // Actually, let's just use distance for now to ensure hits register reliably. 
            // The visual implies direction, but the logic is generous.
            
            Object.values(enemies).forEach(e => {
                const dist = Math.hypot(e.x - data.x, e.y - data.y);
                if (dist < 3) { 
                    e.hp -= data.damage;
                    e.flash = 1.0;
                    hit = true;

                    // Knockback in attack direction (convert screen angle to grid direction)
                    const sx = Math.cos(data.angle);
                    const sy = Math.sin(data.angle);
                    // From iso projection: gx = (sx + sy) / 2, gy = (sy - sx) / 2
                    let gx = (sx + sy) / 2;
                    let gy = (sy - sx) / 2;
                    const glen = Math.hypot(gx, gy) || 1;
                    gx /= glen;
                    gy /= glen;
                    const kbStrength = 0.5;
                    e.knockbackVX = (e.knockbackVX || 0) + gx * kbStrength;
                    e.knockbackVY = (e.knockbackVY || 0) + gy * kbStrength;

                    if (e.hp <= 0) delete enemies[e.id];
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