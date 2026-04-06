'use strict';

// First-person casino lobby — no walking, mouse-based selection
class CasinoFloor {
    constructor() {
        this.time = 0;
        this.hoveredTable = null;
        this.tables = C.TABLES; // raw config objects
        this.activeTab = 'tables';
        /** @type {number|null} */
        this.wardrobeHoverId = null;
        this.tabHover = false;

        // Panel layout: 3 panels per row
        // Row 1 = Hold'em (indices 0,1,2), Row 2 = Omaha (indices 3,4,5)
        this.panels = this._buildPanels();
        this._outfitCells = this._buildOutfitGrid();

        // Spin wheel state
        this.wheelAngle = 0;
        this.wheelSpinning = false;
        this.wheelSpeed = 0;
        this.wheelResult = null;       // {amount, text} after spin completes
        this.wheelResultTimer = 0;
        this.dailyBonusClaimed = false; // flash feedback
        this.dailyBonusFlash = 0;

        // Wheel segments: amounts and colors
        this.wheelSegments = [
            { amount: 50,   label: '$50',   color: '#8B0000' },
            { amount: 100,  label: '$100',  color: '#1a5276' },
            { amount: 200,  label: '$200',  color: '#0e6251' },
            { amount: 75,   label: '$75',   color: '#6c3483' },
            { amount: 500,  label: '$500',  color: '#b7950b' },
            { amount: 150,  label: '$150',  color: '#1b4f72' },
            { amount: 50,   label: '$50',   color: '#78281f' },
            { amount: 300,  label: '$300',  color: '#145a32' },
            { amount: 100,  label: '$100',  color: '#4a235a' },
            { amount: 1000, label: '$1000', color: '#d4ac0d' }
        ];
    }

    _buildPanels() {
        const pw = 310, ph = 155;
        const xs3 = [68, 445, 822];       // 3-column row
        const xs2 = [256, 634];           // 2-column row, centered
        const y1 = 240, y2 = 438;

        return this.tables.map((t, i) => {
            if (i < 3) {
                return { x: xs3[i], y: y1, w: pw, h: ph, cfg: t };
            } else {
                return { x: xs2[i - 3], y: y2, w: pw, h: ph, cfg: t };
            }
        });
    }

    update(dt, mouseX, mouseY) {
        this.time += dt;
        this._updateWheel(dt);
        if (this.dailyBonusFlash > 0) this.dailyBonusFlash -= dt;
        if (this.wheelResultTimer > 0) this.wheelResultTimer -= dt;
        this.hoveredTable = null;
        this.wardrobeHoverId = null;
        this.cashierHover = null;
        this.tabHover = false;
        const tabs = this._getTabRects();
        for (const r of Object.values(tabs)) {
            if (mouseX >= r.x && mouseX <= r.x + r.w &&
                mouseY >= r.y && mouseY <= r.y + r.h) {
                this.tabHover = true;
                break;
            }
        }

        if (this.activeTab === 'wardrobe') {
            for (const cell of this._outfitCells) {
                if (mouseX >= cell.x && mouseX <= cell.x + cell.w &&
                    mouseY >= cell.y && mouseY <= cell.y + cell.h) {
                    this.wardrobeHoverId = cell.outfit.id;
                    break;
                }
            }
        } else if (this.activeTab === 'cashier') {
            const rects = this._getCashierRects();
            for (const [key, r] of Object.entries(rects)) {
                if (mouseX >= r.x && mouseX <= r.x + r.w &&
                    mouseY >= r.y && mouseY <= r.y + r.h) {
                    this.cashierHover = key;
                    break;
                }
            }
        } else {
            for (const p of this.panels) {
                if (mouseX >= p.x && mouseX <= p.x + p.w &&
                    mouseY >= p.y && mouseY <= p.y + p.h) {
                    this.hoveredTable = p.cfg;
                    break;
                }
            }
        }
    }

    getClickedTable(mouseX, mouseY) {
        for (const p of this.panels) {
            if (mouseX >= p.x && mouseX <= p.x + p.w &&
                mouseY >= p.y && mouseY <= p.y + p.h) {
                return p.cfg;
            }
        }
        return null;
    }

    /**
     * @returns {object|null} table config if player chose a table, otherwise null
     */
    handleClick(mouseX, mouseY, game) {
        const tabs = this._getTabRects();
        const hit = (r) => mouseX >= r.x && mouseX <= r.x + r.w &&
            mouseY >= r.y && mouseY <= r.y + r.h;

        if (hit(tabs.tables)) {
            this.activeTab = 'tables';
            return null;
        }
        if (hit(tabs.wardrobe)) {
            this.activeTab = 'wardrobe';
            return null;
        }
        if (hit(tabs.cashier)) {
            this.activeTab = 'cashier';
            return null;
        }
        if (hit(tabs.stats)) {
            this.activeTab = 'stats';
            return null;
        }

        if (this.activeTab === 'cashier') {
            this._handleCashierClick(mouseX, mouseY, game);
            return null;
        }

        if (this.activeTab === 'wardrobe') {
            for (const cell of this._outfitCells) {
                const br = { x: cell.bx, y: cell.by, w: cell.bw, h: cell.bh };
                if (mouseX >= br.x && mouseX <= br.x + br.w &&
                    mouseY >= br.y && mouseY <= br.y + br.h) {
                    const o = cell.outfit;
                    if (!WardrobeSystem.isUnlocked(o.id)) {
                        if (WardrobeSystem.buy(o.id, game)) {
                            game._updateChipsDisplay();
                        }
                    } else if (WardrobeSystem.getEquipped() !== o.id) {
                        WardrobeSystem.equip(o.id);
                    }
                    return null;
                }
            }
            return null;
        }

        return this.getClickedTable(mouseX, mouseY);
    }

    _getTabRects() {
        return {
            tables:   { x: 65,  y: 178, w: 115, h: 30 },
            wardrobe: { x: 190, y: 178, w: 115, h: 30 },
            cashier:  { x: 315, y: 178, w: 115, h: 30 },
            stats:    { x: 440, y: 178, w: 115, h: 30 }
        };
    }

    render(ctx) {
        this._drawRoom(ctx);
        this._drawTitle(ctx);
        this._drawTabBar(ctx);
        if (this.activeTab === 'tables') {
            this._drawSectionLabels(ctx);
            this._drawPanels(ctx);
        } else if (this.activeTab === 'wardrobe') {
            this._drawWardrobe(ctx);
        } else if (this.activeTab === 'cashier') {
            this._drawCashier(ctx);
        } else if (this.activeTab === 'stats') {
            this._drawStatsPanel(ctx);
        }
        this._drawFooter(ctx);
    }

    // ── Background room ───────────────────────────────────────────────────────

    _drawRoom(ctx) {
        const W = C.WIDTH, H = C.HEIGHT;
        const t = this.time;

        // Overall background
        ctx.fillStyle = '#07020a';
        ctx.fillRect(0, 0, W, H);

        // Ceiling with subtle radial glow
        const ceil = ctx.createLinearGradient(0, 0, 0, 170);
        ceil.addColorStop(0, '#0d0310');
        ceil.addColorStop(1, '#1a0820');
        ctx.fillStyle = ceil;
        ctx.fillRect(0, 0, W, 170);

        // Ceiling spotlights
        const spots = [
            { x: W * 0.2, y: 80, color: 'rgba(255,100,100,0.15)' },
            { x: W * 0.5, y: 70, color: 'rgba(100,150,255,0.12)' },
            { x: W * 0.8, y: 85, color: 'rgba(150,200,255,0.14)' }
        ];
        for (const spot of spots) {
            const radial = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, 180);
            radial.addColorStop(0, spot.color);
            radial.addColorStop(1, 'transparent');
            ctx.fillStyle = radial;
            ctx.fillRect(spot.x - 180, 0, 360, 200);
        }

        // Floor — perspective grid
        const floor = ctx.createLinearGradient(0, 170, 0, H);
        floor.addColorStop(0, '#140618');
        floor.addColorStop(1, '#060108');
        ctx.fillStyle = floor;
        ctx.fillRect(0, 170, W, H - 170);

        // Floor perspective lines with better detail (vanishing point center)
        const vpx = W / 2, vpy = 170;
        ctx.save();
        ctx.strokeStyle = 'rgba(200,168,75,0.08)';
        ctx.lineWidth = 1;

        // Horizontal lines with stronger perspective
        for (let i = 1; i <= 10; i++) {
            const t = i / 10;
            const y = 170 + t * t * t * (H - 170);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        // Converging lines
        for (let i = 0; i <= 16; i++) {
            const bx = (i / 16) * W;
            ctx.beginPath(); ctx.moveTo(vpx, vpy); ctx.lineTo(bx, H); ctx.stroke();
        }
        ctx.restore();

        // Horizon line / cornice
        ctx.strokeStyle = 'rgba(200,168,75,0.32)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 170); ctx.lineTo(W, 170); ctx.stroke();

        // Wall sconce lights on sides
        const sconces = [
            { x: 75, y: 120 },
            { x: 75, y: 280 },
            { x: W - 75, y: 120 },
            { x: W - 75, y: 280 }
        ];
        for (const sconce of sconces) {
            const glow = ctx.createRadialGradient(sconce.x, sconce.y, 0, sconce.x, sconce.y, 50);
            glow.addColorStop(0, `rgba(255,220,140,${0.12 + Math.sin(t * 1.5 + sconce.y * 0.01) * 0.06})`);
            glow.addColorStop(1, 'transparent');
            ctx.fillStyle = glow;
            ctx.fillRect(sconce.x - 50, sconce.y - 50, 100, 100);
        }

        // Particle effects (floating dust/sparkle motes)
        ctx.save();
        for (let i = 0; i < 12; i++) {
            const px = (vpx + Math.sin(t * 0.3 + i * 0.5) * 300) % W;
            const py = (170 + Math.sin(t * 0.25 + i * 0.4) * 200 + i * 50) % (H - 170) + 170;
            const opacity = 0.15 + Math.sin(t * 0.8 + i) * 0.1;
            ctx.fillStyle = `rgba(255,235,180,${opacity})`;
            ctx.beginPath(); ctx.arc(px, py, 1.5 + Math.sin(t * 2 + i) * 0.8, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // Wall fade on sides
        const lw = ctx.createLinearGradient(0, 0, 60, 0);
        lw.addColorStop(0, 'rgba(0,0,0,0.85)'); lw.addColorStop(1, 'transparent');
        ctx.fillStyle = lw; ctx.fillRect(0, 0, 60, H);

        const rw = ctx.createLinearGradient(W - 60, 0, W, 0);
        rw.addColorStop(0, 'transparent'); rw.addColorStop(1, 'rgba(0,0,0,0.85)');
        ctx.fillStyle = rw; ctx.fillRect(W - 60, 0, 60, H);

        // Gold wall trim (more prominent)
        ctx.save();
        ctx.strokeStyle = 'rgba(200,168,75,0.25)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(60, 175, W - 120, H - 185);
        ctx.restore();

        // Chandeliers
        this._drawChandeliers(ctx);
    }

    _drawChandeliers(ctx) {
        const t = this.time;
        const cxs = [200, 600, 1000];
        for (const cx of cxs) {
            // Soft ambient glow on ceiling (larger and more dynamic)
            const glowIntensity = 0.14 + Math.sin(t * 0.9 + cx * 0.01) * 0.035;
            const glow = ctx.createRadialGradient(cx, 80, 0, cx, 80, 140);
            glow.addColorStop(0, `rgba(255,235,160,${glowIntensity})`);
            glow.addColorStop(0.5, `rgba(255,200,100,${glowIntensity * 0.5})`);
            glow.addColorStop(1, 'transparent');
            ctx.fillStyle = glow;
            ctx.fillRect(cx - 140, 0, 280, 220);

            // Drop rod (more elegant, thinner)
            ctx.strokeStyle = 'rgba(200,168,75,0.5)';
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, 56); ctx.stroke();

            // Rod ornaments (decorative balls)
            ctx.fillStyle = 'rgba(200,168,75,0.6)';
            ctx.beginPath(); ctx.arc(cx, 20, 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx, 40, 2, 0, Math.PI * 2); ctx.fill();

            // Fixture (more detailed)
            ctx.save();
            ctx.shadowColor = 'rgba(255,220,100,0.9)';
            ctx.shadowBlur = 22 + Math.sin(t * 1.3) * 6;
            ctx.fillStyle = '#ffe080';
            ctx.beginPath(); ctx.arc(cx, 60, 8, 0, Math.PI * 2); ctx.fill();

            // Fixture ring
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(cx, 60, 8, 0, Math.PI * 2); ctx.stroke();
            ctx.shadowBlur = 0;

            // Crystal arms (8 major arms, more detailed)
            for (let i = 0; i < 8; i++) {
                const ang = (i / 8) * Math.PI * 2;
                const len = 18 + Math.sin(t * 1.1 + i) * 3;
                const ex = cx + Math.cos(ang) * len;
                const ey = 60 + Math.sin(ang) * len;

                // Main arm
                ctx.strokeStyle = 'rgba(255,240,180,0.4)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(cx, 60);
                ctx.lineTo(ex, ey);
                ctx.stroke();

                // Crystal drop at end
                ctx.fillStyle = `rgba(255,240,200,${0.4 + Math.sin(t * 2.2 + i * 0.3) * 0.2})`;
                ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();

                // Crystal glow
                ctx.shadowColor = 'rgba(255,240,180,0.5)';
                ctx.shadowBlur = 8;
                ctx.strokeStyle = 'rgba(255,240,200,0.3)';
                ctx.lineWidth = 0.8;
                ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.stroke();
                ctx.shadowBlur = 0;
            }

            ctx.restore();
        }
    }

    _drawTitle(ctx) {
        ctx.save();
        const cx = C.WIDTH / 2;
        const t = this.time;

        // Ornate frame border — top and bottom
        ctx.strokeStyle = 'rgba(200,168,75,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - 320, 75); ctx.lineTo(cx + 320, 75); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 320, 155); ctx.lineTo(cx + 320, 155); ctx.stroke();

        // Decorative lines with extended reach
        ctx.strokeStyle = 'rgba(200,168,75,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - 290, 90); ctx.lineTo(cx - 18, 90); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 18, 90); ctx.lineTo(cx + 290, 90); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 290, 130); ctx.lineTo(cx - 18, 130); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 18, 130); ctx.lineTo(cx + 290, 130); ctx.stroke();

        // Corner ornaments
        ctx.fillStyle = '#d4af37';
        const corners = [[cx - 300, 75], [cx + 300, 75], [cx - 300, 155], [cx + 300, 155]];
        for (const [ox, oy] of corners) {
            ctx.save(); ctx.translate(ox, oy); ctx.rotate(Math.PI / 4);
            ctx.fillRect(-5, -5, 10, 10); ctx.restore();
        }

        // (diamond ornaments removed for cleaner look)

        // Shimmer glow on title
        const shimmer = 0.15 + Math.sin(t * 2.2) * 0.12;
        ctx.shadowColor = `rgba(255,235,160,${shimmer})`;
        ctx.shadowBlur = 32 + Math.sin(t * 1.8) * 8;

        // Title gradient
        const titleGrad = ctx.createLinearGradient(cx - 200, 115, cx + 200, 115);
        titleGrad.addColorStop(0, '#ffd700');
        titleGrad.addColorStop(0.5, '#ffe54c');
        titleGrad.addColorStop(1, '#ffd700');
        ctx.fillStyle = titleGrad;
        ctx.font = 'bold 42px Georgia';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText("KIEFER'S PALACE", cx, 115);

        // Subtle double stroke for depth
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(200,168,75,0.35)';
        ctx.lineWidth = 1.5;
        ctx.font = 'bold 42px Georgia';
        ctx.strokeText("KIEFER'S PALACE", cx, 115);

        // Larger, spaced subtitle
        ctx.font = 'bold 14px Georgia';
        ctx.fillStyle = 'rgba(212,175,55,0.7)';
        ctx.shadowColor = 'rgba(255,235,160,0.4)';
        ctx.shadowBlur = 10;
        ctx.fillText('— PREMIUM GAMING ROOMS —', cx, 147);
        ctx.restore();
    }

    _drawSectionLabels(ctx) {
        ctx.save();
        ctx.font = 'bold 14px Georgia';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Hold'em section label
        ctx.fillStyle = 'rgba(200,168,75,0.16)';
        ctx.fillRect(65, 218, 380, 20);
        ctx.fillStyle = 'rgba(212,175,55,0.85)';
        ctx.font = 'bold 12px Georgia';
        ctx.fillText("TEXAS HOLD'EM", 78, 228);

        // Decorative line extending from Hold'em
        ctx.strokeStyle = 'rgba(200,168,75,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(230, 228); ctx.lineTo(C.WIDTH - 65, 228); ctx.stroke();

        // More Games section label
        ctx.fillStyle = 'rgba(200,168,75,0.16)';
        ctx.fillRect(65, 416, 250, 20);
        ctx.fillStyle = 'rgba(212,175,55,0.85)';
        ctx.font = 'bold 12px Georgia';
        ctx.fillText('MORE GAMES', 78, 426);

        // Decorative line extending from More Games
        ctx.strokeStyle = 'rgba(200,168,75,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(210, 426); ctx.lineTo(C.WIDTH - 65, 426); ctx.stroke();

        // Divider between sections
        ctx.strokeStyle = 'rgba(200,168,75,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(65, 405); ctx.lineTo(C.WIDTH - 65, 405); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    _drawPanels(ctx) {
        for (const panel of this.panels) {
            this._drawPanel(ctx, panel);
        }
    }

    _drawPanel(ctx, panel) {
        const { x, y, w, h, cfg } = panel;
        const theme = C.THEMES[cfg.theme];
        const hovered = this.hoveredTable === cfg;
        const t = this.time;

        ctx.save();

        // Hover lift effect: increase shadow and slightly elevate
        const shadowBlur = hovered ? 32 + Math.sin(t * 3) * 4 : 12;
        const shadowOffsetY = hovered ? -3 : 0;
        ctx.shadowColor = hovered ? theme.glow : 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetY = shadowOffsetY;

        // Panel bg
        Utils.roundRect(ctx, x, y, w, h, 10);
        const bg = ctx.createLinearGradient(x, y, x, y + h);
        bg.addColorStop(0, hovered ? theme.felt : this._darken(theme.felt, 0.55));
        bg.addColorStop(1, this._darken(theme.felt, 0.85));
        ctx.fillStyle = bg;
        ctx.fill();

        // Hover gradient overlay
        if (hovered) {
            const overlay = ctx.createLinearGradient(x, y, x + w, y + h);
            overlay.addColorStop(0, `rgba(255,235,160,0.08)`);
            overlay.addColorStop(1, `rgba(200,168,75,0.04)`);
            ctx.fillStyle = overlay;
            Utils.roundRect(ctx, x, y, w, h, 10);
            ctx.fill();
        }

        // Border with glow on hover
        Utils.roundRect(ctx, x, y, w, h, 10);
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = hovered ? theme.trim : this._alpha(theme.trim, 0.35);
        ctx.lineWidth = hovered ? 3 : 1;
        ctx.stroke();

        // Animated glow border on hover
        if (hovered) {
            Utils.roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 10);
            ctx.strokeStyle = `rgba(255,235,160,${0.2 + Math.sin(t * 2.5) * 0.15})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Mini illustration
        const ox = x + 78, oy = y + h / 2 - 4;

        if (cfg.type === 'solitaire') {
            // Solitaire: stacked cards fanning out
            for (let i = 0; i < 4; i++) {
                const cx2 = ox - 20 + i * 14;
                const cy2 = oy - 18 + i * 4;
                Utils.drawMiniCard(ctx, cx2, cy2, 14, 20, i === 3);
            }
            // Foundation piles hint
            for (let i = 0; i < 4; i++) {
                ctx.strokeStyle = 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 1;
                ctx.strokeRect(ox + 22, oy - 22 + i * 10, 10, 14);
            }
        } else if (cfg.type === 'blackjack') {
            // Blackjack: two hands of cards
            const woodGrad = ctx.createRadialGradient(ox - 15, oy - 10, 2, ox, oy, 68);
            woodGrad.addColorStop(0, '#8b5e1a');
            woodGrad.addColorStop(1, theme.wood);
            Utils.fillEllipse(ctx, ox, oy, 68, 42, woodGrad);
            Utils.fillEllipse(ctx, ox, oy, 58, 35, theme.felt);
            // Dealer cards
            Utils.drawMiniCard(ctx, ox - 14, oy - 22, 12, 17, false);
            Utils.drawMiniCard(ctx, ox + 2, oy - 22, 12, 17, true);
            // Player cards
            Utils.drawMiniCard(ctx, ox - 14, oy + 4, 12, 17, true);
            Utils.drawMiniCard(ctx, ox + 2, oy + 4, 12, 17, true);
        } else {
            // Poker: table oval with community cards
            const woodGrad = ctx.createRadialGradient(ox - 15, oy - 10, 2, ox, oy, 68);
            woodGrad.addColorStop(0, '#8b5e1a');
            woodGrad.addColorStop(1, theme.wood);
            Utils.fillEllipse(ctx, ox, oy, 68, 42, woodGrad);
            Utils.fillEllipse(ctx, ox, oy, 58, 35, theme.felt);
            Utils.strokeEllipse(ctx, ox, oy, 48, 28, 'rgba(255,255,255,0.12)', 1.5);
            for (let i = 0; i < 3; i++) {
                Utils.drawMiniCard(ctx, ox - 18 + i * 16, oy - 10, 12, 17, false);
            }
        }

        // Text block
        const tx = x + 152;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        // Theme name
        ctx.font = 'bold 16px Georgia';
        ctx.fillStyle = theme.label;
        if (hovered) { ctx.shadowColor = theme.glow; ctx.shadowBlur = 10; }
        ctx.fillText(theme.name, tx, y + 14);
        ctx.shadowBlur = 0;

        // Game type label
        const typeLabels = {
            holdem: "Texas Hold'em",
            blackjack: 'Blackjack',
            solitaire: 'Klondike Solitaire'
        };
        ctx.font = '12px Georgia';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(typeLabels[cfg.type] || cfg.type, tx, y + 36);

        if (cfg.type === 'holdem') {
            // Stars for poker difficulty
            const numStars = { beginner: 1, intermediate: 2, expert: 3 }[cfg.difficulty];
            const starColor = { beginner: '#cd7f32', intermediate: '#c0c0c0', expert: '#ffd700' }[cfg.difficulty];
            ctx.font = '18px Arial';
            ctx.fillStyle = starColor;
            ctx.fillText('\u2605'.repeat(numStars) + '\u2606'.repeat(3 - numStars), tx, y + 54);

            const diffName = cfg.difficulty.charAt(0).toUpperCase() + cfg.difficulty.slice(1);
            ctx.font = '12px Georgia';
            ctx.fillStyle = starColor;
            ctx.fillText(diffName, tx, y + 76);

            ctx.font = '11px Georgia';
            ctx.fillStyle = 'rgba(200,235,255,0.85)';
            ctx.fillText(`\uD83D\uDC65 ${cfg.numAI}-${cfg.numAI + 2} players`, tx, y + 92);

            ctx.fillStyle = 'rgba(210,210,210,0.8)';
            ctx.font = '11px Georgia';
            ctx.fillText(`Buy-in $${cfg.buyIn}  \u00B7  $${cfg.smallBlind}/$${cfg.bigBlind}`, tx, y + 107);
        } else if (cfg.type === 'blackjack') {
            ctx.font = '13px Georgia';
            ctx.fillStyle = 'rgba(255,233,168,0.8)';
            ctx.fillText('Beat the dealer to 21', tx, y + 56);

            ctx.font = '11px Georgia';
            ctx.fillStyle = 'rgba(200,235,255,0.85)';
            ctx.fillText(`\uD83C\uDCCF Bet $${cfg.minBet}\u2013$${cfg.maxBet}`, tx, y + 78);

            ctx.fillStyle = 'rgba(210,210,210,0.8)';
            ctx.fillText(`Buy-in $${cfg.buyIn}  \u00B7  Blackjack pays 3:2`, tx, y + 96);

            ctx.font = '11px Georgia';
            ctx.fillStyle = 'rgba(200,200,200,0.55)';
            ctx.fillText('Hit, Stand, Double Down', tx, y + 114);
        } else if (cfg.type === 'solitaire') {
            ctx.font = '13px Georgia';
            ctx.fillStyle = 'rgba(255,233,168,0.8)';
            ctx.fillText('Vegas-style scoring', tx, y + 56);

            ctx.font = '11px Georgia';
            ctx.fillStyle = 'rgba(200,235,255,0.85)';
            ctx.fillText('\u2660\u2665\u2666\u2663 Earn $5 per card to foundation', tx, y + 78);

            ctx.fillStyle = 'rgba(210,210,210,0.8)';
            ctx.fillText(`Cost: $${cfg.buyIn} per game`, tx, y + 96);

            ctx.font = '11px Georgia';
            ctx.fillStyle = 'rgba(200,200,200,0.55)';
            ctx.fillText('Classic Klondike rules', tx, y + 114);
        }

        // PLAY button-like element on hover
        if (hovered) {
            const btnX = x + w - 66, btnY = y + h - 28;
            const btnW = 52, btnH = 24;

            // Button background with gradient
            const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX, btnY + btnH);
            btnGrad.addColorStop(0, theme.glow);
            btnGrad.addColorStop(1, this._darken(theme.glow, 0.3));
            Utils.roundRect(ctx, btnX, btnY, btnW, btnH, 5);
            ctx.fillStyle = btnGrad;
            ctx.fill();

            // Button border
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Button text
            ctx.font = 'bold 12px Georgia';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('PLAY', btnX + btnW / 2, btnY + btnH / 2);
        }

        ctx.restore();
    }

    _drawStatsPanel(ctx) {
        const stats = KieferSave.getStats();
        const W = C.WIDTH;
        // Full-width stats display when it's its own tab
        const px = 80, py = 250, pw = W - 160, ph = 400;

        ctx.save();

        // Panel background
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,168,75,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 12);
        ctx.stroke();

        // Title
        ctx.font = 'bold 13px Georgia';
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('ALL-TIME STATS', px + pw / 2, py + 10);

        // Divider
        ctx.strokeStyle = 'rgba(200,168,75,0.2)';
        ctx.beginPath();
        ctx.moveTo(px + 15, py + 30);
        ctx.lineTo(px + pw - 15, py + 30);
        ctx.stroke();

        // Net profit (big number)
        const net = stats.netProfit;
        const netColor = net > 0 ? '#4caf50' : net < 0 ? '#ef5350' : 'rgba(255,255,255,0.6)';
        const netSign = net > 0 ? '+' : '';
        ctx.font = 'bold 22px Georgia';
        ctx.fillStyle = netColor;
        ctx.fillText(`${netSign}$${Math.abs(net).toLocaleString()}`, px + pw / 2, py + 38);

        ctx.font = '10px Georgia';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('NET PROFIT', px + pw / 2, py + 64);

        // Stats rows
        const rows = [
            { label: 'Sessions', value: stats.sessionsPlayed.toString() },
            { label: 'Total Won', value: '$' + stats.totalWon.toLocaleString(), color: '#4caf50' },
            { label: 'Total Lost', value: '$' + stats.totalLost.toLocaleString(), color: '#ef5350' },
            { label: 'Biggest Win', value: '$' + stats.biggestWin.toLocaleString(), color: '#ffd700' },
            { label: 'Peak Chips', value: '$' + stats.peakChips.toLocaleString() }
        ];

        let rowY = py + 82;
        ctx.textAlign = 'left';
        for (const row of rows) {
            ctx.font = '11px Georgia';
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.textBaseline = 'middle';
            ctx.fillText(row.label, px + 15, rowY);

            ctx.textAlign = 'right';
            ctx.fillStyle = row.color || 'rgba(255,255,255,0.7)';
            ctx.fillText(row.value, px + pw - 15, rowY);
            ctx.textAlign = 'left';

            rowY += 19;
        }

        // Per-game breakdown (small, at bottom)
        rowY += 4;
        ctx.strokeStyle = 'rgba(200,168,75,0.15)';
        ctx.beginPath();
        ctx.moveTo(px + 15, rowY - 8);
        ctx.lineTo(px + pw - 15, rowY - 8);
        ctx.stroke();

        const games = [
            { label: 'Poker', net: stats.pokerNet, sessions: stats.pokerSessions },
            { label: 'BJ', net: stats.bjNet, sessions: stats.bjSessions },
            { label: 'Sol', net: stats.solNet, sessions: stats.solSessions }
        ];

        ctx.font = '10px Georgia';
        const segW = pw / 3;
        for (let i = 0; i < games.length; i++) {
            const g = games[i];
            const cx = px + segW * i + segW / 2;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillText(g.label, cx, rowY);

            const gNet = g.net;
            const gColor = gNet > 0 ? '#4caf50' : gNet < 0 ? '#ef5350' : 'rgba(255,255,255,0.4)';
            const gSign = gNet > 0 ? '+' : '';
            ctx.fillStyle = gColor;
            ctx.font = 'bold 11px Georgia';
            ctx.fillText(`${gSign}$${Math.abs(gNet)}`, cx, rowY + 14);
            ctx.font = '10px Georgia';
        }

        ctx.restore();
    }

    _drawFooter(ctx) {
        ctx.save();
        const W = C.WIDTH, H = C.HEIGHT;

        // Subtle gradient footer bar
        const footerGrad = ctx.createLinearGradient(0, H - 40, 0, H);
        footerGrad.addColorStop(0, 'rgba(0,0,0,0)');
        footerGrad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
        footerGrad.addColorStop(1, 'rgba(20,12,5,0.5)');
        ctx.fillStyle = footerGrad;
        ctx.fillRect(0, H - 40, W, 40);

        // Bottom border line
        ctx.strokeStyle = 'rgba(200,168,75,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, H - 40); ctx.lineTo(W, H - 40); ctx.stroke();

        // Footer text
        ctx.font = '13px Georgia';
        ctx.fillStyle = 'rgba(200,168,75,0.65)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const msg = this.activeTab === 'wardrobe'
            ? 'Buy outfits with your chips — Classic is always free'
            : this.activeTab === 'cashier'
            ? 'Claim your daily bonus or spin the wheel for more chips'
            : this.activeTab === 'stats'
            ? 'Your all-time casino performance'
            : 'Select any table to join the game';
        ctx.fillText(msg, W / 2, H - 20);
        ctx.restore();
    }

    _drawTabBar(ctx) {
        const tabs = this._getTabRects();
        const t = this.time;
        ctx.save();
        ctx.font         = 'bold 14px Georgia';
        ctx.textBaseline = 'middle';

        for (const [key, r] of Object.entries(tabs)) {
            const active = (this.activeTab === key);

            // Active tab shadow
            if (active) {
                ctx.shadowColor = 'rgba(200,168,75,0.8)';
                ctx.shadowBlur  = 18;
            }

            // Larger, more button-like tabs
            Utils.roundRect(ctx, r.x, r.y, r.w, r.h, 8);
            const bgGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
            if (active) {
                bgGrad.addColorStop(0, 'rgba(50,38,18,0.95)');
                bgGrad.addColorStop(1, 'rgba(35,25,10,0.95)');
            } else {
                bgGrad.addColorStop(0, 'rgba(15,10,8,0.7)');
                bgGrad.addColorStop(1, 'rgba(5,3,2,0.7)');
            }
            ctx.fillStyle = bgGrad;
            ctx.fill();

            // Border
            ctx.strokeStyle = active ? 'rgba(212,175,55,0.95)' : 'rgba(200,168,75,0.4)';
            ctx.lineWidth   = active ? 2.5 : 1.5;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Animated underline for active tab
            if (active) {
                const underlineY = r.y + r.h + 2;
                const underlineWidth = r.w * 0.7;
                const underlineX = r.x + (r.w - underlineWidth) / 2;
                ctx.strokeStyle = `rgba(212,175,55,${0.6 + Math.sin(t * 2.8) * 0.3})`;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(underlineX, underlineY);
                ctx.lineTo(underlineX + underlineWidth, underlineY);
                ctx.stroke();
            }

            // Tab text
            ctx.fillStyle = active ? '#ffd700' : 'rgba(200,168,75,0.65)';
            ctx.textAlign = 'center';
            let label;
            if (key === 'tables') label = 'TABLES';
            else if (key === 'wardrobe') label = 'WARDROBE';
            else if (key === 'cashier') label = 'CASHIER';
            else if (key === 'stats') label = 'STATS';
            ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
        }
        ctx.restore();
    }

    // ── Cashier ────────────────────────────────────────────────────────────────

    _getCashierRects() {
        const rects = {
            dailyBonus: { x: 65, y: 240, w: 300, h: 70 },
            spinBtn:    { x: 65, y: 320, w: 300, h: 50 }
        };
        // Card back buttons (below spin)
        const backs = C.CARD_BACKS;
        const cbY = 420, cbW = 90, cbH = 60, cbGap = 8;
        for (let i = 0; i < backs.length; i++) {
            rects['cb_' + backs[i].id] = { x: 65 + i * (cbW + cbGap), y: cbY, w: cbW, h: cbH };
        }
        // VIP table buttons
        const vipTables = C.VIP_TABLES;
        const vipY = 545, vipW = 240, vipH = 65, vipGap = 12;
        for (let i = 0; i < vipTables.length; i++) {
            rects['vip_' + vipTables[i].id] = { x: 65 + i * (vipW + vipGap), y: vipY, w: vipW, h: vipH };
        }
        return rects;
    }

    _handleCashierClick(mx, my, game) {
        const rects = this._getCashierRects();
        const hit = (r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;

        // Daily bonus
        if (hit(rects.dailyBonus)) {
            if (KieferSave.canClaimDailyBonus()) {
                KieferSave.claimDailyBonus(500);
                game.playerChips = KieferSave.getChips();
                game._updateChipsDisplay();
                this.dailyBonusClaimed = true;
                this.dailyBonusFlash = 2.0;
                if (typeof Sounds !== 'undefined') Sounds.play('chip');
            }
            return;
        }

        // Spin the wheel
        if (hit(rects.spinBtn) && !this.wheelSpinning) {
            if (KieferSave.canSpin()) {
                this.wheelSpinning = true;
                this.wheelResult = null;
                this.wheelSpeed = 12 + Math.random() * 6;
                KieferSave.recordSpin();
            }
            return;
        }

        // Card back purchases / equip
        for (const back of C.CARD_BACKS) {
            const key = 'cb_' + back.id;
            if (rects[key] && hit(rects[key])) {
                if (KieferSave.isCardBackUnlocked(back.id)) {
                    KieferSave.setCardBack(back.id);
                } else if (back.cost > 0) {
                    if (KieferSave.buyCardBack(back.id, back.cost)) {
                        KieferSave.setCardBack(back.id);
                        game.playerChips = KieferSave.getChips();
                        game._updateChipsDisplay();
                        if (typeof Sounds !== 'undefined') Sounds.play('chip');
                    }
                }
                return;
            }
        }

        // VIP table unlock or play
        for (const vt of C.VIP_TABLES) {
            const key = 'vip_' + vt.id;
            if (rects[key] && hit(rects[key])) {
                if (KieferSave.isVIPUnlocked(vt.id)) {
                    // Open buy-in for this VIP table
                    game._showBuyInModal(vt);
                } else {
                    if (KieferSave.buyVIPTable(vt.id, vt.unlockCost)) {
                        game.playerChips = KieferSave.getChips();
                        game._updateChipsDisplay();
                        if (typeof Sounds !== 'undefined') Sounds.play('chip');
                    }
                }
                return;
            }
        }
    }

    _updateWheel(dt) {
        if (!this.wheelSpinning) return;

        this.wheelAngle += this.wheelSpeed * dt;
        this.wheelSpeed *= 0.985; // friction

        if (this.wheelSpeed < 0.15) {
            this.wheelSpinning = false;
            this.wheelSpeed = 0;

            // Determine winning segment — pointer is at top (-π/2)
            const seg = this.wheelSegments.length;
            const sliceAngle = (Math.PI * 2) / seg;
            const pointerAngle = -Math.PI / 2;  // top of wheel
            // Calculate which segment is currently at the pointer position
            let normalizedAngle = (pointerAngle - this.wheelAngle) % (Math.PI * 2);
            if (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
            const idx = Math.floor(normalizedAngle / sliceAngle) % seg;
            const won = this.wheelSegments[idx];

            this.wheelResult = { amount: won.amount, text: `+${won.label}` };
            this.wheelResultTimer = 3.0;

            // Award chips
            KieferSave.data.chips += won.amount;
            KieferSave.persist();
            this._wheelChipsNeedSync = true;
            if (typeof Sounds !== 'undefined') Sounds.play('chip');
        }
    }

    _drawCashier(ctx) {
        const W = C.WIDTH, H = C.HEIGHT;
        const t = this.time;

        // Section title
        ctx.save();
        ctx.font = 'bold 22px Georgia';
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('CASHIER', 65, 218);
        ctx.restore();

        // ─── Daily Bonus Card ───
        const rects = this._getCashierRects();
        const db = rects.dailyBonus;
        const canClaim = KieferSave.canClaimDailyBonus();
        const dbHover = this.cashierHover === 'dailyBonus';

        ctx.save();
        if (this.dailyBonusFlash > 0) {
            ctx.shadowColor = 'rgba(76,175,80,0.8)';
            ctx.shadowBlur = 20;
        } else if (dbHover && canClaim) {
            ctx.shadowColor = 'rgba(200,168,75,0.5)';
            ctx.shadowBlur = 12;
        }

        Utils.roundRect(ctx, db.x, db.y, db.w, db.h, 12);
        const dbGrad = ctx.createLinearGradient(db.x, db.y, db.x, db.y + db.h);
        if (this.dailyBonusFlash > 0) {
            dbGrad.addColorStop(0, 'rgba(20,80,20,0.95)');
            dbGrad.addColorStop(1, 'rgba(10,50,10,0.95)');
        } else {
            dbGrad.addColorStop(0, 'rgba(30,22,10,0.95)');
            dbGrad.addColorStop(1, 'rgba(15,10,5,0.95)');
        }
        ctx.fillStyle = dbGrad;
        ctx.fill();
        ctx.strokeStyle = canClaim ? 'rgba(212,175,55,0.9)' : 'rgba(100,80,40,0.5)';
        ctx.lineWidth = canClaim ? 2 : 1;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Icon
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('🎁', db.x + 16, db.y + db.h / 2);

        // Text
        ctx.font = 'bold 18px Georgia';
        ctx.fillStyle = canClaim ? '#ffd700' : 'rgba(200,168,75,0.4)';
        ctx.textAlign = 'left';
        if (this.dailyBonusFlash > 0) {
            ctx.fillStyle = '#4caf50';
            ctx.fillText('+$500 Claimed!', db.x + 60, db.y + 28);
        } else if (canClaim) {
            ctx.fillText('Daily Bonus — $500', db.x + 60, db.y + 28);
        } else {
            ctx.fillText('Daily Bonus — Claimed', db.x + 60, db.y + 28);
        }

        ctx.font = '13px Georgia';
        ctx.fillStyle = canClaim ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
        const subText = canClaim ? 'Click to claim your free daily chips!'
            : 'Come back tomorrow for another bonus';
        ctx.fillText(subText, db.x + 60, db.y + 52);
        ctx.restore();

        // ─── Spin the Wheel ───
        const wheelCX = 750, wheelCY = 390, wheelR = 150;
        const canSpin = KieferSave.canSpin() && !this.wheelSpinning;
        const seg = this.wheelSegments.length;
        const sliceAngle = (Math.PI * 2) / seg;

        // Draw wheel
        ctx.save();
        ctx.translate(wheelCX, wheelCY);
        ctx.rotate(this.wheelAngle);

        for (let i = 0; i < seg; i++) {
            const startA = i * sliceAngle;
            const endA = startA + sliceAngle;

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, wheelR, startA, endA);
            ctx.closePath();
            ctx.fillStyle = this.wheelSegments[i].color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Label
            ctx.save();
            ctx.rotate(startA + sliceAngle / 2);
            ctx.translate(wheelR * 0.65, 0);
            ctx.rotate(Math.PI / 2);
            ctx.font = 'bold 13px Georgia';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.wheelSegments[i].label, 0, 0);
            ctx.restore();
        }

        // Center cap
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a1a';
        ctx.fill();
        ctx.strokeStyle = '#c8a84b';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.font = 'bold 11px Georgia';
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SPIN', 0, 0);

        ctx.restore();

        // Outer ring
        ctx.save();
        ctx.beginPath();
        ctx.arc(wheelCX, wheelCY, wheelR + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200,168,75,0.6)';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Tick marks on outer ring
        for (let i = 0; i < seg * 2; i++) {
            const a = (i / (seg * 2)) * Math.PI * 2 - Math.PI / 2;
            const x1 = wheelCX + Math.cos(a) * (wheelR + 2);
            const y1 = wheelCY + Math.sin(a) * (wheelR + 2);
            const x2 = wheelCX + Math.cos(a) * (wheelR + 10);
            const y2 = wheelCY + Math.sin(a) * (wheelR + 10);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = 'rgba(200,168,75,0.4)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();

        // Pointer (triangle at top)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(wheelCX, wheelCY - wheelR - 16);
        ctx.lineTo(wheelCX - 12, wheelCY - wheelR - 30);
        ctx.lineTo(wheelCX + 12, wheelCY - wheelR - 30);
        ctx.closePath();
        ctx.fillStyle = '#ffd700';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Wheel title
        ctx.save();
        ctx.font = 'bold 18px Georgia';
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center';
        ctx.fillText('SPIN THE WHEEL', wheelCX, wheelCY - wheelR - 40);
        ctx.restore();

        // Spin button
        const sb = rects.spinBtn;
        const spinHover = this.cashierHover === 'spinBtn';
        ctx.save();
        if (spinHover && canSpin) {
            ctx.shadowColor = 'rgba(200,168,75,0.5)';
            ctx.shadowBlur = 12;
        }
        Utils.roundRect(ctx, sb.x, sb.y, sb.w, sb.h, 10);
        const sbGrad = ctx.createLinearGradient(sb.x, sb.y, sb.x, sb.y + sb.h);
        if (canSpin) {
            sbGrad.addColorStop(0, 'rgba(40,28,5,0.95)');
            sbGrad.addColorStop(1, 'rgba(20,14,2,0.95)');
        } else {
            sbGrad.addColorStop(0, 'rgba(20,15,8,0.7)');
            sbGrad.addColorStop(1, 'rgba(10,8,4,0.7)');
        }
        ctx.fillStyle = sbGrad;
        ctx.fill();
        ctx.strokeStyle = canSpin ? 'rgba(212,175,55,0.9)' : 'rgba(100,80,40,0.4)';
        ctx.lineWidth = canSpin ? 2 : 1;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.font = 'bold 16px Georgia';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (this.wheelSpinning) {
            ctx.fillStyle = 'rgba(255,215,0,0.6)';
            ctx.fillText('Spinning...', sb.x + sb.w / 2, sb.y + sb.h / 2);
        } else if (canSpin) {
            ctx.fillStyle = '#ffd700';
            ctx.fillText('🎰  SPIN  🎰', sb.x + sb.w / 2, sb.y + sb.h / 2);
        } else {
            // Show cooldown
            const rem = KieferSave.getSpinCooldownRemaining();
            const hrs = Math.floor(rem / 3600000);
            const mins = Math.floor((rem % 3600000) / 60000);
            ctx.fillStyle = 'rgba(200,168,75,0.4)';
            ctx.fillText(`Next spin in ${hrs}h ${mins}m`, sb.x + sb.w / 2, sb.y + sb.h / 2);
        }
        ctx.restore();

        // Result popup
        if (this.wheelResult && this.wheelResultTimer > 0) {
            const alpha = Math.min(1, this.wheelResultTimer);
            const scale = 1 + (1 - Math.min(1, this.wheelResultTimer * 3)) * 0.2;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(wheelCX, wheelCY);
            ctx.scale(scale, scale);

            ctx.fillStyle = 'rgba(0,0,0,0.8)';
            ctx.beginPath();
            ctx.roundRect(-90, -30, 180, 60, 14);
            ctx.fill();
            ctx.strokeStyle = '#4caf50';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(-90, -30, 180, 60, 14);
            ctx.stroke();

            ctx.font = 'bold 26px Georgia';
            ctx.fillStyle = '#4caf50';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.wheelResult.text, 0, 0);

            ctx.restore();
        }

        // ─── Card Backs Shop ───
        ctx.save();
        ctx.font = 'bold 16px Georgia';
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('CARD BACKS', 65, 398);
        ctx.restore();

        const activeBack = KieferSave.getCardBack();
        for (const back of C.CARD_BACKS) {
            const r = rects['cb_' + back.id];
            if (!r) continue;
            const unlocked = KieferSave.isCardBackUnlocked(back.id);
            const isActive = activeBack === back.id;
            const hover = this.cashierHover === 'cb_' + back.id;

            ctx.save();
            if (isActive) {
                ctx.shadowColor = 'rgba(255,215,0,0.6)';
                ctx.shadowBlur = 10;
            } else if (hover) {
                ctx.shadowColor = 'rgba(200,168,75,0.3)';
                ctx.shadowBlur = 8;
            }

            // Card back preview
            Utils.roundRect(ctx, r.x, r.y, r.w, r.h, 6);
            ctx.fillStyle = back.color;
            ctx.fill();
            ctx.strokeStyle = isActive ? '#ffd700' : (unlocked ? back.accent : 'rgba(255,255,255,0.15)');
            ctx.lineWidth = isActive ? 2.5 : 1;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Pattern preview
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            for (let py = r.y + 4; py < r.y + r.h - 4; py += 5) {
                for (let px = r.x + 4; px < r.x + r.w - 4; px += 5) {
                    ctx.fillRect(px, py, 2.5, 2.5);
                }
            }

            // Label below
            ctx.font = '9px Georgia';
            ctx.fillStyle = isActive ? '#ffd700' : 'rgba(255,255,255,0.5)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(back.name, r.x + r.w / 2, r.y + r.h + 3);

            if (!unlocked && back.cost > 0) {
                // Price tag overlay
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                Utils.roundRect(ctx, r.x, r.y + r.h - 18, r.w, 18, 4);
                ctx.fill();
                ctx.font = 'bold 10px Georgia';
                ctx.fillStyle = '#ffd700';
                ctx.textBaseline = 'middle';
                ctx.fillText('$' + back.cost, r.x + r.w / 2, r.y + r.h - 9);
            } else if (isActive) {
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                Utils.roundRect(ctx, r.x, r.y + r.h - 18, r.w, 18, 4);
                ctx.fill();
                ctx.font = 'bold 10px Georgia';
                ctx.fillStyle = '#4caf50';
                ctx.textBaseline = 'middle';
                ctx.fillText('EQUIPPED', r.x + r.w / 2, r.y + r.h - 9);
            }

            ctx.restore();
        }

        // ─── VIP Room ───
        ctx.save();
        ctx.font = 'bold 16px Georgia';
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('VIP ROOM', 65, 520);
        ctx.font = '11px Georgia';
        ctx.fillStyle = 'rgba(200,168,75,0.5)';
        ctx.fillText('Unlock exclusive high-stakes tables', 160, 523);
        ctx.restore();

        for (const vt of C.VIP_TABLES) {
            const r = rects['vip_' + vt.id];
            if (!r) continue;
            const unlocked = KieferSave.isVIPUnlocked(vt.id);
            const hover = this.cashierHover === 'vip_' + vt.id;

            ctx.save();
            if (hover) {
                ctx.shadowColor = unlocked ? 'rgba(0,229,255,0.4)' : 'rgba(200,168,75,0.3)';
                ctx.shadowBlur = 10;
            }

            Utils.roundRect(ctx, r.x, r.y, r.w, r.h, 10);
            const vtGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
            if (unlocked) {
                vtGrad.addColorStop(0, 'rgba(5,5,30,0.95)');
                vtGrad.addColorStop(1, 'rgba(3,3,15,0.95)');
            } else {
                vtGrad.addColorStop(0, 'rgba(20,15,8,0.85)');
                vtGrad.addColorStop(1, 'rgba(10,8,4,0.85)');
            }
            ctx.fillStyle = vtGrad;
            ctx.fill();
            ctx.strokeStyle = unlocked ? '#00e5ff' : 'rgba(200,168,75,0.5)';
            ctx.lineWidth = unlocked ? 2 : 1;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Lock/star icon
            ctx.font = '22px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(unlocked ? '⭐' : '🔒', r.x + 12, r.y + r.h / 2);

            // Table info
            ctx.font = 'bold 15px Georgia';
            ctx.fillStyle = unlocked ? '#00e5ff' : '#ffd700';
            ctx.textAlign = 'left';
            ctx.fillText(vt.label, r.x + 44, r.y + 20);

            ctx.font = '12px Georgia';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText(vt.subLabel, r.x + 44, r.y + 38);

            if (!unlocked) {
                ctx.font = 'bold 12px Georgia';
                ctx.fillStyle = '#ffd700';
                ctx.textAlign = 'right';
                ctx.fillText('$' + vt.unlockCost.toLocaleString() + ' to unlock', r.x + r.w - 12, r.y + r.h / 2);
            } else {
                ctx.font = 'bold 11px Georgia';
                ctx.fillStyle = '#4caf50';
                ctx.textAlign = 'right';
                ctx.fillText('UNLOCKED ✓', r.x + r.w - 12, r.y + r.h / 2);
            }

            ctx.restore();
        }
    }

    _buildOutfitGrid() {
        const cells = [];
        const ox = 58, oy = 230, cw = 255, ch = 195;
        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < 4; c++) {
                const outfit = WardrobeSystem.OUTFITS[r * 4 + c];
                const x = ox + c * cw;
                const y = oy + r * ch;
                const pad = 6;
                cells.push({
                    outfit,
                    x: x + pad,
                    y: y + pad,
                    w: cw - pad * 2,
                    h: ch - pad * 2,
                    bx: x + 28,
                    by: y + ch - 48,
                    bw: cw - 56,
                    bh: 34
                });
            }
        }
        return cells;
    }

    _drawWardrobe(ctx) {
        ctx.save();
        ctx.font         = 'bold 16px Georgia';
        ctx.fillStyle    = 'rgba(200,168,75,0.88)';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Your wardrobe', 65, 206);

        for (const cell of this._outfitCells) {
            this._drawOutfitCard(ctx, cell);
        }
        ctx.restore();
    }

    _drawMiniCharacter(ctx, cx, cy, r, colors) {
        Utils.drawSeatedCharacter(ctx, cx, cy, r, colors, false);
    }

    _drawOutfitCard(ctx, cell) {
        const { outfit, x, y, w, h, bx, by, bw, bh } = cell;
        const hot    = this.wardrobeHoverId === outfit.id;
        const owned  = WardrobeSystem.isUnlocked(outfit.id);
        const worn   = WardrobeSystem.getEquipped() === outfit.id;

        ctx.save();
        Utils.roundRect(ctx, x, y, w, h, 10);
        ctx.fillStyle = hot ? 'rgba(32,24,18,0.94)' : 'rgba(14,10,8,0.9)';
        ctx.fill();
        ctx.strokeStyle = hot ? 'rgba(200,168,75,0.55)' : 'rgba(200,168,75,0.22)';
        ctx.lineWidth = hot ? 2 : 1;
        ctx.stroke();

        const cols = {
            shirtColor: outfit.shirtColor,
            hairColor:  outfit.hairColor,
            skinColor:  outfit.skinColor
        };
        this._drawMiniCharacter(ctx, x + w / 2, y + 72, 32, cols);

        ctx.font      = 'bold 14px Georgia';
        ctx.fillStyle = '#f0e6d2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(outfit.name, x + w / 2, y + 12);

        let btnLabel;
        if (!owned) btnLabel = outfit.price === 0 ? 'Free' : `Buy $${outfit.price}`;
        else if (worn) btnLabel = 'Equipped';
        else btnLabel = 'Equip';

        Utils.roundRect(ctx, bx, by, bw, bh, 6);
        ctx.fillStyle   = owned && worn ? 'rgba(30,70,30,0.85)' : 'rgba(70,50,10,0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,168,75,0.5)';
        ctx.lineWidth   = 1;
        ctx.stroke();

        ctx.font         = 'bold 12px Georgia';
        ctx.fillStyle    = '#f5d76e';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(btnLabel, bx + bw / 2, by + bh / 2);
        ctx.restore();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    _darken(hex, factor) {
        return `rgba(0,0,0,${factor})`;
    }

    _alpha(hex, alpha) {
        // Convert hex to rgba
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!r) return hex;
        return `rgba(${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)},${alpha})`;
    }
}
