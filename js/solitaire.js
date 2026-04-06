'use strict';

class SolitaireGame {
    constructor(tableCfg, playerChips) {
        this.cfg = tableCfg;
        this.theme = C.THEMES[tableCfg.theme];
        this.playerChips = playerChips;

        // Vegas-style: pay $50 to play (buyIn), earn $5 per card to foundation
        this.costPerGame = tableCfg.buyIn;
        this.rewardPerCard = 5;
        this.earnings = 0;

        // Card dimensions
        this.CW = 72;
        this.CH = 100;
        this.GAP = 4;

        // State: playing | won | lost
        this.state = 'playing';
        this.resultText = '';

        // Emoji
        this.floatingEmojis = [];
        this.emojiOptions = ['😎','🔥','😤','😂','💰','👏','🤯','💀'];
        this.emojiBarVisible = false;

        // Build deck
        this.deck = this._buildDeck();
        this._shuffle(this.deck);

        // Tableau: 7 columns
        this.tableau = [[], [], [], [], [], [], []];
        // Foundation: 4 piles (one per suit)
        this.foundation = [[], [], [], []];
        // Stock and waste
        this.stock = [];
        this.waste = [];

        // Deal tableau
        let idx = 0;
        for (let col = 0; col < 7; col++) {
            for (let row = 0; row <= col; row++) {
                const card = this.deck[idx++];
                card.faceUp = (row === col);
                this.tableau[col].push(card);
            }
        }
        // Remaining cards go to stock
        for (let i = idx; i < this.deck.length; i++) {
            this.deck[i].faceUp = false;
            this.stock.push(this.deck[i]);
        }

        // Drag state
        this.dragging = null;
        this.mouseX = 0;
        this.mouseY = 0;

        // Selection state (for click-to-move)
        this.selected = null; // {type, idx, cardIdx}

        // Animation system
        this.animations = [];    // active card flight animations
        this.animLock = false;   // block input during animations

        // Timer
        this.time = 0;
        this.moveCount = 0;
    }

    _buildDeck() {
        const suits = ['♠','♥','♦','♣'];
        const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
        const values = [1,2,3,4,5,6,7,8,9,10,11,12,13];
        const cards = [];
        for (let s = 0; s < 4; s++) {
            for (let r = 0; r < 13; r++) {
                cards.push({
                    rank: ranks[r],
                    suit: suits[s],
                    value: values[r],
                    isRed: s === 1 || s === 2,
                    faceUp: false,
                    suitIdx: s
                });
            }
        }
        return cards;
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    _suitColor(suit) {
        return (suit === '♥' || suit === '♦') ? 'red' : 'black';
    }

    // ── Animation helpers ─────────────────────────────────────────────────────

    _easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    _easeOutBack(t) { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

    _animateCard(card, fromX, fromY, toX, toY, duration, delay, onDone, flipMidway) {
        this.animations.push({
            card, fromX, fromY, toX, toY,
            duration: duration || 0.3,
            delay: delay || 0,
            elapsed: 0,
            done: false,
            onDone: onDone || null,
            flipMidway: flipMidway || false,
            flipped: false
        });
    }

    _hasActiveAnimations() {
        return this.animations.length > 0;
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    clickStock() {
        if (this._hasActiveAnimations()) return;
        if (this.stock.length > 0) {
            const card = this.stock.pop();
            const sp = this._stockPos();
            const wp = this._wastePos();
            // Card starts face-down, flies to waste, flips midway
            card._animating = true;
            this.waste.push(card);
            this.animLock = true;
            this._animateCard(card, sp.x, sp.y, wp.x, wp.y, 0.25, 0, () => {
                card.faceUp = true;
                card._animating = false;
                this.animLock = false;
                if (typeof Sounds !== 'undefined') Sounds.play('card');
            }, true);
        } else {
            while (this.waste.length > 0) {
                const card = this.waste.pop();
                card.faceUp = false;
                this.stock.push(card);
            }
            if (typeof Sounds !== 'undefined') Sounds.play('card');
        }
    }

    _canPlaceOnTableau(card, col) {
        const pile = this.tableau[col];
        if (pile.length === 0) return card.value === 13; // Only King on empty
        const top = pile[pile.length - 1];
        if (!top.faceUp) return false;
        return top.value === card.value + 1 && top.isRed !== card.isRed;
    }

    _canPlaceOnFoundation(card, foundIdx) {
        const pile = this.foundation[foundIdx];
        if (pile.length === 0) return card.value === 1; // Only Ace starts foundation
        const top = pile[pile.length - 1];
        return top.suitIdx === card.suitIdx && card.value === top.value + 1;
    }

    tryMoveToFoundation(card, fromType, fromIdx) {
        if (this._hasActiveAnimations()) return false;
        for (let f = 0; f < 4; f++) {
            if (this._canPlaceOnFoundation(card, f)) {
                // Calculate source position
                const src = this._getCardPos(fromType, fromIdx);
                const dst = this._foundationPos(f);

                // Remove from source immediately (card is in animation)
                this._removeCardFrom(fromType, fromIdx);

                // Mark card as animating (temporarily hidden from normal render)
                card._animating = true;
                this.animLock = true;

                this._animateCard(card, src.x, src.y, dst.x, dst.y, 0.3, 0, () => {
                    card._animating = false;
                    this.foundation[f].push(card);
                    this.earnings += this.rewardPerCard;
                    this.playerChips += this.rewardPerCard;
                    this.moveCount++;
                    this.animLock = false;
                    if (typeof Sounds !== 'undefined') Sounds.play('chip');
                    this._checkWin();
                });
                return true;
            }
        }
        return false;
    }

    tryMoveToTableau(cards, targetCol, fromType, fromIdx, cardIdx) {
        if (cards.length === 0) return false;
        if (this._hasActiveAnimations()) return false;
        if (!this._canPlaceOnTableau(cards[0], targetCol)) return false;

        // Calculate source positions for each card
        const srcPositions = [];
        for (let i = 0; i < cards.length; i++) {
            if (fromType === 'tableau') {
                const tp = this._tableauPos(fromIdx);
                srcPositions.push({ x: tp.x, y: tp.y + (cardIdx + i) * 22 });
            } else if (fromType === 'waste') {
                srcPositions.push(this._wastePos());
            } else if (fromType === 'foundation') {
                srcPositions.push(this._foundationPos(fromIdx));
            }
        }

        // Calculate target positions
        const targetPile = this.tableau[targetCol];
        const targetBase = this._tableauPos(targetCol);
        const startRow = targetPile.length;

        // Remove cards from source
        if (fromType === 'tableau') {
            this.tableau[fromIdx].splice(cardIdx, cards.length);
            const pile = this.tableau[fromIdx];
            if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                pile[pile.length - 1].faceUp = true;
            }
        } else if (fromType === 'waste') {
            this.waste.pop();
        } else if (fromType === 'foundation') {
            this.foundation[fromIdx].pop();
        }

        // Mark all cards as animating
        this.animLock = true;
        cards.forEach(c => { c._animating = true; });

        // Animate each card with slight stagger
        cards.forEach((card, i) => {
            const dst = { x: targetBase.x, y: targetBase.y + (startRow + i) * 22 };
            const delay = i * 0.04;
            const isLast = i === cards.length - 1;

            this._animateCard(card, srcPositions[i].x, srcPositions[i].y, dst.x, dst.y, 0.25, delay, () => {
                card._animating = false;
                this.tableau[targetCol].push(card);
                if (isLast) {
                    this.moveCount++;
                    this.animLock = false;
                    if (typeof Sounds !== 'undefined') Sounds.play('card');
                }
            });
        });

        return true;
    }

    _getCardPos(fromType, fromIdx) {
        if (fromType === 'waste') return this._wastePos();
        if (fromType === 'foundation') return this._foundationPos(fromIdx);
        if (fromType === 'tableau') {
            const tp = this._tableauPos(fromIdx);
            const pile = this.tableau[fromIdx];
            return { x: tp.x, y: tp.y + Math.max(0, pile.length - 1) * 22 };
        }
        return { x: 0, y: 0 };
    }

    _removeCardFrom(fromType, fromIdx) {
        if (fromType === 'waste') {
            this.waste.pop();
        } else if (fromType === 'tableau') {
            this.tableau[fromIdx].pop();
            const pile = this.tableau[fromIdx];
            if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                pile[pile.length - 1].faceUp = true;
            }
        }
    }

    _checkWin() {
        const total = this.foundation.reduce((sum, f) => sum + f.length, 0);
        if (total === 52) {
            this.state = 'won';
            this.resultText = `You win! +$${this.earnings}`;
            this.emojiBarVisible = true;
        }
    }

    giveUp() {
        if (this.state !== 'playing') return;
        const net = this.earnings - this.costPerGame;
        this.state = 'gave_up';
        this.resultText = net >= 0
            ? `Game over — Net: +$${net}`
            : `Game over — Net: -$${Math.abs(net)}`;
        this.emojiBarVisible = true;
    }

    // ── Hint system ──────────────────────────────────────────────────────────

    getHint() {
        // Returns the single best move as a highlighted hint
        const gs = this.getCoachState();
        if (gs.moves.length === 0) {
            if (this.stock.length > 0) return { type: 'stock', text: 'Draw from the stock pile' };
            return { type: 'none', text: 'No moves available' };
        }
        // Use coach ranking
        const ranked = Coach._solRankMoves(gs.moves, gs);
        if (ranked.length === 0) return { type: 'none', text: 'No moves' };
        const best = ranked[0];
        const m = best.move;
        return {
            type: m.type,
            card: m.card,
            from: m.from,
            to: m.to,
            col: m.col,
            text: best.reason
        };
    }

    // ── Click handling ────────────────────────────────────────────────────────

    handleClick(mx, my) {
        if (this.state !== 'playing') return;
        if (this.animLock || this._hasActiveAnimations()) return;
        this.mouseX = mx;
        this.mouseY = my;

        // Stock click
        const stockPos = this._stockPos();
        if (mx >= stockPos.x && mx <= stockPos.x + this.CW &&
            my >= stockPos.y && my <= stockPos.y + this.CH) {
            this.clickStock();
            this.selected = null;
            return;
        }

        // Waste click
        if (this.waste.length > 0) {
            const wp = this._wastePos();
            if (mx >= wp.x && mx <= wp.x + this.CW &&
                my >= wp.y && my <= wp.y + this.CH) {
                const card = this.waste[this.waste.length - 1];
                // Try auto-move to foundation
                if (this.tryMoveToFoundation(card, 'waste', 0)) {
                    this.selected = null;
                    return;
                }
                // Select for tableau move
                this.selected = { type: 'waste', idx: 0, cards: [card] };
                return;
            }
        }

        // Foundation click (to move card back if needed)
        for (let f = 0; f < 4; f++) {
            const fp = this._foundationPos(f);
            if (mx >= fp.x && mx <= fp.x + this.CW &&
                my >= fp.y && my <= fp.y + this.CH) {
                if (this.selected) {
                    // Try to place selected on this foundation
                    const sel = this.selected;
                    if (sel.cards.length === 1 && this._canPlaceOnFoundation(sel.cards[0], f)) {
                        const card = sel.cards[0];
                        const src = this._getSelectedPos(sel);
                        const dst = this._foundationPos(f);

                        this._removeSelectedSource(sel);
                        card._animating = true;
                        this.animLock = true;

                        this._animateCard(card, src.x, src.y, dst.x, dst.y, 0.3, 0, () => {
                            card._animating = false;
                            this.foundation[f].push(card);
                            this.earnings += this.rewardPerCard;
                            this.playerChips += this.rewardPerCard;
                            this.moveCount++;
                            this.animLock = false;
                            if (typeof Sounds !== 'undefined') Sounds.play('chip');
                            this._checkWin();
                        });
                    }
                    this.selected = null;
                    return;
                }
                this.selected = null;
                return;
            }
        }

        // Tableau click
        for (let col = 0; col < 7; col++) {
            const tp = this._tableauPos(col);
            const pile = this.tableau[col];
            const pileH = pile.length > 0 ? (pile.length - 1) * 22 + this.CH : this.CH;

            if (mx >= tp.x && mx <= tp.x + this.CW &&
                my >= tp.y && my <= tp.y + pileH) {

                // Find which card was clicked
                let clickedIdx = Math.min(
                    Math.floor((my - tp.y) / 22),
                    pile.length - 1
                );
                if (clickedIdx < 0) clickedIdx = 0;

                // If we have a selection, try to move it here
                if (this.selected) {
                    const sel = this.selected;
                    if (sel.type === 'waste') {
                        this.tryMoveToTableau(sel.cards, col, 'waste', 0, 0);
                    } else if (sel.type === 'tableau') {
                        this.tryMoveToTableau(sel.cards, col, 'tableau', sel.idx, sel.cardIdx);
                    }
                    this.selected = null;
                    return;
                }

                // Empty pile — only accept kings (clear selection)
                if (pile.length === 0) {
                    this.selected = null;
                    return;
                }

                const card = pile[clickedIdx];
                if (!card.faceUp) {
                    this.selected = null;
                    return;
                }

                // Try double-click to foundation (single card on top)
                if (clickedIdx === pile.length - 1) {
                    if (this.tryMoveToFoundation(card, 'tableau', col)) {
                        this.selected = null;
                        return;
                    }
                }

                // Select this card (and all below it) for moving
                const cards = pile.slice(clickedIdx);
                this.selected = { type: 'tableau', idx: col, cardIdx: clickedIdx, cards };
                return;
            }
        }

        // Clicked empty space — clear selection
        this.selected = null;
    }

    _getSelectedPos(sel) {
        if (sel.type === 'waste') return this._wastePos();
        if (sel.type === 'tableau') {
            const tp = this._tableauPos(sel.idx);
            return { x: tp.x, y: tp.y + sel.cardIdx * 22 };
        }
        if (sel.type === 'foundation') return this._foundationPos(sel.idx);
        return { x: 0, y: 0 };
    }

    _removeSelectedSource(sel) {
        if (sel.type === 'waste') {
            this.waste.pop();
        } else if (sel.type === 'tableau') {
            this.tableau[sel.idx].splice(sel.cardIdx, sel.cards.length);
            const pile = this.tableau[sel.idx];
            if (pile.length > 0 && !pile[pile.length - 1].faceUp) {
                pile[pile.length - 1].faceUp = true;
            }
        }
    }

    // ── Layout positions ──────────────────────────────────────────────────────

    _stockPos() { return { x: 30, y: 70 }; }
    _wastePos() { return { x: 30 + this.CW + 12, y: 70 }; }
    _foundationPos(i) { return { x: C.WIDTH - 30 - (4 - i) * (this.CW + 8), y: 70 }; }
    _tableauPos(col) {
        const totalW = 7 * this.CW + 6 * 10;
        const startX = (C.WIDTH - totalW) / 2;
        return { x: startX + col * (this.CW + 10), y: 195 };
    }

    // ── Emoji ─────────────────────────────────────────────────────────────────

    onPlayerEmoji(emoji) {
        this.floatingEmojis.push({
            emoji,
            x: C.WIDTH / 2 + (Math.random() - 0.5) * 30,
            y: C.HEIGHT / 2,
            age: 0,
            lifetime: 2.0 + Math.random() * 0.5,
            vx: (Math.random() - 0.5) * 20,
            vy: 50 + Math.random() * 30,
            size: 28 + Math.random() * 10
        });
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(dt) {
        this.time += dt;

        // Process card animations
        for (let i = this.animations.length - 1; i >= 0; i--) {
            const a = this.animations[i];
            a.elapsed += dt;
            if (a.elapsed < a.delay) continue;

            const t = Math.min((a.elapsed - a.delay) / a.duration, 1);

            // Flip card midway through animation
            if (a.flipMidway && !a.flipped && t >= 0.4) {
                a.card.faceUp = true;
                a.flipped = true;
            }

            if (t >= 1) {
                a.done = true;
                if (a.onDone) a.onDone();
                this.animations.splice(i, 1);
            }
        }

        // Floating emojis
        this.floatingEmojis.forEach(e => {
            e.age += dt;
            e.y -= e.vy * dt;
            e.x += e.vx * dt;
        });
        this.floatingEmojis = this.floatingEmojis.filter(e => e.age < e.lifetime);
    }

    // ── Render ────────────────────────────────────────────────────────────────

    render(ctx) {
        this._drawBg(ctx);
        this._drawStock(ctx);
        this._drawWaste(ctx);
        this._drawFoundations(ctx);
        this._drawTableau(ctx);
        this._drawAnimatingCards(ctx);
        this._drawHUD(ctx);
        this._drawSelection(ctx);
        this._drawResultBanner(ctx);
        this._drawFloatingEmojis(ctx);
    }

    _drawBg(ctx) {
        const W = C.WIDTH, H = C.HEIGHT;
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0a3d20');
        bg.addColorStop(0.5, '#084a25');
        bg.addColorStop(1, '#052e16');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Subtle felt texture
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        for (let y = 0; y < H; y += 4) {
            for (let x = 0; x < W; x += 4) {
                if (Math.random() < 0.3) ctx.fillRect(x, y, 2, 2);
            }
        }
    }

    _drawCardAt(ctx, card, x, y, highlight) {
        const w = this.CW, h = this.CH;
        ctx.save();

        if (!card || !card.faceUp) {
            // Face-down or empty
            Utils.roundRect(ctx, x, y, w, h, 6);
            ctx.fillStyle = '#1a3a8a';
            ctx.fill();
            ctx.strokeStyle = '#2255bb';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Pattern
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            for (let py = y + 6; py < y + h - 6; py += 5) {
                for (let px = x + 6; px < x + w - 6; px += 5) {
                    ctx.fillRect(px, py, 2.5, 2.5);
                }
            }
            ctx.restore();
            return;
        }

        // Face-up card
        if (highlight) {
            ctx.shadowColor = 'rgba(255,215,0,0.8)';
            ctx.shadowBlur = 12;
        }

        Utils.roundRect(ctx, x, y, w, h, 6);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = highlight ? '#ffd700' : 'rgba(0,0,0,0.2)';
        ctx.lineWidth = highlight ? 2.5 : 1;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const color = card.isRed ? '#c0392b' : '#1a1a1a';
        ctx.fillStyle = color;
        ctx.font = 'bold 15px Georgia';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(card.rank, x + 5, y + 5);
        ctx.font = '12px Georgia';
        ctx.fillText(card.suit, x + 5, y + 22);

        ctx.font = '22px Georgia';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(card.suit, x + w / 2, y + h / 2);

        // Bottom-right rank (upside-down feel)
        ctx.font = 'bold 11px Georgia';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(card.rank + card.suit, x + w - 5, y + h - 5);

        ctx.restore();
    }

    _drawEmptySlot(ctx, x, y) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        Utils.roundRect(ctx, x, y, this.CW, this.CH, 6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    _drawStock(ctx) {
        const p = this._stockPos();
        if (this.stock.length > 0) {
            this._drawCardAt(ctx, { faceUp: false }, p.x, p.y);
            // Count
            ctx.save();
            ctx.font = 'bold 11px Georgia';
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.textAlign = 'center';
            ctx.fillText(this.stock.length.toString(), p.x + this.CW / 2, p.y + this.CH + 14);
            ctx.restore();
        } else {
            this._drawEmptySlot(ctx, p.x, p.y);
            ctx.save();
            ctx.font = '28px Georgia';
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('↺', p.x + this.CW / 2, p.y + this.CH / 2);
            ctx.restore();
        }
    }

    _drawWaste(ctx) {
        const p = this._wastePos();
        if (this.waste.length > 0) {
            const card = this.waste[this.waste.length - 1];
            if (card._animating) { this._drawEmptySlot(ctx, p.x, p.y); return; }
            const isSelected = this.selected && this.selected.type === 'waste';
            this._drawCardAt(ctx, card, p.x, p.y, isSelected);
        } else {
            this._drawEmptySlot(ctx, p.x, p.y);
        }
    }

    _drawFoundations(ctx) {
        for (let f = 0; f < 4; f++) {
            const p = this._foundationPos(f);
            const pile = this.foundation[f];
            if (pile.length > 0 && !pile[pile.length - 1]._animating) {
                this._drawCardAt(ctx, pile[pile.length - 1], p.x, p.y);
            } else if (pile.length === 0) {
                this._drawEmptySlot(ctx, p.x, p.y);
                const suits = ['♠','♥','♦','♣'];
                ctx.save();
                ctx.font = '24px Georgia';
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(suits[f], p.x + this.CW / 2, p.y + this.CH / 2);
                ctx.restore();
            }
        }
    }

    _drawTableau(ctx) {
        for (let col = 0; col < 7; col++) {
            const p = this._tableauPos(col);
            const pile = this.tableau[col];

            if (pile.length === 0) {
                this._drawEmptySlot(ctx, p.x, p.y);
                continue;
            }

            for (let i = 0; i < pile.length; i++) {
                const card = pile[i];
                if (card._animating) continue;
                const cy = p.y + i * 22;
                const isSelected = this.selected &&
                    this.selected.type === 'tableau' &&
                    this.selected.idx === col &&
                    i >= this.selected.cardIdx;
                this._drawCardAt(ctx, card, p.x, cy, isSelected);
            }
        }
    }

    _drawAnimatingCards(ctx) {
        for (const a of this.animations) {
            if (a.elapsed < a.delay) continue;
            const t = Math.min((a.elapsed - a.delay) / a.duration, 1);
            const ease = this._easeOutCubic(t);
            const x = a.fromX + (a.toX - a.fromX) * ease;
            const y = a.fromY + (a.toY - a.fromY) * ease;

            // Slight arc — card lifts up in the middle of its flight
            const arc = Math.sin(t * Math.PI) * -25;

            // Drop shadow grows and shrinks during flight
            ctx.save();
            const shadowSize = Math.sin(t * Math.PI) * 12;
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 8 + shadowSize;
            ctx.shadowOffsetX = 2 + shadowSize * 0.3;
            ctx.shadowOffsetY = 4 + shadowSize * 0.5;

            this._drawCardAt(ctx, a.card, x, y + arc, false);
            ctx.restore();
        }
    }

    _drawSelection(ctx) {
        if (!this.selected) return;
        // Just highlight — handled in individual draw methods via isSelected param
    }

    _drawHUD(ctx) {
        ctx.save();

        // Earnings display (top-left, like pot)
        const potX = 200;
        const potY = 38;

        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        ctx.roundRect(potX - 80, potY - 18, 160, 36, 18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,168,75,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(potX - 80, potY - 18, 160, 36, 18);
        ctx.stroke();

        ctx.font = 'bold 10px Georgia';
        ctx.fillStyle = 'rgba(255,233,168,0.6)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('EARNED', potX - 55, potY - 5);

        const earnColor = this.earnings > 0 ? '#4caf50' : this.earnings < 0 ? '#ef5350' : '#ffe9a8';
        ctx.font = 'bold 17px Georgia';
        ctx.fillStyle = earnColor;
        ctx.fillText(`$${this.earnings}`, potX - 55, potY + 10);

        // Moves counter
        ctx.font = '12px Georgia';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'right';
        ctx.fillText(`Moves: ${this.moveCount}`, potX + 72, potY);

        // Timer
        const mins = Math.floor(this.time / 60);
        const secs = Math.floor(this.time % 60);
        ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, potX + 72, potY + 14);

        // Foundation progress
        const foundTotal = this.foundation.reduce((s, f) => s + f.length, 0);
        ctx.font = '11px Georgia';
        ctx.fillStyle = 'rgba(255,233,168,0.5)';
        ctx.textAlign = 'center';
        ctx.fillText(`${foundTotal}/52 cards placed`, C.WIDTH / 2, 180);

        ctx.restore();
    }

    _drawResultBanner(ctx) {
        if (this.state !== 'won' && this.state !== 'gave_up') return;
        ctx.save();
        const cx = C.WIDTH / 2;
        const cy = C.HEIGHT / 2;

        const isWin = this.state === 'won';
        const borderColor = isWin ? 'rgba(100,200,100,0.6)' : 'rgba(200,100,100,0.6)';
        const textColor = isWin ? '#4caf50' : '#ef5350';

        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.beginPath();
        ctx.roundRect(cx - 200, cy - 40, 400, 80, 16);
        ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(cx - 200, cy - 40, 400, 80, 16);
        ctx.stroke();

        ctx.font = 'bold 28px Georgia';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillText(this.resultText, cx, cy);
        ctx.shadowBlur = 0;

        ctx.restore();
    }

    getCoachState() {
        const foundTotal = this.foundation.reduce((s, f) => s + f.length, 0);
        const hiddenCards = this.tableau.reduce((s, col) =>
            s + col.filter(c => !c.faceUp).length, 0);
        const emptyColumns = this.tableau.filter(col => col.length === 0).length;
        const stockLeft = this.stock.length;
        const wasteTop = this.waste.length > 0 ? this.waste[this.waste.length - 1] : null;

        // Detect available moves
        const moves = [];
        // Waste to foundation
        if (wasteTop) {
            for (let f = 0; f < 4; f++) {
                if (this._canPlaceOnFoundation(wasteTop, f))
                    moves.push({ type: 'waste-to-foundation', card: wasteTop });
            }
            for (let col = 0; col < 7; col++) {
                if (this._canPlaceOnTableau(wasteTop, col))
                    moves.push({ type: 'waste-to-tableau', card: wasteTop, col });
            }
        }
        // Tableau to foundation
        for (let col = 0; col < 7; col++) {
            const pile = this.tableau[col];
            if (pile.length === 0) continue;
            const top = pile[pile.length - 1];
            if (!top.faceUp) continue;
            for (let f = 0; f < 4; f++) {
                if (this._canPlaceOnFoundation(top, f))
                    moves.push({ type: 'tableau-to-foundation', card: top, col });
            }
        }
        // Tableau to tableau (kings to empty, or stack moves)
        for (let col = 0; col < 7; col++) {
            const pile = this.tableau[col];
            for (let i = 0; i < pile.length; i++) {
                if (!pile[i].faceUp) continue;
                for (let target = 0; target < 7; target++) {
                    if (target === col) continue;
                    if (this._canPlaceOnTableau(pile[i], target)) {
                        const revealsHidden = i > 0 && !pile[i - 1].faceUp;
                        moves.push({
                            type: 'tableau-to-tableau', card: pile[i],
                            from: col, to: target, revealsHidden, stackSize: pile.length - i
                        });
                    }
                }
            }
        }

        return {
            gameType: 'solitaire',
            state: this.state,
            foundTotal,
            hiddenCards,
            emptyColumns,
            stockLeft,
            wasteTop,
            moveCount: this.moveCount,
            earnings: this.earnings,
            time: this.time,
            moves,
            tableauLengths: this.tableau.map(col => col.length),
            foundationTops: this.foundation.map(f => f.length > 0 ? f[f.length - 1] : null)
        };
    }

    _drawFloatingEmojis(ctx) {
        ctx.save();
        for (const e of this.floatingEmojis) {
            const progress = e.age / e.lifetime;
            const alpha = progress < 0.15 ? progress / 0.15
                        : progress > 0.7 ? 1 - (progress - 0.7) / 0.3
                        : 1;
            ctx.globalAlpha = alpha;
            ctx.font = `${e.size}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(e.emoji, e.x, e.y);
        }
        ctx.restore();
    }
}
