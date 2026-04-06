'use strict';

const Utils = {
    dist(x1, y1, x2, y2) {
        return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
    },

    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    },

    randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    formatChips(n) {
        return '$' + n.toLocaleString();
    },

    // Draw a filled oval
    fillEllipse(ctx, x, y, rx, ry, color) {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    },

    // Draw a stroked oval
    strokeEllipse(ctx, x, y, rx, ry, color, lineWidth = 1) {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    },

    // Rounded rectangle
    roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    // Centered text
    textCenter(ctx, text, x, y, font, color, shadow = null) {
        if (shadow) {
            ctx.shadowColor = shadow;
            ctx.shadowBlur = 8;
        }
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
    },

    // Glow effect
    glow(ctx, color, blur, fn) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
        fn();
        ctx.restore();
    },

    // Draw a playing card (small, for table decorations)
    drawMiniCard(ctx, x, y, w, h, faceUp = false, card = null) {
        ctx.save();
        Utils.roundRect(ctx, x, y, w, h, 2);
        ctx.fillStyle = faceUp ? '#fff' : '#1a3a7a';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        if (faceUp && card) {
            const isRed = card.suit === '♥' || card.suit === '♦';
            ctx.fillStyle = isRed ? '#cc2222' : '#111';
            ctx.font = `bold ${Math.floor(h * 0.45)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(card.rank + card.suit, x + w / 2, y + h / 2);
        } else if (!faceUp) {
            // Card back pattern
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 0.5;
            for (let i = 0; i < 3; i++) {
                Utils.roundRect(ctx, x + 2 + i, y + 2 + i, w - 4 - i * 2, h - 4 - i * 2, 1);
                ctx.stroke();
            }
        }
        ctx.restore();
    },

    // Bust-style seated character — more human proportions with facial features
    drawSeatedCharacter(ctx, cx, cy, r, colors, folded) {
        const shirt = colors.shirtColor || '#4a6fa5';
        const hair  = colors.hairColor || '#2a1810';
        const skin  = colors.skinColor || '#e8b89a';

        if (folded) {
            Utils._drawSeatedCharacterFolded(ctx, cx, cy, r, shirt, hair, skin);
            return;
        }

        ctx.save();

        // Shadow beneath character
        Utils.fillEllipse(ctx, cx, cy + r * 1.15, r * 1.1, r * 0.25, 'rgba(0,0,0,0.3)');

        // === Shoulders & torso (broader, more natural) ===
        const torsoGrad = ctx.createRadialGradient(cx - r * 0.15, cy + r * 0.3, 3, cx, cy + r * 0.75, r * 1.4);
        torsoGrad.addColorStop(0, this._lightenFill(ctx, shirt, 0.2));
        torsoGrad.addColorStop(0.5, shirt);
        torsoGrad.addColorStop(1, this._lightenFill(ctx, shirt, -0.2));
        // Wider shoulders, narrower waist
        ctx.beginPath();
        ctx.moveTo(cx - r * 1.05, cy + r * 1.0);
        ctx.quadraticCurveTo(cx - r * 1.1, cy + r * 0.4, cx - r * 0.45, cy + r * 0.22);
        ctx.lineTo(cx + r * 0.45, cy + r * 0.22);
        ctx.quadraticCurveTo(cx + r * 1.1, cy + r * 0.4, cx + r * 1.05, cy + r * 1.0);
        ctx.closePath();
        ctx.fillStyle = torsoGrad;
        ctx.fill();

        // Collar / V-neck
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.25, cy + r * 0.22);
        ctx.lineTo(cx, cy + r * 0.48);
        ctx.lineTo(cx + r * 0.25, cy + r * 0.22);
        ctx.strokeStyle = this._lightenFill(ctx, shirt, -0.15);
        ctx.lineWidth = Math.max(1, r * 0.04);
        ctx.stroke();
        // Visible undershirt in V
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.2, cy + r * 0.24);
        ctx.lineTo(cx, cy + r * 0.42);
        ctx.lineTo(cx + r * 0.2, cy + r * 0.24);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fill();

        // === Neck ===
        const neckGrad = ctx.createLinearGradient(cx, cy + r * 0.22, cx, cy - r * 0.05);
        neckGrad.addColorStop(0, this._lightenFill(ctx, skin, -0.08));
        neckGrad.addColorStop(1, skin);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.22, cy + r * 0.22);
        ctx.lineTo(cx - r * 0.18, cy + r * 0.0);
        ctx.lineTo(cx + r * 0.18, cy + r * 0.0);
        ctx.lineTo(cx + r * 0.22, cy + r * 0.22);
        ctx.closePath();
        ctx.fillStyle = neckGrad;
        ctx.fill();

        // === Head (slightly oval, more natural) ===
        const headGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.38, 2, cx, cy - r * 0.15, r * 0.88);
        headGrad.addColorStop(0, this._lightenFill(ctx, skin, 0.2));
        headGrad.addColorStop(0.55, skin);
        headGrad.addColorStop(1, this._lightenFill(ctx, skin, -0.12));
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.2, r * 0.62, r * 0.72, 0, 0, Math.PI * 2);
        ctx.fillStyle = headGrad;
        ctx.fill();

        // === Ears ===
        const earY = cy - r * 0.15;
        ctx.fillStyle = this._lightenFill(ctx, skin, -0.05);
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.6, earY, r * 0.1, r * 0.15, -0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.6, earY, r * 0.1, r * 0.15, 0.1, 0, Math.PI * 2);
        ctx.fill();

        // === Hair (layered, more styled) ===
        // Back/volume
        ctx.beginPath();
        ctx.fillStyle = this._lightenFill(ctx, hair, -0.06);
        ctx.ellipse(cx, cy - r * 0.68, r * 0.65, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        // Main hair shape
        ctx.beginPath();
        ctx.fillStyle = hair;
        ctx.moveTo(cx - r * 0.62, cy - r * 0.2);
        ctx.quadraticCurveTo(cx - r * 0.72, cy - r * 0.7, cx - r * 0.15, cy - r * 0.9);
        ctx.quadraticCurveTo(cx + r * 0.1, cy - r * 0.95, cx + r * 0.4, cy - r * 0.85);
        ctx.quadraticCurveTo(cx + r * 0.72, cy - r * 0.65, cx + r * 0.62, cy - r * 0.2);
        ctx.quadraticCurveTo(cx + r * 0.55, cy - r * 0.35, cx, cy - r * 0.28);
        ctx.quadraticCurveTo(cx - r * 0.55, cy - r * 0.35, cx - r * 0.62, cy - r * 0.2);
        ctx.closePath();
        ctx.fill();
        // Hair shine
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.15, cy - r * 0.72, r * 0.2, r * 0.08, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.restore();

        // === Eyebrows ===
        ctx.strokeStyle = this._lightenFill(ctx, hair, 0.05);
        ctx.lineWidth = Math.max(1.2, r * 0.06);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.38, cy - r * 0.38);
        ctx.quadraticCurveTo(cx - r * 0.25, cy - r * 0.44, cx - r * 0.12, cy - r * 0.38);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + r * 0.12, cy - r * 0.38);
        ctx.quadraticCurveTo(cx + r * 0.25, cy - r * 0.44, cx + r * 0.38, cy - r * 0.38);
        ctx.stroke();

        // === Eyes (almond-shaped with whites, iris, pupil) ===
        const eyeY = cy - r * 0.25;
        const eyeSpacing = r * 0.22;
        for (const side of [-1, 1]) {
            const ex = cx + side * eyeSpacing;
            // Eye white
            ctx.beginPath();
            ctx.ellipse(ex, eyeY, r * 0.14, r * 0.09, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#f5f5f0';
            ctx.fill();
            // Iris
            ctx.beginPath();
            ctx.arc(ex, eyeY, r * 0.07, 0, Math.PI * 2);
            ctx.fillStyle = '#3a2518';
            ctx.fill();
            // Pupil
            ctx.beginPath();
            ctx.arc(ex, eyeY, r * 0.035, 0, Math.PI * 2);
            ctx.fillStyle = '#111';
            ctx.fill();
            // Eye highlight
            ctx.beginPath();
            ctx.arc(ex - r * 0.025, eyeY - r * 0.025, r * 0.02, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fill();
        }

        // === Nose (subtle) ===
        ctx.strokeStyle = this._lightenFill(ctx, skin, -0.12);
        ctx.lineWidth = Math.max(0.8, r * 0.03);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.18);
        ctx.lineTo(cx - r * 0.05, cy - r * 0.05);
        ctx.stroke();

        // === Mouth (slight smile) ===
        ctx.strokeStyle = this._lightenFill(ctx, skin, -0.2);
        ctx.lineWidth = Math.max(1, r * 0.04);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.15, cy + r * 0.08);
        ctx.quadraticCurveTo(cx, cy + r * 0.14, cx + r * 0.15, cy + r * 0.08);
        ctx.stroke();

        // === Cheek blush (very subtle) ===
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#e88';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.32, cy, r * 0.12, r * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.32, cy, r * 0.12, r * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.restore();
    },

    /** Slouched / eyes closed when folded */
    _drawSeatedCharacterFolded(ctx, cx, cy, r, shirt, hair, skin) {
        ctx.save();
        ctx.globalAlpha = 0.75;

        Utils.fillEllipse(ctx, cx, cy + r * 1.2, r * 1.05, r * 0.22, 'rgba(0,0,0,0.18)');

        const shirtMuted = Utils._muteColorForFold(shirt);
        const hairMuted  = Utils._muteColorForFold(hair);
        const skinMuted  = Utils._muteColorForFold(skin);

        const lean = 0.15;
        ctx.translate(cx, cy + r * 0.85);
        ctx.rotate(lean);
        ctx.translate(-cx, -(cy + r * 0.85));

        // Torso (shoulders slumped)
        const torsoGrad = ctx.createRadialGradient(cx - r * 0.1, cy + r * 0.4, 2, cx, cy + r * 0.78, r * 1.2);
        torsoGrad.addColorStop(0, Utils._lightenFill(ctx, shirtMuted, 0.06));
        torsoGrad.addColorStop(0.5, shirtMuted);
        torsoGrad.addColorStop(1, Utils._lightenFill(ctx, shirtMuted, -0.22));
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.95, cy + r * 1.0);
        ctx.quadraticCurveTo(cx - r * 1.0, cy + r * 0.45, cx - r * 0.4, cy + r * 0.28);
        ctx.lineTo(cx + r * 0.4, cy + r * 0.28);
        ctx.quadraticCurveTo(cx + r * 1.0, cy + r * 0.45, cx + r * 0.95, cy + r * 1.0);
        ctx.closePath();
        ctx.fillStyle = torsoGrad;
        ctx.fill();

        // Neck
        ctx.fillStyle = skinMuted;
        ctx.fillRect(cx - r * 0.15, cy + r * 0.02, r * 0.3, r * 0.22);

        // Head (drooped)
        const hx = cx + r * 0.04;
        const hy = cy + r * 0.04;
        const headGrad = ctx.createRadialGradient(hx - r * 0.15, hy - r * 0.3, 1, hx, hy - r * 0.1, r * 0.82);
        headGrad.addColorStop(0, Utils._lightenFill(ctx, skinMuted, 0.1));
        headGrad.addColorStop(0.6, skinMuted);
        headGrad.addColorStop(1, Utils._lightenFill(ctx, skinMuted, -0.18));
        ctx.beginPath();
        ctx.ellipse(hx, hy - r * 0.15, r * 0.58, r * 0.65, lean * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = headGrad;
        ctx.fill();

        // Hair
        ctx.beginPath();
        ctx.fillStyle = hairMuted;
        ctx.moveTo(hx - r * 0.56, hy - r * 0.15);
        ctx.quadraticCurveTo(hx - r * 0.62, hy - r * 0.6, hx - r * 0.1, hy - r * 0.78);
        ctx.quadraticCurveTo(hx + r * 0.4, hy - r * 0.75, hx + r * 0.56, hy - r * 0.15);
        ctx.quadraticCurveTo(hx + r * 0.45, hy - r * 0.3, hx, hy - r * 0.22);
        ctx.quadraticCurveTo(hx - r * 0.45, hy - r * 0.3, hx - r * 0.56, hy - r * 0.15);
        ctx.closePath();
        ctx.fill();

        // Closed eyes (lines)
        ctx.strokeStyle = 'rgba(35,35,35,0.65)';
        ctx.lineWidth = Math.max(1, r * 0.04);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hx - r * 0.3, hy - r * 0.12);
        ctx.quadraticCurveTo(hx - r * 0.2, hy - r * 0.06, hx - r * 0.08, hy - r * 0.12);
        ctx.moveTo(hx + r * 0.08, hy - r * 0.12);
        ctx.quadraticCurveTo(hx + r * 0.2, hy - r * 0.06, hx + r * 0.3, hy - r * 0.12);
        ctx.stroke();

        // Mouth (neutral/downturned)
        ctx.strokeStyle = Utils._lightenFill(ctx, skinMuted, -0.18);
        ctx.lineWidth = Math.max(0.8, r * 0.035);
        ctx.beginPath();
        ctx.moveTo(hx - r * 0.12, hy + r * 0.08);
        ctx.lineTo(hx + r * 0.12, hy + r * 0.08);
        ctx.stroke();

        ctx.restore();

        // Dimming overlay
        ctx.save();
        ctx.globalAlpha = 0.25;
        Utils.fillEllipse(ctx, cx, cy + r * 0.55, r * 1.15, r * 0.95, 'rgba(20,15,30,0.8)');
        ctx.restore();
    },

    _muteColorForFold(c) {
        if (typeof c === 'string' && c.startsWith('hsl')) {
            const m = /^hsl\(\s*([\d.]+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/i.exec(c);
            if (m) {
                const h = parseFloat(m[1]);
                const s = Math.min(28, Math.round(parseInt(m[2], 10) * 0.4));
                const l = Math.round(parseInt(m[3], 10) * 0.88);
                return `hsl(${h}, ${s}%, ${l}%)`;
            }
        }
        if (typeof c === 'string' && c.startsWith('#') && c.length === 7) {
            const r = parseInt(c.slice(1, 3), 16);
            const g = parseInt(c.slice(3, 5), 16);
            const b = parseInt(c.slice(5, 7), 16);
            const mix = (n) => Math.round(Utils.lerp(n, 105, 0.58));
            return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
        }
        if (typeof c === 'string' && c.startsWith('rgb')) {
            const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(c);
            if (m) {
                const mix = (n) => Math.round(Utils.lerp(parseInt(n, 10), 105, 0.58));
                return `rgb(${mix(m[1])},${mix(m[2])},${mix(m[3])})`;
            }
        }
        return 'rgb(105,105,118)';
    },

    _lightenFill(ctx, color, amt) {
        if (typeof color === 'string' && color.startsWith('#') && color.length === 7) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            const lr = Utils.clamp(Math.round(r + amt * 255), 0, 255);
            const lg = Utils.clamp(Math.round(g + amt * 255), 0, 255);
            const lb = Utils.clamp(Math.round(b + amt * 255), 0, 255);
            return `rgb(${lr},${lg},${lb})`;
        }
        const rgbM = typeof color === 'string'
            ? /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(color)
            : null;
        if (rgbM) {
            const r = parseInt(rgbM[1], 10);
            const g = parseInt(rgbM[2], 10);
            const b = parseInt(rgbM[3], 10);
            const lr = Utils.clamp(Math.round(r + amt * 255), 0, 255);
            const lg = Utils.clamp(Math.round(g + amt * 255), 0, 255);
            const lb = Utils.clamp(Math.round(b + amt * 255), 0, 255);
            return `rgb(${lr},${lg},${lb})`;
        }
        return color;
    }
};
