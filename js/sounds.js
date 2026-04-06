'use strict';

const Sounds = {
    ctx: null,

    _ensure() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
    },

    play(kind) {
        if (typeof KieferSave !== 'undefined' && KieferSave.isMuted()) return;
        this._ensure();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});

        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.connect(g);
        g.connect(this.ctx.destination);

        const now = this.ctx.currentTime;
        const freq = {
            fold: 180,
            check: 320,
            call: 440,
            raise: 520,
            deal: 380,
            win: 660,
            chip: 290
        }[kind] || 400;

        osc.type = kind === 'win' ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.start(now);
        osc.stop(now + 0.15);
    }
};
