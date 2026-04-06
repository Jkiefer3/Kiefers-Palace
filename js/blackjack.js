'use strict';

class BlackjackGame {
    constructor(tableCfg, playerChips) {
        this.cfg = tableCfg;
        this.theme = C.THEMES[tableCfg.theme];
        this.playerChips = playerChips;
        this.minBet = tableCfg.minBet || 5;
        this.maxBet = tableCfg.maxBet || 500;

        // State: betting | dealing | playing | dealer_turn | dealer_drawing | result | hand_over
        this.state = 'betting';
        this.pauseTimer = 0;
        this.time = 0;

        // Deck (6-deck shoe)
        this.shoe = [];
        this._buildShoe(6);

        // Hands — cards now have animated positions
        this.playerHand = [];
        this.dealerHand = [];
        this.currentBet = this.minBet;
        this.doubledDown = false;

        // Result
        this.resultText = '';
        this.resultAmount = 0;
        this.resultType = '';

        // Win/loss streak
        this.streak = 0;

        // ── Animation systems ──────────────────────────────────────────────
        // Card flying animation queue
        this.cardAnims = []; // {card,hand,idx,startX,startY,endX,endY,progress,duration,flipAt,flipped}
        this.dealQueue = []; // cards waiting to be dealt
        this.dealDelay = 0;

        // Chip bet pile animation
        this.betChipPile = []; // {x,y,color,targetX,targetY,progress}
        this.winChipAnims = [];

        // Particles
        this.particles = [];

        // Screen shake
        this.shakeAmount = 0;
        this.shakeDuration = 0;

        // Hand value popups
        this.valuePopups = []; // {text,x,y,age,color}

        // Floating emojis
        this.floatingEmojis = [];
        this.emojiOptions = ['😎','🔥','😤','😂','💰','👏','🤯','💀'];
        this.emojiBarVisible = false;

        // Dealer "thinking" dots
        this.dealerThinking = false;
        this.dealerDotTimer = 0;

        // Bet chips selector
        this.betChips = [5, 10, 25, 50, 100];
        this.hoveredChip = -1;
        this.lastBetBounce = 0;

        // Card dimensions
        this.CARD_W = 76;
        this.CARD_H = 108;

        // Positions
        this.SHOE_X = C.WIDTH - 100;
        this.SHOE_Y = 60;
        this.DEALER_Y = 115;
        this.PLAYER_Y = C.HEIGHT - 260;
    }

    _buildShoe(numDecks) {
        this.shoe = [];
        const suits = ['\u2660','\u2665','\u2666','\u2663'];
        const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
        const values = [11,2,3,4,5,6,7,8,9,10,10,10,10];
        for (let d = 0; d < numDecks; d++) {
            for (let s = 0; s < 4; s++) {
                for (let r = 0; r < 13; r++) {
                    this.shoe.push({
                        rank: ranks[r], suit: suits[s], value: values[r],
                        isRed: s === 1 || s === 2, faceUp: true
                    });
                }
            }
        }
        for (let i = this.shoe.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shoe[i], this.shoe[j]] = [this.shoe[j], this.shoe[i]];
        }
    }

    _draw(faceUp) {
        if (this.shoe.length < 20) this._buildShoe(6);
        const card = this.shoe.pop();
        card.faceUp = faceUp !== false;
        return card;
    }

    _handValue(hand) {
        let total = 0, aces = 0;
        for (const c of hand) {
            if (!c.faceUp) continue;
            total += c.value;
            if (c.rank === 'A') aces++;
        }
        while (total > 21 && aces > 0) { total -= 10; aces--; }
        return total;
    }

    _isSoft(hand) {
        let total = 0, aces = 0;
        for (const c of hand) {
            if (!c.faceUp) continue;
            total += c.value;
            if (c.rank === 'A') aces++;
        }
        while (total > 21 && aces > 1) { total -= 10; aces--; }
        return aces > 0 && total <= 21;
    }

    _isBlackjack(hand) { return hand.length === 2 && this._handValue(hand) === 21; }
    _isBust(hand) { return this._handValue(hand) > 21; }

    // ── Card positions ───────────────────────────────────────────────────────

    _dealerCardX(i) {
        const cx = C.WIDTH / 2;
        const total = this.dealerHand.length;
        const spacing = Math.min(82, 280 / Math.max(total, 2));
        return cx - (total - 1) * spacing / 2 + i * spacing;
    }

    _playerCardX(i) {
        const cx = C.WIDTH / 2;
        const total = this.playerHand.length;
        const spacing = Math.min(82, 280 / Math.max(total, 2));
        return cx - (total - 1) * spacing / 2 + i * spacing;
    }

    // ── Animated deal ────────────────────────────────────────────────────────

    _animateDeal(card, hand, idx, faceUp, delay) {
        const isDealer = hand === 'dealer';
        const endX = isDealer ? this._dealerCardX(idx) : this._playerCardX(idx);
        const endY = isDealer ? this.DEALER_Y : this.PLAYER_Y;

        this.cardAnims.push({
            card, hand, idx,
            startX: this.SHOE_X, startY: this.SHOE_Y,
            endX, endY,
            progress: -delay, // negative = waiting
            duration: 0.35,
            flipAt: faceUp ? 0.5 : -1,
            flipped: !faceUp,
            rotation: 0,
            targetRotation: (Math.random() - 0.5) * 0.06
        });
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    placeBet(amount) {
        if (this.state !== 'betting') return;
        this.currentBet = Math.max(this.minBet, Math.min(amount, this.maxBet, this.playerChips));
        this._dealInitial();
    }

    increaseBet(chipVal) {
        if (this.state !== 'betting') return;
        const prev = this.currentBet;
        this.currentBet = Math.min(this.currentBet + chipVal, this.maxBet, this.playerChips);
        if (this.currentBet !== prev) {
            this.lastBetBounce = this.time;
            // Add chip to bet pile
            const cx = C.WIDTH / 2;
            const cy = C.HEIGHT / 2;
            const colors = ['#e53935','#43a047','#1976d2','#7b1fa2','#424242'];
            const ci = this.betChips.indexOf(chipVal);
            this.betChipPile.push({
                x: cx - 120 + ci * 60,
                y: cy + 80,
                targetX: cx + (Math.random() - 0.5) * 30,
                targetY: cy + 20 - this.betChipPile.length * 3,
                color: colors[ci] || '#e53935',
                progress: 0
            });
        }
    }

    _dealInitial() {
        this.playerHand = [];
        this.dealerHand = [];
        this.playerChips -= this.currentBet;
        this.doubledDown = false;
        this.resultText = '';
        this.resultAmount = 0;
        this.resultType = '';
        this.betChipPile = [];
        this.particles = [];
        this.valuePopups = [];
        this.cardAnims = [];
        this.emojiBarVisible = false;

        // Draw 4 cards
        const p1 = this._draw(true);
        const d1 = this._draw(true);
        const p2 = this._draw(true);
        const d2 = this._draw(false); // face-down

        this.playerHand.push(p1, p2);
        this.dealerHand.push(d1, d2);

        // Stagger the deal animations
        this._animateDeal(p1, 'player', 0, true, 0);
        this._animateDeal(d1, 'dealer', 0, true, 0.2);
        this._animateDeal(p2, 'player', 1, true, 0.4);
        this._animateDeal(d2, 'dealer', 1, false, 0.6);

        this.state = 'dealing';
        this.pauseTimer = 1.1; // wait for deal anim to finish

        if (typeof Sounds !== 'undefined') Sounds.play('card');
    }

    _afterDeal() {
        if (this._isBlackjack(this.playerHand)) {
            this.dealerHand[1].faceUp = true;
            this._spawnValuePopup(this._handValue(this.playerHand), false, true);
            if (this._isBlackjack(this.dealerHand)) {
                this._resolveResult('push', 0);
            } else {
                this._resolveResult('blackjack', Math.floor(this.currentBet * 1.5));
            }
            return;
        }
        this._spawnValuePopup(this._handValue(this.playerHand), false, false);
        this.state = 'playing';
    }

    hit() {
        if (this.state !== 'playing') return;
        const card = this._draw(true);
        this.playerHand.push(card);
        const idx = this.playerHand.length - 1;
        this._animateDeal(card, 'player', idx, true, 0);
        if (typeof Sounds !== 'undefined') Sounds.play('card');

        // Short delay before checking result
        setTimeout(() => {
            const val = this._handValue(this.playerHand);
            this._spawnValuePopup(val, false, val === 21);

            if (this._isBust(this.playerHand)) {
                this._shake(6, 0.3);
                this._resolveResult('bust', -this.currentBet);
            } else if (val === 21) {
                this.stand();
            }
        }, 350);
    }

    stand() {
        if (this.state !== 'playing') return;
        this.state = 'dealer_turn';
        this.dealerHand[1].faceUp = true;
        this.dealerThinking = true;
        this.pauseTimer = 0.7;
    }

    doubleDown() {
        if (this.state !== 'playing') return;
        if (this.playerHand.length !== 2) return;
        if (this.playerChips < this.currentBet) return;

        this.playerChips -= this.currentBet;
        this.currentBet *= 2;
        this.doubledDown = true;

        const card = this._draw(true);
        this.playerHand.push(card);
        this._animateDeal(card, 'player', 2, true, 0);
        if (typeof Sounds !== 'undefined') Sounds.play('chip');

        setTimeout(() => {
            if (this._isBust(this.playerHand)) {
                this._shake(6, 0.3);
                this._resolveResult('bust', -this.currentBet);
            } else {
                this.stand();
            }
        }, 400);
    }

    _doDealerDraw() {
        if (this._handValue(this.dealerHand) < 17) {
            const card = this._draw(true);
            this.dealerHand.push(card);
            const idx = this.dealerHand.length - 1;
            this._animateDeal(card, 'dealer', idx, true, 0);
            if (typeof Sounds !== 'undefined') Sounds.play('card');
            this.pauseTimer = 0.6;
            this.state = 'dealer_drawing';
            return;
        }
        this.dealerThinking = false;
        this._evaluateResult();
    }

    _evaluateResult() {
        const playerVal = this._handValue(this.playerHand);
        const dealerVal = this._handValue(this.dealerHand);

        this._spawnValuePopup(dealerVal, true, false);

        if (this._isBust(this.dealerHand)) {
            this._resolveResult('dealer_bust', this.currentBet);
        } else if (dealerVal > playerVal) {
            this._resolveResult('lose', -this.currentBet);
        } else if (dealerVal < playerVal) {
            this._resolveResult('win', this.currentBet);
        } else {
            this._resolveResult('push', 0);
        }
    }

    _resolveResult(type, amount) {
        this.state = 'result';
        this.pauseTimer = 3.0;
        this.resultAmount = amount;
        this.resultType = type;
        this.emojiBarVisible = true;
        this.dealerThinking = false;

        this.dealerHand[1].faceUp = true;

        if (type === 'blackjack') {
            this.resultText = 'BLACKJACK!';
            this.playerChips += this.currentBet + amount;
            this.streak = Math.max(1, this.streak + 1);
            this._spawnWinParticles(C.WIDTH / 2, this.PLAYER_Y, 20);
            this._shake(4, 0.2);
        } else if (type === 'bust') {
            this.resultText = 'BUST!';
            this.streak = Math.min(-1, this.streak - 1);
            this._shake(8, 0.4);
        } else if (type === 'dealer_bust') {
            this.resultText = 'Dealer busts!';
            this.playerChips += this.currentBet + amount;
            this.streak = Math.max(1, this.streak + 1);
            this._spawnWinParticles(C.WIDTH / 2, this.DEALER_Y + 60, 14);
        } else if (type === 'win') {
            this.resultText = 'You win!';
            this.playerChips += this.currentBet + amount;
            this.streak = Math.max(1, this.streak + 1);
            this._spawnWinParticles(C.WIDTH / 2, this.PLAYER_Y, 12);
        } else if (type === 'lose') {
            this.resultText = 'Dealer wins.';
            this.streak = Math.min(-1, this.streak - 1);
        } else if (type === 'push') {
            this.resultText = 'Push';
            this.playerChips += this.currentBet;
            this.streak = 0;
        }

        if (typeof Sounds !== 'undefined') {
            Sounds.play(amount > 0 ? 'win' : amount < 0 ? 'fold' : 'chip');
        }
    }

    newHand() {
        if (this.playerChips < this.minBet) return;
        this.playerHand = [];
        this.dealerHand = [];
        this.resultText = '';
        this.resultAmount = 0;
        this.resultType = '';
        this.state = 'betting';
        this.emojiBarVisible = false;
        this.cardAnims = [];
        this.betChipPile = [];
        this.winChipAnims = [];
        this.particles = [];
        this.valuePopups = [];
        this.currentBet = Math.min(this.currentBet, this.playerChips);
    }

    // ── Visual effects ────────────────────────────────────────────────────────

    _shake(amount, duration) {
        this.shakeAmount = amount;
        this.shakeDuration = duration;
    }

    _spawnWinParticles(x, y, count) {
        const colors = ['#ffd700','#ffed4e','#ffea00','#ff9a00','#4caf50','#81c784'];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
            const speed = 80 + Math.random() * 120;
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 80,
                age: 0, lifetime: 1.4 + Math.random() * 0.6,
                color: colors[i % colors.length],
                size: 3 + Math.random() * 4,
                type: Math.random() < 0.3 ? 'star' : 'circle'
            });
        }
    }

    _spawnValuePopup(val, isDealer, isSpecial) {
        const cx = C.WIDTH / 2;
        this.valuePopups.push({
            text: val.toString() + (isSpecial ? '!' : ''),
            x: cx + 180,
            y: isDealer ? this.DEALER_Y + 50 : this.PLAYER_Y + 50,
            age: 0,
            color: val > 21 ? '#ff4444' : isSpecial ? '#ffd700' : '#ffffff'
        });
    }

    // ── Emoji ─────────────────────────────────────────────────────────────────

    onPlayerEmoji(emoji) {
        this.floatingEmojis.push({
            emoji,
            x: C.WIDTH / 2 + (Math.random() - 0.5) * 30,
            y: C.HEIGHT - 160,
            age: 0, lifetime: 2.0 + Math.random() * 0.5,
            vx: (Math.random() - 0.5) * 20,
            vy: 50 + Math.random() * 30,
            size: 28 + Math.random() * 10
        });
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(dt) {
        this.time += dt;

        // Screen shake decay
        if (this.shakeDuration > 0) {
            this.shakeDuration -= dt;
            if (this.shakeDuration <= 0) this.shakeAmount = 0;
        }

        // Card animations
        this.cardAnims.forEach(a => {
            a.progress += dt;
        });
        this.cardAnims = this.cardAnims.filter(a => a.progress < a.duration + 0.1);

        // Bet chip fly animations
        this.betChipPile.forEach(c => {
            if (c.progress < 1) c.progress += dt * 4;
        });

        // Win chip anims
        this.winChipAnims.forEach(c => {
            c.progress += dt * 3;
        });
        this.winChipAnims = this.winChipAnims.filter(c => c.progress < 1);

        // Particles
        this.particles.forEach(p => {
            p.age += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 120 * dt; // gravity
        });
        this.particles = this.particles.filter(p => p.age < p.lifetime);

        // Value popups
        this.valuePopups.forEach(v => { v.age += dt; });
        this.valuePopups = this.valuePopups.filter(v => v.age < 1.5);

        // Floating emojis
        this.floatingEmojis.forEach(e => {
            e.age += dt;
            e.y -= e.vy * dt;
            e.x += e.vx * dt;
        });
        this.floatingEmojis = this.floatingEmojis.filter(e => e.age < e.lifetime);

        // Dealer thinking dots
        if (this.dealerThinking) this.dealerDotTimer += dt;

        // State transitions
        switch (this.state) {
            case 'dealing':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) this._afterDeal();
                break;
            case 'dealer_turn':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) this._doDealerDraw();
                break;
            case 'dealer_drawing':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) {
                    this.state = 'dealer_turn';
                    this.pauseTimer = 0.4;
                }
                break;
            case 'result':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) this.state = 'hand_over';
                break;
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    render(ctx) {
        ctx.save();

        // Apply screen shake
        if (this.shakeAmount > 0) {
            const sx = (Math.random() - 0.5) * this.shakeAmount * 2;
            const sy = (Math.random() - 0.5) * this.shakeAmount * 2;
            ctx.translate(sx, sy);
        }

        this._drawBackground(ctx);
        this._drawTable(ctx);
        this._drawShoe(ctx);
        this._drawBetChipPile(ctx);
        this._drawDealerHand(ctx);
        this._drawPlayerHand(ctx);
        this._drawCardAnims(ctx);
        this._drawBetArea(ctx);
        this._drawHandValues(ctx);
        this._drawValuePopups(ctx);
        this._drawDealerThinking(ctx);
        this._drawParticles(ctx);
        this._drawStreak(ctx);
        this._drawResultBanner(ctx);
        this._drawFloatingEmojis(ctx);

        ctx.restore();
    }

    _drawBackground(ctx) {
        const W = C.WIDTH, H = C.HEIGHT;
        const room = ctx.createLinearGradient(0, 0, 0, H);
        room.addColorStop(0, '#0a0510');
        room.addColorStop(0.3, '#0d0815');
        room.addColorStop(0.7, '#08030d');
        room.addColorStop(1, '#020102');
        ctx.fillStyle = room;
        ctx.fillRect(0, 0, W, H);

        // Ambient ceiling spotlights
        const spots = [
            { x: W * 0.3, y: 40, r: 250, color: 'rgba(139,0,0,0.08)' },
            { x: W * 0.5, y: 30, r: 300, color: 'rgba(100,80,0,0.06)' },
            { x: W * 0.7, y: 40, r: 250, color: 'rgba(139,0,0,0.08)' }
        ];
        for (const s of spots) {
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
            g.addColorStop(0, s.color);
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g;
            ctx.fillRect(s.x - s.r, 0, s.r * 2, s.r);
        }
    }

    _drawTable(ctx) {
        const cx = C.WIDTH / 2, cy = C.HEIGHT / 2 + 30;

        // Table — semicircle shape (classic BJ table)
        ctx.save();

        // Wood rim
        ctx.beginPath();
        ctx.ellipse(cx, cy + 10, 490, 300, 0, Math.PI, 0);
        ctx.lineTo(cx + 490, cy + 14);
        ctx.lineTo(cx - 490, cy + 14);
        ctx.closePath();
        const woodG = ctx.createLinearGradient(cx - 490, cy - 280, cx + 490, cy + 14);
        woodG.addColorStop(0, '#5a2d0c');
        woodG.addColorStop(0.5, '#4a2510');
        woodG.addColorStop(1, '#3a1a0a');
        ctx.fillStyle = woodG;
        ctx.fill();

        // Leather bumper
        ctx.beginPath();
        ctx.ellipse(cx, cy + 6, 475, 288, 0, Math.PI, 0);
        ctx.lineTo(cx + 475, cy + 10);
        ctx.lineTo(cx - 475, cy + 10);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(200,168,75,0.4)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Felt surface
        ctx.beginPath();
        ctx.ellipse(cx, cy, 460, 275, 0, Math.PI, 0);
        ctx.lineTo(cx + 460, cy + 4);
        ctx.lineTo(cx - 460, cy + 4);
        ctx.closePath();
        const feltG = ctx.createRadialGradient(cx, cy - 100, 30, cx, cy, 460);
        feltG.addColorStop(0, '#1a6b3a');
        feltG.addColorStop(0.5, '#156b32');
        feltG.addColorStop(1, '#0d4d22');
        ctx.fillStyle = feltG;
        ctx.fill();

        // Crosshatch texture
        ctx.save();
        ctx.globalAlpha = 0.03;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5;
        for (let i = -460; i < 460; i += 8) {
            ctx.beginPath();
            ctx.moveTo(cx + i, cy - 275);
            ctx.lineTo(cx + i + 100, cy + 4);
            ctx.stroke();
        }
        ctx.restore();

        // Center spotlight
        const spot = ctx.createRadialGradient(cx, cy - 80, 0, cx, cy - 80, 250);
        spot.addColorStop(0, 'rgba(255,255,220,0.06)');
        spot.addColorStop(1, 'transparent');
        ctx.fillStyle = spot;
        ctx.fillRect(cx - 250, cy - 330, 500, 340);

        // Betting spots (circles on felt)
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(212,175,55,0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy - 50, 45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // "BLACKJACK PAYS 3:2"
        ctx.font = 'bold 13px Georgia';
        ctx.fillStyle = 'rgba(212,175,55,0.3)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BLACKJACK PAYS 3 TO 2', cx, cy - 140);

        // Insurance arc
        ctx.setLineDash([8, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 360, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '9px Georgia';
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillText('INSURANCE PAYS 2 TO 1', cx, cy - 108);

        // Branding
        ctx.font = 'italic 10px Georgia';
        ctx.fillStyle = 'rgba(212,175,55,0.2)';
        ctx.fillText("KIEFER'S PALACE", cx, cy - 8);

        ctx.restore();
    }

    _drawShoe(ctx) {
        // Card shoe in top-right
        ctx.save();
        const x = this.SHOE_X - 25, y = this.SHOE_Y;
        // Stack of cards
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i === 3 ? '#1a3a8a' : '#152d6b';
            Utils.roundRect(ctx, x - i * 1.5, y - i * 1.5, 50, 70, 4);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
        ctx.font = '10px Georgia';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'center';
        ctx.fillText('SHOE', x + 25, y + 82);
        ctx.restore();
    }

    _drawCard(ctx, card, x, y, scale, rotation) {
        const w = this.CARD_W * (scale || 1);
        const h = this.CARD_H * (scale || 1);
        ctx.save();

        if (rotation) {
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate(rotation);
            ctx.translate(-(x + w / 2), -(y + h / 2));
        }

        if (!card.faceUp) {
            // Face-down
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 3;
            Utils.roundRect(ctx, x, y, w, h, 6);
            const backG = ctx.createLinearGradient(x, y, x + w, y + h);
            backG.addColorStop(0, '#1e4494');
            backG.addColorStop(1, '#142d6b');
            ctx.fillStyle = backG;
            ctx.fill();
            ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Diamond pattern
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            for (let py = y + 10; py < y + h - 10; py += 12) {
                for (let px = x + 10; px < x + w - 10; px += 12) {
                    ctx.save();
                    ctx.translate(px + 4, py + 4);
                    ctx.rotate(Math.PI / 4);
                    ctx.fillRect(-3, -3, 6, 6);
                    ctx.restore();
                }
            }

            // Center emblem
            ctx.fillStyle = 'rgba(255,215,0,0.15)';
            ctx.font = 'bold 18px Georgia';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('K', x + w / 2, y + h / 2);

            ctx.restore();
            return;
        }

        // Face-up card with shadow
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 4;
        Utils.roundRect(ctx, x, y, w, h, 6);
        ctx.fillStyle = '#fafafa';
        ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        // Subtle inner gradient
        const innerG = ctx.createLinearGradient(x, y, x, y + h);
        innerG.addColorStop(0, 'rgba(255,255,255,0.3)');
        innerG.addColorStop(0.5, 'rgba(255,255,255,0)');
        innerG.addColorStop(1, 'rgba(0,0,0,0.04)');
        Utils.roundRect(ctx, x, y, w, h, 6);
        ctx.fillStyle = innerG;
        ctx.fill();

        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const color = card.isRed ? '#c0392b' : '#1a1a2e';

        // Top-left rank + suit
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.round(18 * (scale||1))}px Georgia`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(card.rank, x + 7, y + 6);
        ctx.font = `${Math.round(14 * (scale||1))}px Georgia`;
        ctx.fillText(card.suit, x + 7, y + 26);

        // Bottom-right (upside down)
        ctx.save();
        ctx.translate(x + w - 7, y + h - 6);
        ctx.rotate(Math.PI);
        ctx.font = `bold ${Math.round(14 * (scale||1))}px Georgia`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(card.rank, 0, 0);
        ctx.font = `${Math.round(11 * (scale||1))}px Georgia`;
        ctx.fillText(card.suit, 0, 16);
        ctx.restore();

        // Center pip
        ctx.fillStyle = color;
        ctx.font = `${Math.round(36 * (scale||1))}px Georgia`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(card.suit, x + w / 2, y + h / 2);

        // Face card indicator
        if (['J','Q','K'].includes(card.rank)) {
            ctx.fillStyle = 'rgba(212,175,55,0.12)';
            ctx.beginPath();
            ctx.arc(x + w / 2, y + h / 2, w * 0.35, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    _drawCardAnims(ctx) {
        for (const a of this.cardAnims) {
            if (a.progress < 0) continue; // waiting
            const t = Math.min(a.progress / a.duration, 1);
            const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
            const x = a.startX + (a.endX - a.startX) * ease;
            const y = a.startY + (a.endY - a.startY) * ease;
            const rot = a.targetRotation * ease;
            const scale = 0.6 + 0.4 * ease;

            // During animation, draw card at interpolated position
            if (t < 1) {
                const card = { ...a.card };
                if (a.flipAt > 0 && t < a.flipAt) card.faceUp = false;
                this._drawCard(ctx, card, x - (this.CARD_W * scale) / 2, y, scale, rot);
            }
        }
    }

    _drawDealerHand(ctx) {
        for (let i = 0; i < this.dealerHand.length; i++) {
            const x = this._dealerCardX(i) - this.CARD_W / 2;
            // Check if this card is still being animated
            const animating = this.cardAnims.some(a =>
                a.hand === 'dealer' && a.idx === i && a.progress < a.duration);
            if (!animating) {
                const rot = (i - (this.dealerHand.length - 1) / 2) * 0.03;
                this._drawCard(ctx, this.dealerHand[i], x, this.DEALER_Y, 1, rot);
            }
        }
    }

    _drawPlayerHand(ctx) {
        for (let i = 0; i < this.playerHand.length; i++) {
            const x = this._playerCardX(i) - this.CARD_W / 2;
            const animating = this.cardAnims.some(a =>
                a.hand === 'player' && a.idx === i && a.progress < a.duration);
            if (!animating) {
                const rot = (i - (this.playerHand.length - 1) / 2) * 0.03;
                this._drawCard(ctx, this.playerHand[i], x, this.PLAYER_Y, 1, rot);
            }
        }
    }

    _drawHandValues(ctx) {
        if (this.state === 'betting' || this.state === 'dealing') return;
        ctx.save();

        // Dealer value pill
        const dVal = this._handValue(this.dealerHand);
        if (dVal > 0) {
            const dx = C.WIDTH / 2 + 180;
            const dy = this.DEALER_Y + 50;
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.beginPath();
            ctx.roundRect(dx - 22, dy - 14, 44, 28, 14);
            ctx.fill();
            ctx.font = 'bold 16px Georgia';
            ctx.fillStyle = dVal > 21 ? '#ff4444' : '#ffe9a8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(dVal.toString(), dx, dy);
        }

        // Player value pill
        const pVal = this._handValue(this.playerHand);
        if (this.playerHand.length > 0) {
            const px = C.WIDTH / 2 + 180;
            const py = this.PLAYER_Y + 50;
            const isSoft = this._isSoft(this.playerHand);
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.beginPath();
            ctx.roundRect(px - 28, py - 14, 56, 28, 14);
            ctx.fill();
            ctx.font = 'bold 16px Georgia';
            ctx.fillStyle = pVal > 21 ? '#ff4444' : pVal === 21 ? '#4caf50' : '#ffe9a8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = isSoft ? `S${pVal}` : pVal.toString();
            ctx.fillText(label, px, py);
        }

        ctx.restore();
    }

    _drawValuePopups(ctx) {
        ctx.save();
        for (const v of this.valuePopups) {
            const t = v.age / 1.5;
            const alpha = t < 0.2 ? t / 0.2 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
            const yOff = -30 * t;
            const scale = t < 0.15 ? 0.5 + t / 0.15 * 0.5 : 1;
            ctx.globalAlpha = alpha;
            ctx.font = `bold ${Math.round(22 * scale)}px Georgia`;
            ctx.fillStyle = v.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 6;
            ctx.fillText(v.text, v.x, v.y + yOff);
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }

    _drawBetChipPile(ctx) {
        const cx = C.WIDTH / 2;
        const cy = C.HEIGHT / 2 + 30;

        for (let i = 0; i < this.betChipPile.length; i++) {
            const c = this.betChipPile[i];
            const t = Math.min(c.progress, 1);
            const ease = 1 - Math.pow(1 - t, 3);
            const x = c.x + (c.targetX - c.x) * ease;
            const y = c.y + (c.targetY - c.y) * ease;

            // Draw chip
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, 14, 0, Math.PI * 2);
            ctx.fillStyle = c.color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    _drawBetArea(ctx) {
        ctx.save();
        const cx = C.WIDTH / 2;
        const cy = C.HEIGHT / 2 + 30;

        if (this.state === 'betting') {
            // Pulsing bet amount
            const pulse = 1 + Math.sin(this.time * 3) * 0.03;
            const bounce = this.time - this.lastBetBounce < 0.2
                ? 1.15 - (this.time - this.lastBetBounce) / 0.2 * 0.15 : 1;

            ctx.font = `bold ${Math.round(32 * pulse * bounce)}px Georgia`;
            ctx.fillStyle = '#ffe9a8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(255,215,0,0.3)';
            ctx.shadowBlur = 12;
            ctx.fillText(`$${this.currentBet}`, cx, cy - 50);
            ctx.shadowBlur = 0;

            ctx.font = '13px Georgia';
            ctx.fillStyle = 'rgba(255,233,168,0.5)';
            ctx.fillText('YOUR BET', cx, cy - 78);

            // Chip selectors with hover effect
            const chipY = cy + 30;
            const colors = ['#e53935','#43a047','#1976d2','#7b1fa2','#424242'];
            for (let i = 0; i < this.betChips.length; i++) {
                const chipX = cx - 120 + i * 60;
                const val = this.betChips[i];
                const isHov = this.hoveredChip === i;
                const r = isHov ? 25 : 22;

                // Shadow
                ctx.shadowColor = isHov ? colors[i] : 'rgba(0,0,0,0.4)';
                ctx.shadowBlur = isHov ? 12 : 4;

                ctx.beginPath();
                ctx.arc(chipX, chipY, r, 0, Math.PI * 2);
                ctx.fillStyle = colors[i];
                ctx.fill();
                ctx.shadowBlur = 0;

                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(chipX, chipY, r - 6, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.25)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.font = 'bold 12px Georgia';
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`$${val}`, chipX, chipY);
            }

            ctx.font = '12px Georgia';
            ctx.fillStyle = 'rgba(200,200,200,0.4)';
            ctx.fillText('Click chips to adjust, then DEAL', cx, chipY + 40);

            ctx.font = '11px Georgia';
            ctx.fillStyle = 'rgba(255,233,168,0.3)';
            ctx.fillText(`Min $${this.minBet}  \u00B7  Max $${this.maxBet}  \u00B7  Chips $${this.playerChips}`, cx, chipY + 58);
        } else {
            // Bet display pill (moved lower to not obscure player hand)
            const potX = 120;
            const potY = 100;

            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.beginPath();
            ctx.roundRect(potX - 60, potY - 18, 120, 36, 18);
            ctx.fill();
            ctx.strokeStyle = 'rgba(200,168,75,0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(potX - 60, potY - 18, 120, 36, 18);
            ctx.stroke();

            ctx.font = 'bold 10px Georgia';
            ctx.fillStyle = 'rgba(255,233,168,0.6)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('BET', potX - 36, potY - 5);

            ctx.font = 'bold 17px Georgia';
            ctx.fillStyle = '#ffe9a8';
            ctx.fillText(`$${this.currentBet}`, potX - 36, potY + 10);
        }

        ctx.restore();
    }

    _drawDealerThinking(ctx) {
        if (!this.dealerThinking) return;
        ctx.save();
        const cx = C.WIDTH / 2;
        const dy = this.DEALER_Y - 25;
        const dots = Math.floor(this.dealerDotTimer * 3) % 4;
        ctx.font = 'bold 16px Georgia';
        ctx.fillStyle = 'rgba(255,233,168,0.7)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Dealer' + '.'.repeat(dots), cx, dy);
        ctx.restore();
    }

    _drawStreak(ctx) {
        if (this.streak === 0) return;
        ctx.save();
        const x = C.WIDTH - 80;
        const y = C.HEIGHT - 40;
        ctx.font = 'bold 13px Georgia';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (this.streak > 0) {
            ctx.fillStyle = 'rgba(76,175,80,0.7)';
            ctx.fillText(`\uD83D\uDD25 ${this.streak} win${this.streak > 1 ? 's' : ''}`, x, y);
        } else {
            ctx.fillStyle = 'rgba(200,100,100,0.5)';
            ctx.fillText(`${Math.abs(this.streak)} loss${this.streak < -1 ? 'es' : ''}`, x, y);
        }
        ctx.restore();
    }

    _drawParticles(ctx) {
        ctx.save();
        for (const p of this.particles) {
            const alpha = 1 - p.age / p.lifetime;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            if (p.type === 'star') {
                ctx.font = `${p.size * 3}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('\u2726', p.x, p.y);
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * (1 - p.age / p.lifetime * 0.5), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    _drawResultBanner(ctx) {
        if (!this.resultText) return;
        if (this.state !== 'result' && this.state !== 'hand_over') return;
        ctx.save();
        const cx = C.WIDTH / 2;
        const cy = C.HEIGHT / 2 + 30;

        // Animated entrance
        const age = 3.0 - this.pauseTimer;
        const slideIn = Math.min(age / 0.3, 1);
        const ease = 1 - Math.pow(1 - slideIn, 3);
        const bannerY = cy - 30 + (1 - ease) * 40;

        ctx.globalAlpha = ease;

        // Dark backdrop
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        ctx.roundRect(cx - 220, bannerY - 5, 440, 70, 16);
        ctx.fill();

        const borderColor = this.resultAmount > 0 ? 'rgba(76,175,80,0.7)'
            : this.resultAmount < 0 ? 'rgba(200,80,80,0.7)' : 'rgba(200,168,75,0.5)';
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(cx - 220, bannerY - 5, 440, 70, 16);
        ctx.stroke();

        // Result text
        ctx.font = 'bold 28px Georgia';
        ctx.fillStyle = this.resultAmount > 0 ? '#4caf50' : this.resultAmount < 0 ? '#ef5350' : '#ffe9a8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 8;
        ctx.fillText(this.resultText, cx - 30, bannerY + 24);
        ctx.shadowBlur = 0;

        // Amount
        if (this.resultAmount !== 0) {
            const sign = this.resultAmount > 0 ? '+' : '';
            ctx.font = 'bold 22px Georgia';
            ctx.fillStyle = this.resultAmount > 0 ? '#81c784' : '#e57373';
            ctx.fillText(`${sign}$${Math.abs(this.resultAmount)}`, cx + 130, bannerY + 24);
        }

        if (this.state === 'hand_over') {
            ctx.font = '12px Georgia';
            ctx.fillStyle = 'rgba(200,200,200,0.45)';
            ctx.fillText('Click DEAL to play again', cx, bannerY + 52);
        }

        ctx.restore();
    }

    _drawFloatingEmojis(ctx) {
        ctx.save();
        for (const e of this.floatingEmojis) {
            const progress = e.age / e.lifetime;
            const alpha = progress < 0.15 ? progress / 0.15
                        : progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
            ctx.globalAlpha = alpha;
            ctx.font = `${e.size}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.emoji, e.x, e.y);
        }
        ctx.restore();
    }

    // ── Interaction ───────────────────────────────────────────────────────────

    handleBetClick(mouseX, mouseY) {
        if (this.state !== 'betting') return false;
        const cx = C.WIDTH / 2;
        const cy = C.HEIGHT / 2 + 30;
        const chipY = cy + 30;

        for (let i = 0; i < this.betChips.length; i++) {
            const chipX = cx - 120 + i * 60;
            const dx = mouseX - chipX;
            const dy = mouseY - chipY;
            if (dx * dx + dy * dy < 25 * 25) {
                this.increaseBet(this.betChips[i]);
                if (typeof Sounds !== 'undefined') Sounds.play('chip');
                return true;
            }
        }
        return false;
    }

    getCoachState() {
        return {
            gameType: 'blackjack',
            state: this.state,
            playerHand: this.playerHand,
            dealerHand: this.dealerHand,
            playerValue: this._handValue(this.playerHand),
            dealerUpcard: this.dealerHand.length > 0 ? this.dealerHand[0] : null,
            dealerValue: this._handValue(this.dealerHand),
            isSoft: this._isSoft(this.playerHand),
            currentBet: this.currentBet,
            playerChips: this.playerChips,
            canDouble: this.playerHand.length === 2 && this.playerChips >= this.currentBet,
            streak: this.streak,
            shoeRemaining: this.shoe.length
        };
    }

    handleMouseMove(mouseX, mouseY) {
        if (this.state !== 'betting') { this.hoveredChip = -1; return; }
        const cx = C.WIDTH / 2;
        const cy = C.HEIGHT / 2 + 30;
        const chipY = cy + 30;
        this.hoveredChip = -1;
        for (let i = 0; i < this.betChips.length; i++) {
            const chipX = cx - 120 + i * 60;
            const dx = mouseX - chipX;
            const dy = mouseY - chipY;
            if (dx * dx + dy * dy < 25 * 25) {
                this.hoveredChip = i;
                break;
            }
        }
    }
}
