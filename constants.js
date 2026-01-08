export const TILE_SIZE = 32;
export const ISO_WIDTH = 32;
export const ISO_HEIGHT = 16;
export const MAP_SIZE = 40; // 40x40 grid

export const CLASSES = {
    warrior: { hp: 200, speed: 2.5, damage: 25, type: 'melee', range: 40, cd: 500, defense: 0.4 },
    valkyrie: { hp: 150, speed: 3.5, damage: 15, type: 'melee', range: 60, cd: 400, defense: 0.2 },
    wizard: { hp: 80, speed: 3.0, damage: 35, type: 'ranged', range: 200, cd: 800, defense: 0.1 },
    archer: { hp: 100, speed: 4.5, damage: 12, type: 'ranged', range: 250, cd: 300, defense: 0.1 }
};

export const ENEMY_TYPES = {
    goblin: { hp: 30, damage: 5, speed: 1.5, xp: 10, range: 20 },
    skeleton: { hp: 60, damage: 10, speed: 1.0, xp: 20, range: 20 },
    demon: { hp: 500, damage: 25, speed: 2.0, xp: 500, range: 40, boss: true }
};

export const TURBO_MAX = 100;
export const TURBO_CHARGE_RATE = 0.1; // Per frame
export const MAGIC_COOLDOWN = 3000; // ms
export const ATTACK_DURATION = 250; // ms