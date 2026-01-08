import { ASSETS } from './assets.js';

class AudioManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.buffers = {};
        this.muted = false;
        this.bgmSource = null;
    }

    async load() {
        // Load sounds defined in ASSETS
        const loadSound = async (url) => {
            if (!url) return null;
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                return await this.ctx.decodeAudioData(arrayBuffer);
            } catch (e) {
                console.warn("Failed to load sound", url);
                return null;
            }
        };

        this.buffers.hit = await loadSound(ASSETS.sfx_hit);
        this.buffers.magic = await loadSound(ASSETS.sfx_magic);
        this.buffers.turbo = await loadSound(ASSETS.sfx_turbo);
        this.buffers.bgm = await loadSound(ASSETS.bgm_dungeon);
    }

    play(name, loop = false, volume = 1.0) {
        if (this.muted || !this.buffers[name]) return;
        
        // Resume context if suspended (browser policy)
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        source.loop = loop;
        
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = volume;
        
        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        source.start(0);

        if (loop) return source;
    }

    playBGM() {
        if (this.bgmSource) return;
        this.bgmSource = this.play('bgm', true, 0.4);
    }
}

export const audio = new AudioManager();