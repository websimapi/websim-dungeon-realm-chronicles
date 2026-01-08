import { TILE_SIZE, ISO_WIDTH, ISO_HEIGHT, MAP_SIZE, ATTACK_DURATION } from './constants.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.images = {};
        this.camera = { x: 0, y: 0 };
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.ctx.imageSmoothingEnabled = false;
    }

    async loadImages(assets) {
        const promises = Object.entries(assets).map(([key, src]) => {
            return new Promise((resolve) => {
                const img = new Image();
                img.src = src;
                img.onload = () => {
                    this.images[key] = img;
                    resolve();
                };
                img.onerror = resolve; // Continue even if error
            });
        });
        await Promise.all(promises);
    }

    // Convert Grid coordinates to Screen Iso coordinates
    gridToIso(x, y) {
        return {
            x: (x - y) * ISO_WIDTH,
            y: (x + y) * ISO_HEIGHT
        };
    }

    screenToGrid(screenX, screenY) {
        const cx = this.canvas.width / 2 - this.camera.x;
        const cy = this.canvas.height / 2 - this.camera.y;
        
        const adjX = screenX - cx;
        const adjY = screenY - cy;
        
        // Inverse of gridToIso
        // x = (adjX / W + adjY / H) / 2
        // y = (adjY / H - adjX / W) / 2
        
        const gridX = (adjX / ISO_WIDTH + adjY / ISO_HEIGHT) / 2;
        const gridY = (adjY / ISO_HEIGHT - adjX / ISO_WIDTH) / 2;
        
        return { x: gridX, y: gridY };
    }

    clear() {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawLevel(mapData) {
        const cx = this.canvas.width / 2 - this.camera.x;
        const cy = this.canvas.height / 2 - this.camera.y;

        // Optimization: Calculate visible range based on camera (simple culling)
        // For simplicity, just drawing everything within a reasonable distance
        // Isometric order: draw top to bottom, left to right
        
        for (let y = 0; y < MAP_SIZE; y++) {
            for (let x = 0; x < MAP_SIZE; x++) {
                const iso = this.gridToIso(x, y);
                const drawX = Math.floor(cx + iso.x);
                const drawY = Math.floor(cy + iso.y);

                if (drawX < -100 || drawX > this.canvas.width + 100 || 
                    drawY < -100 || drawY > this.canvas.height + 100) continue;

                // Floor
                if (mapData[y] && mapData[y][x] === 1) {
                    this.ctx.drawImage(this.images.floor_dungeon, drawX - 32, drawY, 64, 32);
                }
                
                // Walls are drawn later or handled via height map logic, 
                // but for this simple version, we stick to floor.
            }
        }
    }

    drawEntities(entities, localId) {
        const cx = this.canvas.width / 2 - this.camera.x;
        const cy = this.canvas.height / 2 - this.camera.y;
        const now = Date.now();

        // Sort by Y for depth
        entities.sort((a, b) => a.y - b.y);

        entities.forEach(ent => {
            const iso = this.gridToIso(ent.x, ent.y);
            const drawX = Math.floor(cx + iso.x);
            const drawY = Math.floor(cy + iso.y);

            // Sprite offset to center feet
            const spriteY = -48; 
            const spriteX = -32;

            this.ctx.save();
            this.ctx.translate(drawX, drawY);

            // Draw Shadow
            this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
            this.ctx.beginPath();
            this.ctx.ellipse(0, 16, 20, 10, 0, 0, Math.PI * 2);
            this.ctx.fill();

            // Handling Facing (Flip)
            const facing = ent.facing || 0;
            // Determine if left or right based on angle
            // 0 is Right, PI is Left.
            // Check if facing is roughly left (90 to 270 degrees)
            const isLeft = Math.abs(facing) > Math.PI / 2;
            
            if (isLeft) {
                this.ctx.scale(-1, 1);
            }

            // Attack Animation
            const isAttacking = ent.attackStart && (now - ent.attackStart < ATTACK_DURATION);
            let attackProgress = 0;
            if (isAttacking) {
                attackProgress = (now - ent.attackStart) / ATTACK_DURATION;
                // Lunge forward
                const lunge = Math.sin(attackProgress * Math.PI) * 15;
                this.ctx.translate(lunge, 0);
                
                // Color tint for enemy attack to make it visible
                if (ent.type === 'enemy') {
                     // Red tint prep handled in draw
                }
            }

            // Draw Sprite
            let img = this.images[ent.sprite];
            if (!img && ent.type === 'enemy') img = this.images.goblin; 
            if (!img && ent.type === 'player') img = this.images.warrior; 

            if (img) {
                // Flash white on hit
                if (ent.flash > 0) {
                    this.ctx.drawImage(img, spriteX, spriteY, 64, 64);
                    this.ctx.globalCompositeOperation = 'source-atop';
                    this.ctx.fillStyle = `rgba(255,255,255,${ent.flash})`;
                    this.ctx.fillRect(spriteX, spriteY, 64, 64);
                    this.ctx.globalCompositeOperation = 'source-over';
                } else if (isAttacking && ent.type === 'enemy') {
                    // Flash red on attack for enemies
                    this.ctx.drawImage(img, spriteX, spriteY, 64, 64);
                    this.ctx.globalCompositeOperation = 'source-atop';
                    this.ctx.fillStyle = `rgba(255,50,50,0.5)`; // Red flash
                    this.ctx.fillRect(spriteX, spriteY, 64, 64);
                    this.ctx.globalCompositeOperation = 'source-over';
                } else {
                    this.ctx.drawImage(img, spriteX, spriteY, 64, 64);
                }
            }

            // Draw Weapon Swing Effect
            if (isAttacking) {
                this.ctx.save();
                this.ctx.translate(10, -20); // Pivot point for sword
                // Swing rotation
                const swingAngle = (attackProgress - 0.5) * 2; // -1 to 1
                this.ctx.rotate(swingAngle * 1.5);
                
                // Draw a simple "slash" effect
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 40, -0.5, 0.5);
                this.ctx.lineTo(50, 0);
                this.ctx.fill();
                this.ctx.restore();
            }

            this.ctx.restore(); // Restore translation/scale

            // Health Bar (drawn in world space, not flipped)
            if (ent.hp < ent.maxHp) {
                const pct = Math.max(0, ent.hp / ent.maxHp);
                const barX = drawX - 16;
                const barY = drawY - 60;
                this.ctx.fillStyle = 'red';
                this.ctx.fillRect(barX, barY, 32, 4);
                this.ctx.fillStyle = '#0f0';
                this.ctx.fillRect(barX, barY, 32 * pct, 4);
            }

            // Name/Indicator
            if (ent.type === 'player') {
                this.ctx.font = '10px "Press Start 2P"';
                this.ctx.fillStyle = ent.id === localId ? '#f1c40f' : 'white';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(ent.username || 'Hero', drawX, drawY - 65);
            }
        });
    }

    drawProjectiles(projectiles) {
        const cx = this.canvas.width / 2 - this.camera.x;
        const cy = this.canvas.height / 2 - this.camera.y;

        projectiles.forEach(p => {
            const iso = this.gridToIso(p.x, p.y);
            this.ctx.fillStyle = p.color || '#fff';
            this.ctx.beginPath();
            this.ctx.arc(cx + iso.x, cy + iso.y - 16, 4, 0, Math.PI*2);
            this.ctx.fill();
        });
    }

    updateCamera(targetX, targetY) {
        const iso = this.gridToIso(targetX, targetY);
        // Smooth lerp
        this.camera.x += (iso.x - this.camera.x) * 0.1;
        this.camera.y += (iso.y - this.camera.y) * 0.1;
    }
}