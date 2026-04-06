'use strict';

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.dir = Math.PI / 2; // facing down
        this.r = C.PLAYER_RADIUS;
        this.nearTable = null;

        // Visual
        this.shirtColor = '#2563eb';
        this.pantsColor = '#1a1a3a';
        this.skinColor = '#f5c07a';
        this.stepPhase = 0; // for walking animation
    }

    update(dt, keys, casino) {
        let dx = 0, dy = 0;

        if (keys['w'] || keys['W'] || keys['ArrowUp'])    dy -= 1;
        if (keys['s'] || keys['S'] || keys['ArrowDown'])  dy += 1;
        if (keys['a'] || keys['A'] || keys['ArrowLeft'])  dx -= 1;
        if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += 1;

        const moving = dx !== 0 || dy !== 0;

        if (moving) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len; dy /= len;
            this.dir = Math.atan2(dy, dx);
            this.stepPhase += dt * 8;
        } else {
            this.stepPhase = 0;
        }

        // Smooth acceleration
        const acc = 1200;
        const drag = 12;
        this.vx = (this.vx + dx * acc * dt) * (1 - drag * dt);
        this.vy = (this.vy + dy * acc * dt) * (1 - drag * dt);

        // Clamp speed
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (speed > C.PLAYER_SPEED) {
            this.vx = (this.vx / speed) * C.PLAYER_SPEED;
            this.vy = (this.vy / speed) * C.PLAYER_SPEED;
        }

        let nx = this.x + this.vx * dt;
        let ny = this.y + this.vy * dt;

        // Wall bounds (with padding for walls)
        nx = Utils.clamp(nx, 55 + this.r, C.WIDTH - 55 - this.r);
        ny = Utils.clamp(ny, 90 + this.r, C.HEIGHT - 35 - this.r);

        // Table collision (push out of oval)
        for (const table of casino.tables) {
            const ex = (nx - table.x) / C.TABLE_COLLISION;
            const ey = (ny - table.y) / (C.TABLE_COLLISION * 0.65);
            const dist = Math.sqrt(ex * ex + ey * ey);
            if (dist < 1) {
                const angle = Math.atan2(ny - table.y, nx - table.x);
                const pushX = table.x + Math.cos(angle) * C.TABLE_COLLISION;
                const pushY = table.y + Math.sin(angle) * (C.TABLE_COLLISION * 0.65);
                nx = pushX; ny = pushY;
                this.vx *= 0.1; this.vy *= 0.1;
            }
        }

        this.x = nx;
        this.y = ny;

        // Check nearby table
        this.nearTable = null;
        for (const table of casino.tables) {
            const d = Utils.dist(this.x, this.y, table.x, table.y);
            if (d < C.TABLE_INTERACT) {
                this.nearTable = table;
                break;
            }
        }
    }

    render(ctx) {
        const { x, y, r, dir, stepPhase } = this;

        ctx.save();

        // Shadow
        ctx.globalAlpha = 0.25;
        Utils.fillEllipse(ctx, x, y + r * 0.6, r * 1.3, r * 0.45, '#000');
        ctx.globalAlpha = 1;

        // Walking leg swing
        const legSwing = Math.sin(stepPhase) * 0.15;

        ctx.translate(x, y);
        ctx.rotate(dir);

        // Pants / legs (two ovals peeking at the back)
        ctx.fillStyle = this.pantsColor;
        ctx.beginPath();
        ctx.ellipse(-r * 0.25 + Math.cos(legSwing) * 5, r * 0.35, r * 0.32, r * 0.55, legSwing, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(r * 0.25 - Math.cos(legSwing) * 5, r * 0.35, r * 0.32, r * 0.55, -legSwing, 0, Math.PI * 2);
        ctx.fill();

        // Body / shirt
        const bodyGrad = ctx.createRadialGradient(-r * 0.15, -r * 0.1, 1, 0, 0, r * 0.9);
        bodyGrad.addColorStop(0, '#5b8ff0');
        bodyGrad.addColorStop(1, this.shirtColor);
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.ellipse(0, r * 0.1, r * 0.72, r * 0.88, 0, 0, Math.PI * 2);
        ctx.fill();

        // Collar
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.28, r * 0.22, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        const headGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.85, 1, 0, -r * 0.75, r * 0.55);
        headGrad.addColorStop(0, '#fddba0');
        headGrad.addColorStop(1, this.skinColor);
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.arc(0, -r * 0.75, r * 0.52, 0, Math.PI * 2);
        ctx.fill();

        // Hair
        ctx.fillStyle = '#3d2000';
        ctx.beginPath();
        ctx.arc(0, -r * 0.75, r * 0.52, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -r * 1.12, r * 0.35, 0, Math.PI * 2);
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(-r * 0.18, -r * 0.72, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.18, -r * 0.72, 2.5, 0, Math.PI * 2); ctx.fill();

        // Direction arrow (small dot at front for clarity)
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(0, -r * 1.25, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}
