'use strict';

class PokerGame {
    constructor(tableCfg, playerChips) {
        this.cfg        = tableCfg;
        this.theme      = C.THEMES[tableCfg.theme];
        this.gameType   = tableCfg.type;
        this.difficulty = tableCfg.difficulty;
        this.bigBlind   = tableCfg.bigBlind;
        this.smallBlind = tableCfg.smallBlind;

        // Player
        this.playerChips  = playerChips;
        this.playerCards  = [];
        this.playerBet    = 0;
        this.playerFolded = false;
        this.playerInvestedThisHand = 0;
        this.playerMuckedShowdown = false;
        this.showdownRevealPlayer = false;

        // AI
        const names = AIPlayer.pickNames(tableCfg.numAI);
        this.aiPlayers = names.map((name, i) =>
            new AIPlayer(i, tableCfg.difficulty, tableCfg.buyIn * 4, name));
        for (const ai of this.aiPlayers) {
            ai.seatColors = this._aiColors(ai.name);
        }

        // Game state
        this.community     = [];
        this.revealedCount = 0;   // how many community cards are visible (animation)
        this.revealTimer   = 0;   // time since last card flip
        this.REVEAL_SPEED  = 0.38;
        this.deck          = null;
        this.pot           = 0;
        this.round         = 'preflop';
        this.currentBet    = 0;
        this.minRaise      = tableCfg.bigBlind;
        this.showdownResults = [];
        this.lastResult    = null;

        // State machine
        // States: player_action | ai_turn | street_pause | showdown | hand_over
        this.state      = 'player_action';
        this.pauseTimer = 0;

        // AI turn tracking
        this.aiTimer     = 0;
        this.aiThinkTime = 0.35;
        this.pendingAiIdx = 0;

        // Street label animation
        this.streetLabel = '';
        this.labelAlpha  = 0;

        // Action badges [{x,y,text,color,age,displayAlpha}]
        this.badges = [];

        // Dealer / blinds (rotation)
        this.dealerSeat = -1; // becomes 0 on first hand via _startHand
        this.sbSeat = 0;
        this.bbSeat = 0;
        this.turnSeat = 0; // who acts now (seat index: 0 = you, 1+ = AI)
        this.actedThisStreet = [];
        this.playerAllIn = false;

        // Coach panel auto-refresh signals
        this.streetJustChanged   = false;
        this.playerTurnStarted    = false;

        // Animation states
        this.dealingCards = false;
        this.dealAnimProgress = 0;
        this.dealAnimDuration = 0.8;
        this.chipAnimations = [];
        this.particleEffects = [];

        // Action log (bottom-left)
        this.actionLog = [];

        // Flash result HTML
        this.resultTimer = 0;

        // Emoji reactions
        this.emojiOptions = ['😎','🔥','😤','😂','💰','👏','🤯','💀'];
        this.floatingEmojis = [];  // [{emoji,x,y,age,lifetime,vx,vy,size}]
        this.emojiBarVisible = false;

        // Seats
        this.seats = this._calcSeats(tableCfg.numAI);

        this._startHand();
    }

    // ── Seats ─────────────────────────────────────────────────────────────────

    _calcSeats(numAI) {
        const cx = C.WIDTH / 2, cy = C.HEIGHT / 2;
        const seats = [{ x: cx, y: cy + 195, isPlayer: true }];

        if (numAI === 2) {
            seats.push({ x: cx - 240, y: cy - 55 });
            seats.push({ x: cx + 240, y: cy - 55 });
        } else if (numAI === 3) {
            seats.push({ x: cx - 290, y: cy - 20 });
            seats.push({ x: cx,       y: cy - 190 });
            seats.push({ x: cx + 290, y: cy - 20 });
        } else if (numAI === 4) {
            seats.push({ x: cx - 290, y: cy + 35 });
            seats.push({ x: cx - 145, y: cy - 170 });
            seats.push({ x: cx + 145, y: cy - 170 });
            seats.push({ x: cx + 290, y: cy + 35 });
        }
        return seats;
    }

    // ── Hand lifecycle ────────────────────────────────────────────────────────

    _startHand() {
        this.deck          = new Deck();
        this.playerCards   = [];
        this.playerFolded  = false;
        this.playerBet     = 0;
        this.playerInvestedThisHand = 0;
        this.playerMuckedShowdown = false;
        this.showdownRevealPlayer = false;
        this.community     = [];
        this.revealedCount = 0;
        this.revealTimer   = 0;
        this.pot           = 0;
        this.currentBet    = 0;
        this.round         = 'preflop';
        this.showdownResults = [];
        this.lastResult    = null;
        this.actionLog     = [];
        this.badges        = [];
        this.streetLabel   = '';
        this.labelAlpha    = 0;
        this.resultTimer   = 0;
        this.streetJustChanged    = false;
        this.playerTurnStarted    = false;
        this.playerAllIn = false;
        this.dealingCards = true;
        this.dealAnimProgress = 0;
        this.chipAnimations = [];
        this.particleEffects = [];

        for (const ai of this.aiPlayers) {
            ai.reset();
            if (ai.chips <= 0) ai.chips = this.cfg.buyIn * 3;
        }

        const n = this._numSeats();
        this.dealerSeat = (this.dealerSeat + 1 + n * 10) % n;

        this._postBlinds();
        this._dealHoleCards();

        this.actedThisStreet = new Array(n).fill(false);
        this._seekFirstActor(this._firstPreflopActor());
    }

    _numSeats() {
        return 1 + this.aiPlayers.length;
    }

    /** Clockwise order around the felt — matches seat order in `_calcSeats`. */
    _clockwiseOrder() {
        const n = this._numSeats();
        const ord = [];
        for (let i = 0; i < n; i++) ord.push(i);
        return ord;
    }

    _nextSeatClockwise(seat) {
        const ord = this._clockwiseOrder();
        const i = ord.indexOf(seat);
        return ord[(i + 1) % ord.length];
    }

    _stackChipsAtSeat(seat) {
        if (seat === 0) return this.playerChips;
        return this.aiPlayers[seat - 1].chips;
    }

    _postChipsFromSeat(seat, amount) {
        const pay = Math.max(0, Math.min(amount, this._stackChipsAtSeat(seat)));
        if (pay <= 0) return;
        const seatPos = this.seats[seat];
        if (seat === 0) {
            this.playerChips -= pay;
            this.playerBet += pay;
            this.playerInvestedThisHand += pay;
            this.pot += pay;
            if (this.playerChips === 0) this.playerAllIn = true;
        } else {
            const ai = this.aiPlayers[seat - 1];
            ai.chips -= pay;
            ai.currentBet += pay;
            ai.investedThisHand += pay;
            this.pot += pay;
            if (ai.chips === 0) ai.isAllIn = true;
        }
        // Trigger chip animation
        if (seatPos) {
            this.chipAnimations.push({
                fromX: seatPos.x, fromY: seatPos.y,
                toX: C.WIDTH / 2, toY: C.HEIGHT / 2 - 210,
                progress: 0, amount: pay
            });
        }
    }

    _postBlinds() {
        this.playerBet = 0;
        for (const ai of this.aiPlayers) {
            ai.currentBet = 0;
        }

        const n = this._numSeats();
        const ord = this._clockwiseOrder();
        const di = ord.indexOf(this.dealerSeat);

        if (n === 2) {
            this.sbSeat = this.dealerSeat;
            this.bbSeat = this._nextSeatClockwise(this.sbSeat);
        } else {
            this.sbSeat = ord[(di + 1) % n];
            this.bbSeat = ord[(di + 2) % n];
        }

        const sbPay = Math.min(this.smallBlind, this._stackChipsAtSeat(this.sbSeat));
        this._postChipsFromSeat(this.sbSeat, sbPay);

        const bbPay = Math.min(this.bigBlind, this._stackChipsAtSeat(this.bbSeat));
        this._postChipsFromSeat(this.bbSeat, bbPay);

        this.currentBet = Math.max(this.playerBet,
            ...this.aiPlayers.map(a => a.currentBet));
        this.minRaise = this.bigBlind;
    }

    _firstPreflopActor() {
        if (this._numSeats() === 2) return this.dealerSeat;
        return this._nextSeatClockwise(this.bbSeat);
    }

    _firstPostflopActor() {
        return this._nextSeatClockwise(this.dealerSeat);
    }

    _isSeatFolded(seat) {
        if (seat === 0) return this.playerFolded;
        return this.aiPlayers[seat - 1].folded;
    }

    _seatCanAct(seat) {
        if (this._isSeatFolded(seat)) return false;
        if (seat === 0) return !this.playerAllIn;
        return !this.aiPlayers[seat - 1].isAllIn;
    }

    _callAmountForSeat(seat) {
        if (this._isSeatFolded(seat)) return 0;
        if (seat === 0) {
            if (this.playerAllIn) return 0;
            return Math.max(0, this.currentBet - this.playerBet);
        }
        const ai = this.aiPlayers[seat - 1];
        if (ai.isAllIn) return 0;
        return Math.max(0, this.currentBet - ai.currentBet);
    }

    _seatNeedsToAct(seat) {
        if (!this._seatCanAct(seat)) return false;
        if (this._callAmountForSeat(seat) > 0) return true;
        return !this.actedThisStreet[seat];
    }

    _bettingRoundComplete() {
        const n = this._numSeats();
        for (let s = 0; s < n; s++) {
            if (this._isSeatFolded(s)) continue;
            if (this._seatCanAct(s)) {
                if (!this.actedThisStreet[s]) return false;
                if (this._callAmountForSeat(s) > 0) return false;
            } else if (this._callAmountForSeat(s) > 0) return false;
        }
        return true;
    }

    _resetActedAfterRaise(seat) {
        const n = this._numSeats();
        this.actedThisStreet = new Array(n).fill(false);
        this.actedThisStreet[seat] = true;
    }

    _syncTurnState() {
        if (this.turnSeat === 0) {
            this.state = 'player_action';
            this.playerTurnStarted = true;
        } else {
            this.state = 'ai_turn';
            this.pendingAiIdx = this.turnSeat - 1;
            this.aiTimer = 0;
            this.aiThinkTime = 0.18 + Math.random() * 0.25;
        }
    }

    _anySeatCanAct() {
        const n = this._numSeats();
        for (let s = 0; s < n; s++) {
            if (!this._isSeatFolded(s) && this._seatCanAct(s)) return true;
        }
        return false;
    }

    _seekFirstActor(startSeat) {
        const n = this._numSeats();
        let s = startSeat;
        for (let k = 0; k < n; k++) {
            if (this._seatCanAct(s) && this._seatNeedsToAct(s)) {
                this.turnSeat = s;
                this._syncTurnState();
                return;
            }
            s = this._nextSeatClockwise(s);
        }
        if (this._bettingRoundComplete() || !this._anySeatCanAct()) {
            this._advanceStreetOrShowdown();
        }
    }

    _afterSeatActs(fromSeat) {
        const active = this._getActivePlayers();
        if (active.length <= 1) {
            this._singleWinner(active[0]);
            return;
        }
        if (this._bettingRoundComplete()) {
            this._advanceStreetOrShowdown();
            return;
        }

        const n = this._numSeats();
        let s = this._nextSeatClockwise(fromSeat);
        for (let k = 0; k < n; k++) {
            if (this._seatCanAct(s) && this._seatNeedsToAct(s)) {
                this.turnSeat = s;
                this._syncTurnState();
                return;
            }
            s = this._nextSeatClockwise(s);
        }
        if (this._bettingRoundComplete() || !this._anySeatCanAct()) {
            this._advanceStreetOrShowdown();
        }
    }

    _advanceStreetOrShowdown() {
        const active = this._getActivePlayers();
        if (active.length === 1) {
            this._singleWinner(active[0]);
            return;
        }

        const streets = ['preflop', 'flop', 'turn', 'river'];
        const nextIdx = streets.indexOf(this.round) + 1;

        if (nextIdx >= streets.length) {
            this._doShowdown();
            return;
        }

        const prevCount = this.community.length;
        this.round = streets[nextIdx];
        this._dealCommunity();
        this._resetBetsForStreet();

        this.revealedCount = prevCount;
        this.revealTimer = 0;

        this.streetLabel = { flop: 'FLOP', turn: 'TURN', river: 'RIVER' }[this.round] || '';
        this.labelAlpha = 1.4;

        this.state = 'street_pause';
        this.pauseTimer = 1.2;
    }

    _dealHoleCards() {
        const n = this.gameType === 'omaha' ? 4 : 2;
        this.playerCards = this.deck.deal(n);
        for (const ai of this.aiPlayers) ai.holeCards = this.deck.deal(n);
        if (typeof Sounds !== 'undefined') Sounds.play('deal');
    }

    // ── Player actions ────────────────────────────────────────────────────────

    playerFold() {
        if (this.state !== 'player_action') return;
        this.playerFolded = true;
        this._logAction('You', 'fold', 0);
        this._addBadge(0, 'FOLD', '#ff6666');
        if (typeof Sounds !== 'undefined') Sounds.play('fold');
        this._afterSeatActs(0);
    }

    playerCheck() {
        if (this.state !== 'player_action') return;
        if (this.currentBet > this.playerBet) return;
        this._logAction('You', 'check', 0);
        this._addBadge(0, 'CHECK', '#aaaaaa');
        if (typeof Sounds !== 'undefined') Sounds.play('check');
        this.actedThisStreet[0] = true;
        this._afterSeatActs(0);
    }

    playerCall() {
        if (this.state !== 'player_action') return;
        const amount = Math.min(this.currentBet - this.playerBet, this.playerChips);
        this.playerChips -= amount;
        this.playerBet   += amount;
        this.playerInvestedThisHand += amount;
        this.pot         += amount;
        if (this.playerChips === 0) this.playerAllIn = true;
        this._logAction('You', amount > 0 ? 'call' : 'check', amount);
        if (typeof Sounds !== 'undefined') Sounds.play(amount > 0 ? 'call' : 'check');
        this._addBadge(0, amount > 0 ? `CALL $${amount}` : 'CHECK', '#66bb66');
        this.actedThisStreet[0] = true;
        this._afterSeatActs(0);
    }

    playerRaise(amount) {
        if (this.state !== 'player_action') return;
        const callFirst = this.currentBet - this.playerBet;
        const total     = Math.min(callFirst + amount, this.playerChips);
        this.playerChips -= total;
        this.playerBet   += total;
        this.playerInvestedThisHand += total;
        this.pot         += total;
        if (this.playerChips === 0) this.playerAllIn = true;
        this.currentBet   = this.playerBet;
        this.minRaise     = amount;
        this._logAction('You', 'raise', total);
        this._addBadge(0, `RAISE $${total}`, '#f5d76e');
        if (typeof Sounds !== 'undefined') Sounds.play('raise');
        this._resetActedAfterRaise(0);
        this._afterSeatActs(0);
    }

    /** After showdown: show cards (true) or muck (face-down display only). */
    playerShowdownChoice(showCards) {
        if (this.state !== 'showdown_choice') return;
        this.showdownRevealPlayer = !!showCards;
        this.playerMuckedShowdown = !showCards;
        this._applyShowdownPayouts();
        this.state = 'showdown';
        this.pauseTimer = 2.2;
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(dt) {
        switch (this.state) {
            case 'showdown_choice':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) this.playerShowdownChoice(true);
                break;
            case 'ai_turn':
                this.aiTimer += dt;
                if (this.aiTimer >= this.aiThinkTime) this._doAiAction();
                break;

            case 'street_pause':
                // Reveal community cards one by one
                if (this.revealedCount < this.community.length) {
                    this.revealTimer += dt;
                    if (this.revealTimer >= this.REVEAL_SPEED) {
                        this.revealedCount++;
                        this.revealTimer = 0;
                    }
                }
                // Fade out street label
                if (this.labelAlpha > 0) this.labelAlpha -= dt * 0.5;
                // Wait for all cards + minimum pause
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0 && this.revealedCount >= this.community.length) {
                    this._afterStreetPause();
                }
                break;

            case 'showdown':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) {
                    this.state      = 'hand_over';
                    this.pauseTimer = 1.5;
                }
                break;

            case 'hand_over':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0 && this.playerChips > 0) {
                    this._startHand();
                }
                // If playerChips <= 0, stay — main.js detects bust
                break;
        }

        // Card dealing animation
        if (this.dealingCards) {
            this.dealAnimProgress += dt / this.dealAnimDuration;
            if (this.dealAnimProgress >= 1) {
                this.dealingCards = false;
                this.dealAnimProgress = 1;
            }
        }

        // Chip animations (sliding to pot)
        this.chipAnimations.forEach(anim => {
            anim.progress += dt / 0.6;
        });
        this.chipAnimations = this.chipAnimations.filter(anim => anim.progress < 1);

        // Floating emoji animations
        this.floatingEmojis.forEach(e => {
            e.age += dt;
            e.y -= e.vy * dt;
            e.x += e.vx * dt;
            e.vy *= 0.98;
        });
        this.floatingEmojis = this.floatingEmojis.filter(e => e.age < e.lifetime);

        // Show emoji bar during showdown/hand_over
        const showEmoji = this.state === 'showdown' || this.state === 'hand_over' || this.state === 'showdown_choice';
        this.emojiBarVisible = showEmoji;

        // Particle effects
        this.particleEffects.forEach(p => {
            p.age += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 80 * dt;
            p.alpha = Math.max(0, 1 - p.age / p.lifetime);
        });
        this.particleEffects = this.particleEffects.filter(p => p.alpha > 0.02);

        // Badges: upward drift + fade-in, then fade out
        const fadeInDur = 0.28;
        this.badges.forEach(b => {
            b.age += dt;
            b.y -= dt * 12;
            if (b.age < fadeInDur) {
                const t = b.age / fadeInDur;
                b.displayAlpha = t * t * (3 - 2 * t);
            } else {
                b.displayAlpha = Math.max(0, 1 - (b.age - fadeInDur) * 1.05);
            }
        });
        this.badges = this.badges.filter(b => b.displayAlpha > 0.02);

        // Flash result HTML timer
        if (this.resultTimer > 0) {
            this.resultTimer -= dt;
            if (this.resultTimer <= 0) {
                document.getElementById('result-flash')?.classList.add('hidden');
            }
        }
    }

    // ── AI actions ────────────────────────────────────────────────────────────

    _doAiAction() {
        const idx = this.turnSeat - 1;
        if (idx < 0 || idx >= this.aiPlayers.length) {
            this._afterSeatActs(this.turnSeat);
            return;
        }
        const ai = this.aiPlayers[idx];
        if (ai.folded || ai.isAllIn) {
            this._afterSeatActs(this.turnSeat);
            return;
        }

        const callAmt = Math.max(0, this.currentBet - ai.currentBet);
        const decision = ai.decide({
            pot: this.pot, callAmount: callAmt,
            community: this.community, gameType: this.gameType,
            round: this.round, bigBlind: this.bigBlind,
            position: this.turnSeat, playerCount: this._numSeats()
        });

        this._executeAiAction(ai, idx, decision, callAmt);
        this.aiTimer = 0;
        this.aiThinkTime = 0.15 + Math.random() * 0.2;
        this._afterSeatActs(this.turnSeat);
    }

    _executeAiAction(ai, aiIdx, decision, callAmt) {
        const seat = aiIdx + 1;
        const seatIdx = seat;
        switch (decision.action) {
            case 'fold':
                ai.folded = true;
                this._logAction(ai.name, 'fold', 0);
                this._addBadge(seatIdx, 'FOLD', '#ff6666');
                break;
            case 'check':
                this._logAction(ai.name, 'check', 0);
                this._addBadge(seatIdx, 'CHECK', '#aaaaaa');
                this.actedThisStreet[seat] = true;
                break;
            case 'call': {
                const pay = Math.min(callAmt, ai.chips);
                ai.chips       -= pay;
                ai.currentBet  += pay;
                ai.investedThisHand += pay;
                this.pot       += pay;
                if (ai.chips === 0) ai.isAllIn = true;
                this._logAction(ai.name, pay > 0 ? 'call' : 'check', pay);
                this._addBadge(seatIdx, pay > 0 ? `CALL $${pay}` : 'CHECK', '#66bb66');
                this.actedThisStreet[seat] = true;
                break;
            }
            case 'raise': {
                const pay = Math.min(decision.amount, ai.chips);
                ai.chips      -= pay;
                ai.currentBet += pay;
                ai.investedThisHand += pay;
                this.pot      += pay;
                if (ai.chips === 0) ai.isAllIn = true;
                if (ai.currentBet > this.currentBet) {
                    this.currentBet = ai.currentBet;
                    this.minRaise   = pay;
                    this._resetActedAfterRaise(seat);
                } else {
                    this.actedThisStreet[seat] = true;
                }
                this._logAction(ai.name, 'raise', pay);
                this._addBadge(seatIdx, `RAISE $${pay}`, '#f5d76e');
                break;
            }
        }
    }

    // ── Round/street management ───────────────────────────────────────────────

    _afterStreetPause() {
        this.streetLabel = '';
        this.labelAlpha  = 0;
        this.streetJustChanged = true;
        this._seekFirstActor(this._firstPostflopActor());
    }

    _dealCommunity() {
        this.deck.dealOne(); // burn
        if (this.round === 'flop') {
            this.community.push(...this.deck.deal(3));
        } else if (this.round === 'turn' || this.round === 'river') {
            this.community.push(this.deck.dealOne());
        }
    }

    _resetBetsForStreet() {
        this.currentBet = 0;
        this.playerBet  = 0;
        this.minRaise   = this.bigBlind;
        this.pendingAiIdx = 0;
        for (const ai of this.aiPlayers) ai.currentBet = 0;
        this.actedThisStreet = new Array(this._numSeats()).fill(false);
    }

    _getActivePlayers() {
        const active = [];
        if (!this.playerFolded) active.push({ type: 'player', ref: null });
        for (const ai of this.aiPlayers) {
            if (!ai.folded) active.push({ type: 'ai', ref: ai });
        }
        return active;
    }

    // ── Win resolution ────────────────────────────────────────────────────────

    _singleWinner(winner) {
        const winPot = this.pot;
        if (winner.type === 'player') {
            this.playerChips += winPot;
            this._flashResult(`+$${winPot}`, 'win');
            this._createWinParticles(C.WIDTH / 2, C.HEIGHT / 2 - 210);
        } else {
            winner.ref.chips += winPot;    // ← pay the AI
            if (!this.playerFolded) this._flashResult(`-$${this.playerBet}`, 'lose');
        }
        this.lastResult = { winner, pot: winPot, reason: 'fold' };
        this.pot        = 0;
        this.state      = 'hand_over';
        this.pauseTimer = 1.5;
        if (typeof Game !== 'undefined' && Game._afterFoldWin) {
            Game._afterFoldWin({ playerWon: winner.type === 'player', amount: winPot });
        }
    }

    _doShowdown() {
        this.showdownResults = [];

        const evalHand = (cards) => this.gameType === 'holdem'
            ? HandEvaluator.bestOf7([...cards, ...this.community])
            : HandEvaluator.bestOmaha(cards, this.community);

        const contestants = [];
        if (!this.playerFolded) {
            contestants.push({
                name: 'You', type: 'player', ref: null, seatIndex: 0,
                hand: evalHand(this.playerCards), cards: this.playerCards
            });
        }
        for (let i = 0; i < this.aiPlayers.length; i++) {
            const ai = this.aiPlayers[i];
            if (!ai.folded) {
                contestants.push({
                    name: ai.name, type: 'ai', ref: ai, seatIndex: i + 1,
                    hand: evalHand(ai.holeCards), cards: ai.holeCards
                });
            }
        }

        contestants.sort((a, b) => (b.hand?.score || 0) - (a.hand?.score || 0));
        this.showdownResults = contestants;

        const needsPlayerChoice = !this.playerFolded && contestants.some(c => c.type === 'player');
        if (needsPlayerChoice) {
            this.state = 'showdown_choice';
            this.pauseTimer = 5;
            this.playerMuckedShowdown = false;
        this.showdownRevealPlayer = false;
            return;
        }

        this._applyShowdownPayouts();
        this.state = 'showdown';
        this.pauseTimer = 4.0;
    }

    _applyShowdownPayouts() {
        const inv = new Map();
        inv.set(0, this.playerInvestedThisHand);
        this.aiPlayers.forEach((ai, i) => inv.set(i + 1, ai.investedThisHand || 0));

        const players = this.showdownResults.map(c => ({
            seat: c.seatIndex,
            folded: false,
            handScore: c.hand?.score || 0
        }));

        const payouts = typeof distributeSidePots === 'function'
            ? distributeSidePots(inv, players)
            : this._fallbackSinglePotPayout(players);

        let playerWon = payouts.get(0) || 0;
        this.playerChips += playerWon;
        this.aiPlayers.forEach((ai, i) => {
            const add = payouts.get(i + 1) || 0;
            ai.chips += add;
        });

        const potBefore = this.pot;
        this.pot = 0;

        const winner = this.showdownResults[0];
        if (playerWon > 0) {
            this._flashResult(`+$${playerWon}`, 'win');
            this._createWinParticles(C.WIDTH / 2, C.HEIGHT / 2 - 210);
            if (typeof Sounds !== 'undefined') Sounds.play('win');
        } else if (!this.playerFolded && winner.type !== 'player') {
            this._flashResult(`-$${this.playerBet}`, 'lose');
        }

        this.lastResult = {
            winner,
            contestants: this.showdownResults,
            pot: playerWon,
            potTotal: potBefore,
            reason: 'showdown'
        };

        if (typeof Game !== 'undefined' && Game._afterShowdownPayout) {
            Game._afterShowdownPayout({ playerWon, potTotal: potBefore, won: playerWon > 0 });
        }
    }

    _fallbackSinglePotPayout(players) {
        const m = new Map();
        const best = Math.max(...players.map(p => p.handScore));
        const winners = players.filter(p => p.handScore === best);
        const share = Math.floor(this.pot / winners.length);
        let rem = this.pot - share * winners.length;
        winners.forEach((w, i) => {
            m.set(w.seat, share + (i < rem ? 1 : 0));
        });
        return m;
    }

    _flashResult(text, type) {
        const el = document.getElementById('result-flash');
        if (!el) return;
        el.textContent = text;
        el.className   = type;
        el.classList.remove('hidden');
        this.resultTimer = 2.8;
    }

    // ── Logging / badges ──────────────────────────────────────────────────────

    _logAction(name, action, amount) {
        let msg = `${name}: ${action}`;
        if (amount > 0) msg += ` $${amount}`;
        this.actionLog.unshift(msg);
        if (this.actionLog.length > 6) this.actionLog.pop();
    }

    _addBadge(seatIdx, text, color) {
        const seat = this.seats[seatIdx];
        if (!seat) return;
        // Replace existing badge for same seat
        this.badges = this.badges.filter(b => b.seatIdx !== seatIdx);
        this.badges.push({
            seatIdx, x: seat.x, y: seat.y - 58, text, color,
            age: 0, displayAlpha: 0
        });
    }

    _aiColors(name) {
        let h = 0;
        for (let i = 0; i < name.length; i++) {
            h = ((h << 5) - h + name.charCodeAt(i)) | 0;
        }
        const shirtHue = Math.abs(h) % 360;
        const hairHue  = Math.abs(h * 17) % 360;
        const skins = ['#f5d0ba', '#e8b89a', '#d4a574', '#c68642', '#8d5524'];
        const skinColor = skins[Math.abs(h) % skins.length];
        return {
            shirtColor: `hsl(${shirtHue}, 54%, 40%)`,
            hairColor:  `hsl(${hairHue}, 44%, 22%)`,
            skinColor
        };
    }

    _createWinParticles(x, y) {
        const colors = ['#ffd700', '#ffed4e', '#ffea00', '#ffc700', '#ff9a00'];
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const speed = 120 + Math.random() * 80;
            this.particleEffects.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 60,
                age: 0,
                lifetime: 1.2,
                alpha: 1,
                color: colors[i % colors.length],
                size: 4 + Math.random() * 3
            });
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    render(ctx) {
        this._drawBackground(ctx);
        this._drawTable(ctx);
        this._drawCommunityCards(ctx);
        this._drawSeats(ctx);
        this._drawBlindButtonMarkers(ctx);
        this._drawPot(ctx);
        this._drawChipAnimations(ctx);
        this._drawBadges(ctx);
        this._drawParticleEffects(ctx);
        this._drawStreetLabel(ctx);
        this._drawActionLog(ctx);
        this._drawRoundIndicator(ctx);
        if (this.state === 'showdown' || this.state === 'hand_over' || this.state === 'showdown_choice') {
            this._drawShowdownCards(ctx);
            this._drawResultBanner(ctx);
        }
        this._drawFloatingEmojis(ctx);
    }

    _drawBackground(ctx) {
        const W = C.WIDTH, H = C.HEIGHT;

        const room = ctx.createLinearGradient(0, 0, 0, H);
        room.addColorStop(0, '#1a0518');
        room.addColorStop(0.22, '#120410');
        room.addColorStop(0.55, '#070308');
        room.addColorStop(1, '#020102');
        ctx.fillStyle = room;
        ctx.fillRect(0, 0, W, H);

        const drapes = ctx.createLinearGradient(0, 0, W, 0);
        drapes.addColorStop(0, 'rgba(45,8,22,0.55)');
        drapes.addColorStop(0.2, 'rgba(25,4,18,0.12)');
        drapes.addColorStop(0.5, 'rgba(18,3,14,0.08)');
        drapes.addColorStop(0.8, 'rgba(25,4,18,0.12)');
        drapes.addColorStop(1, 'rgba(45,8,22,0.55)');
        ctx.fillStyle = drapes;
        ctx.fillRect(0, 0, W, H * 0.42);

        const spot = ctx.createRadialGradient(W / 2, H * 0.28, 40, W / 2, H * 0.42, 420);
        spot.addColorStop(0, 'rgba(255,232,180,0.14)');
        spot.addColorStop(0.35, 'rgba(200,168,75,0.06)');
        spot.addColorStop(0.7, 'transparent');
        ctx.fillStyle = spot;
        ctx.fillRect(0, 0, W, H);

        const vignette = ctx.createRadialGradient(W / 2, H / 2 + 20, 160, W / 2, H / 2, 720);
        vignette.addColorStop(0, 'transparent');
        vignette.addColorStop(0.55, 'rgba(0,0,0,0.25)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.strokeStyle = 'rgba(212,175,55,0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
            const y = 90 + i * 14;
            ctx.globalAlpha = 0.35 - i * 0.03;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
        ctx.restore();

        const theme = this.theme;
        const diff  = this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1);
        const type  = this.gameType === 'holdem' ? "Texas Hold'em" : 'Omaha';
        ctx.save();
        ctx.font         = 'bold 11px Georgia, serif';
        ctx.fillStyle    = 'rgba(212,175,55,0.35)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('K I E F E R \' S   P A L A C E', W / 2, 10);
        ctx.font         = '13px Georgia, serif';
        ctx.fillStyle    = 'rgba(245,230,200,0.75)';
        ctx.shadowColor  = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur   = 4;
        ctx.fillText(
            `${C.THEMES[this.cfg.theme].name}   ·   ${type}   ·   ${diff}   ·   $${this.smallBlind}/$${this.bigBlind}`,
            W / 2, 28
        );
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    _drawTable(ctx) {
        const cx = C.WIDTH / 2, cy = C.HEIGHT / 2;
        const rx = 420, ry = 185;
        const theme = this.theme;
        ctx.save();

        // === Table shadow on floor ===
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 60;
        ctx.shadowOffsetY = 16;
        Utils.fillEllipse(ctx, cx, cy + 6, rx + 30, ry + 28, 'rgba(0,0,0,0.5)');
        ctx.shadowOffsetY = 0;
        ctx.shadowBlur = 0;

        // === Outer wooden base (dark mahogany) ===
        const baseGrad = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 20, cx, cy, rx + 30);
        baseGrad.addColorStop(0, '#5c3310');
        baseGrad.addColorStop(0.4, '#3a1e08');
        baseGrad.addColorStop(1, '#1a0e04');
        Utils.fillEllipse(ctx, cx, cy, rx + 22, ry + 20, baseGrad);

        // === Padded bumper rail (leather look) ===
        const railGrad = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
        railGrad.addColorStop(0, '#4a3520');
        railGrad.addColorStop(0.3, '#3a2515');
        railGrad.addColorStop(0.5, '#5a4030');
        railGrad.addColorStop(0.7, '#3a2515');
        railGrad.addColorStop(1, '#2a1a0a');
        Utils.fillEllipse(ctx, cx, cy, rx + 14, ry + 12, railGrad);

        // Rail highlight (top light reflection)
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx + 14, ry + 12, 0, -Math.PI * 0.85, -Math.PI * 0.15);
        ctx.strokeStyle = 'rgba(255,240,200,0.15)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        // Rail inner edge shadow
        Utils.strokeEllipse(ctx, cx, cy, rx + 6, ry + 5, 'rgba(0,0,0,0.5)', 3);

        // === Gold trim line (thin inlay between rail and felt) ===
        Utils.strokeEllipse(ctx, cx, cy, rx + 3, ry + 2, theme.trim, 1.5);
        // Inner gold line
        Utils.strokeEllipse(ctx, cx, cy, rx - 1, ry, 'rgba(212,175,55,0.25)', 0.8);

        // === Main felt surface ===
        const feltGrad = ctx.createRadialGradient(cx, cy - ry * 0.25, 30, cx, cy + ry * 0.1, rx);
        feltGrad.addColorStop(0, theme.felt);
        feltGrad.addColorStop(0.4, theme.felt);
        feltGrad.addColorStop(0.75, this._shadeColor(theme.felt, 0.2));
        feltGrad.addColorStop(1, this._shadeColor(theme.felt, 0.45));
        Utils.fillEllipse(ctx, cx, cy, rx - 4, ry - 3, feltGrad);

        // === Felt texture (subtle crosshatch pattern) ===
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx - 6, ry - 5, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = 0.03;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 0.5;
        for (let d = -800; d < 1600; d += 24) {
            ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + 800, C.HEIGHT); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(d + 800, 0); ctx.lineTo(d, C.HEIGHT); ctx.stroke();
        }
        ctx.restore();

        // === Center spotlight on felt ===
        const spotlight = ctx.createRadialGradient(cx, cy - 20, 10, cx, cy, rx * 0.6);
        spotlight.addColorStop(0, 'rgba(255,255,255,0.06)');
        spotlight.addColorStop(1, 'transparent');
        ctx.fillStyle = spotlight;
        Utils.fillEllipse(ctx, cx, cy, rx * 0.5, ry * 0.5, spotlight);

        // === Center logo on felt (like real casino branding) ===
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.font = 'bold 42px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText("KIEFER'S", cx, cy + ry * 0.42);
        ctx.font = '16px Georgia, serif';
        ctx.fillText('P A L A C E', cx, cy + ry * 0.42 + 28);
        ctx.restore();

        // === Betting line (oval where bets go, like real tables) ===
        ctx.save();
        ctx.setLineDash([8, 8]);
        Utils.strokeEllipse(ctx, cx, cy, rx * 0.55, ry * 0.55, 'rgba(255,255,255,0.06)', 1);
        ctx.setLineDash([]);
        ctx.restore();

        // === Theme-specific accent ===
        if (this.cfg.theme === 'cyber') {
            ctx.save();
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 18;
            Utils.strokeEllipse(ctx, cx, cy, rx - 4, ry - 3, 'rgba(0,229,255,0.35)', 1.5);
            ctx.restore();
        }

        ctx.restore();
    }

    _lightenTrim(trimHex, amt) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(trimHex || '');
        if (!m) return trimHex || '#c8a84b';
        const r = Utils.clamp(parseInt(m[1], 16) + amt * 255, 0, 255) | 0;
        const g = Utils.clamp(parseInt(m[2], 16) + amt * 255, 0, 255) | 0;
        const b = Utils.clamp(parseInt(m[3], 16) + amt * 255, 0, 255) | 0;
        return `rgb(${r},${g},${b})`;
    }

    _shadeColor(hex, darken) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return hex;
        const r = Math.max(0, parseInt(m[1], 16) * (1 - darken));
        const g = Math.max(0, parseInt(m[2], 16) * (1 - darken));
        const b = Math.max(0, parseInt(m[3], 16) * (1 - darken));
        return `rgb(${r|0},${g|0},${b|0})`;
    }

    _drawCommunityCards(ctx) {
        const cx = C.WIDTH / 2, cy = C.HEIGHT / 2;
        const cw = 58, ch = 82, spacing = 66;
        const startX = cx - spacing * 2;

        // Cards sit directly on the felt — no dark box, just like a real table
        const visible = (this.state === 'street_pause') ? this.revealedCount : this.community.length;

        for (let i = 0; i < 5; i++) {
            const x = startX + i * spacing - cw / 2;
            const y = cy - ch / 2 - 12;

            if (i < visible) {
                // Subtle card shadow on felt
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.45)';
                ctx.shadowBlur = 8;
                ctx.shadowOffsetY = 3;

                // Flip animation for newest card
                const isNew = i === visible - 1 && this.state === 'street_pause' && this.revealTimer < 0.25;
                if (isNew) {
                    ctx.shadowColor = this.theme.trim;
                    ctx.shadowBlur = 18;
                    const flipProgress = (0.25 - this.revealTimer) / 0.25;
                    const scaleX = Math.sin(flipProgress * Math.PI * 0.5);
                    if (scaleX > 0.05) {
                        ctx.translate(x + cw / 2, y + ch / 2);
                        ctx.scale(scaleX, 1);
                        ctx.translate(-(x + cw / 2), -(y + ch / 2));
                    }
                }
                this._drawCard(ctx, x, y, cw, ch, this.community[i], true);
                ctx.restore();
            } else if (i < 5) {
                // Ghost outline on felt showing where cards will go
                ctx.save();
                ctx.globalAlpha = 0.08;
                Utils.roundRect(ctx, x, y, cw, ch, 5);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    _drawCard(ctx, x, y, w, h, card, faceUp) {
        const rad = 6;
        ctx.save();
        ctx.shadowColor   = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur    = 10;
        ctx.shadowOffsetX = 2.5;
        ctx.shadowOffsetY = 2.5;
        Utils.roundRect(ctx, x, y, w, h, rad);
        ctx.fillStyle = faceUp ? '#f8f8f0' : '#183060';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        Utils.roundRect(ctx, x, y, w, h, rad);
        ctx.clip();

        if (faceUp) {
            // Subtle gradient background for card face
            const faceGrad = ctx.createLinearGradient(x, y, x, y + h);
            faceGrad.addColorStop(0, '#fafaf8');
            faceGrad.addColorStop(0.5, '#f8f8f0');
            faceGrad.addColorStop(1, '#f0f0e8');
            ctx.fillStyle = faceGrad;
            ctx.fillRect(x, y, w, h);

            const hi = ctx.createLinearGradient(x, y, x, y + h * 0.45);
            hi.addColorStop(0, 'rgba(255,255,255,0.95)');
            hi.addColorStop(0.45, 'rgba(255,255,255,0)');
            ctx.fillStyle = hi;
            ctx.fillRect(x, y, w, h * 0.5);

            const color = card.isRed ? '#c0202a' : '#1a1a2e';

            ctx.font         = `bold ${Math.floor(h * 0.2)}px Arial`;
            ctx.fillStyle    = color;
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(card.rank, x + 4, y + 3);
            ctx.font = `${Math.floor(h * 0.17)}px Arial`;
            ctx.fillText(card.suit, x + 4, y + 3 + h * 0.2);

            ctx.save();
            ctx.shadowColor = card.isRed ? 'rgba(192,32,42,0.45)' : 'rgba(26,26,46,0.5)';
            ctx.shadowBlur  = 6;
            ctx.font        = `${Math.floor(h * 0.5)}px Arial`;
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle   = color;
            ctx.fillText(card.suit, x + w / 2, y + h / 2);
            ctx.restore();

            ctx.save();
            ctx.translate(x + w - 4, y + h - 3);
            ctx.rotate(Math.PI);
            ctx.font         = `bold ${Math.floor(h * 0.2)}px Arial`;
            ctx.fillStyle    = color;
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(card.rank, 0, 0);
            ctx.restore();
        } else {
            // Realistic card back with gradient
            const backGrad = ctx.createLinearGradient(x, y, x, y + h);
            backGrad.addColorStop(0, '#1f4788');
            backGrad.addColorStop(0.5, '#183060');
            backGrad.addColorStop(1, '#0f1f40');
            ctx.fillStyle = backGrad;
            ctx.fillRect(x, y, w, h);

            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth   = 1;
            for (let i = 1; i <= 4; i++) {
                Utils.roundRect(ctx, x + i * 2.2, y + i * 2.2, w - i * 4.4, h - i * 4.4, 3);
                ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth   = 1.2;
            Utils.roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 4);
            ctx.stroke();

            ctx.fillStyle   = 'rgba(255,255,255,0.28)';
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth   = 1.2;
            ctx.beginPath();
            ctx.moveTo(x + w / 2, y + h / 2 - 14);
            ctx.lineTo(x + w / 2 + 14, y + h / 2);
            ctx.lineTo(x + w / 2, y + h / 2 + 14);
            ctx.lineTo(x + w / 2 - 14, y + h / 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();

        ctx.save();
        Utils.roundRect(ctx, x, y, w, h, rad);
        ctx.strokeStyle = faceUp ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
    }

    _drawPot(ctx) {
        if (this.pot === 0) return;
        ctx.save();
        const cx = C.WIDTH / 2;

        // Pot display above the table — top-left HUD area, never covered
        const potX = cx - 200;
        const potY = 38;

        // Dark backing pill
        const pillW = 140, pillH = 36;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        ctx.roundRect(potX - pillW / 2, potY - pillH / 2, pillW, pillH, 18);
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,168,75,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(potX - pillW / 2, potY - pillH / 2, pillW, pillH, 18);
        ctx.stroke();

        // Small chip icon
        const chipX = potX - 48;
        Utils.fillEllipse(ctx, chipX, potY + 1, 9, 5.5, '#b71c1c');
        Utils.fillEllipse(ctx, chipX, potY - 1, 9, 5.5, '#e53935');
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.ellipse(chipX, potY - 1, 9, 5.5, 0, -Math.PI * 0.8, -Math.PI * 0.2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        // POT label + amount
        ctx.font = 'bold 10px Georgia, serif';
        ctx.fillStyle = 'rgba(255,233,168,0.6)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('POT', potX - 34, potY - 5);

        ctx.font = 'bold 17px Georgia, serif';
        ctx.fillStyle = '#ffe9a8';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 4;
        ctx.fillText(`$${this.pot.toLocaleString()}`, potX - 34, potY + 10);
        ctx.shadowBlur = 0;

        ctx.restore();
    }

    _drawSeats(ctx) {
        // Draw glow under active player seat
        if (this.state === 'player_action' && !this.playerFolded && this.turnSeat === 0) {
            const seat = this.seats[0];
            ctx.save();
            const glow = ctx.createRadialGradient(seat.x, seat.y, 10, seat.x, seat.y, 120);
            glow.addColorStop(0, 'rgba(100,200,100,0.3)');
            glow.addColorStop(1, 'rgba(100,200,100,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(seat.x, seat.y, 120, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Draw glow under thinking AI seat
        for (let i = 0; i < this.aiPlayers.length; i++) {
            if (this.state === 'ai_turn' && this.turnSeat === i + 1) {
                const seat = this.seats[i + 1];
                ctx.save();
                const glow = ctx.createRadialGradient(seat.x, seat.y, 8, seat.x, seat.y, 100);
                glow.addColorStop(0, 'rgba(200,160,100,0.25)');
                glow.addColorStop(1, 'rgba(200,160,100,0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(seat.x, seat.y, 100, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        this._drawPlayerSeat(ctx, this.seats[0]);
        for (let i = 0; i < this.aiPlayers.length; i++) {
            this._drawAISeat(ctx, this.seats[i+1], this.aiPlayers[i], i);
        }
    }

    _drawBetPill(ctx, cx, cy, text, fillColor = '#ffe8b8') {
        ctx.save();
        ctx.font = 'bold 12px Georgia, serif';
        const tw = ctx.measureText(text).width;
        const w = Math.max(92, tw + 20);
        Utils.roundRect(ctx, cx - w / 2, cy - 12, w, 24, 7);
        ctx.fillStyle = 'rgba(0,0,0,0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(212,175,55,0.55)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.fillStyle = fillColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 3;
        ctx.fillText(text, cx, cy);
        ctx.shadowBlur = 0;
        ctx.restore();
    }

    _drawBlindButtonMarkers(ctx) {
        if (this.state === 'hand_over' && this.pauseTimer <= 0) return;
        ctx.save();
        const tcx = C.WIDTH / 2, tcy = C.HEIGHT / 2;
        const n = this._numSeats();

        // Place markers on the felt BETWEEN player and table center
        for (let s = 0; s < n; s++) {
            const st = this.seats[s];
            // Position marker 40% of the way from seat toward table center
            const mx = st.x + (tcx - st.x) * 0.38;
            const my = st.y + (tcy - st.y) * 0.38;
            let xOff = 0;

            const drawChip = (x, y, bgOuter, bgInner, label, textColor) => {
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetY = 2;
                Utils.fillEllipse(ctx, x, y, 13, 13, bgOuter);
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                Utils.fillEllipse(ctx, x, y, 11, 11, bgInner);
                // Dashed edge like real casino chips
                ctx.beginPath();
                ctx.setLineDash([3, 3]);
                ctx.arc(x, y, 10, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = 'bold 9px Arial';
                ctx.fillStyle = textColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, x, y);
                ctx.restore();
            };

            if (s === this.dealerSeat) {
                drawChip(mx + xOff, my, '#e8e8e8', '#ffffff', 'D', '#222');
                xOff += 28;
            }
            if (s === this.sbSeat) {
                drawChip(mx + xOff, my, '#2a5caa', '#4488dd', 'SB', '#fff');
                xOff += 28;
            }
            if (s === this.bbSeat) {
                drawChip(mx + xOff, my, '#cc9500', '#ffcc33', 'BB', '#222');
            }
        }
        ctx.restore();
    }

    _drawPlayerSeat(ctx, seat) {
        const { x, y } = seat;
        const theme = this.theme;
        ctx.save();

        const outfit = (typeof WardrobeSystem !== 'undefined')
            ? WardrobeSystem.getEquippedOutfit()
            : { shirtColor: 'hsl(220,45%,38%)', hairColor: 'hsl(28,48%,18%)', skinColor: '#f5d0ba' };
        Utils.drawSeatedCharacter(ctx, x, y - 102, 27, outfit, this.playerFolded);

        const active = this.state === 'player_action' && !this.playerFolded && this.turnSeat === 0;
        const folded = this.playerFolded;
        if (active) { ctx.shadowColor = theme.trim; ctx.shadowBlur = 22; }

        const callNeed = Math.max(0, this.currentBet - this.playerBet);
        let pillOff = 0;
        if (!folded && this.playerBet > 0) pillOff += 26;
        if (!folded && callNeed > 0 && this.playerChips > 0) pillOff += 26;
        const panelH = 148 + pillOff;

        Utils.roundRect(ctx, x - 105, y - 38, 210, panelH, 9);
        if (folded) {
            ctx.fillStyle   = 'rgba(22,20,28,0.9)';
            ctx.strokeStyle = 'rgba(140,70,70,0.45)';
            ctx.lineWidth   = 1.5;
        } else {
            ctx.fillStyle   = active ? 'rgba(22,48,18,0.92)' : 'rgba(8,8,12,0.82)';
            ctx.strokeStyle = active ? theme.trim : 'rgba(255,255,255,0.12)';
            ctx.lineWidth   = active ? 2 : 1;
        }
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur  = 0;

        ctx.font = 'bold 14px Georgia'; ctx.fillStyle = '#f5d76e';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('You', x, y - 30);

        ctx.font = '12px Georgia'; ctx.fillStyle = '#bbb';
        ctx.fillText(Utils.formatChips(this.playerChips), x, y - 14);

        let drawPillOff = 0;
        let cardY = y + 22;
        if (this.playerBet > 0) {
            this._drawBetPill(ctx, x, y + 4 + drawPillOff, `Bet ${Utils.formatChips(this.playerBet)}`, '#ffe9b0');
            drawPillOff += 26;
        }
        if (!this.playerFolded && callNeed > 0 && this.playerChips > 0) {
            this._drawBetPill(ctx, x, y + 4 + drawPillOff, `To call ${Utils.formatChips(callNeed)}`, '#ffcc80');
            drawPillOff += 26;
        }
        cardY += drawPillOff;

        if (!this.playerFolded) {
            const numCards = this.playerCards.length;
            const cw = 50, ch = 72, gap = 8;
            const tw = numCards * cw + (numCards - 1) * gap;
            const sx = x - tw / 2;
            for (let i = 0; i < numCards; i++) {
                this._drawCard(ctx, sx + i * (cw + gap), cardY, cw, ch, this.playerCards[i], true);
            }
        } else {
            ctx.font = 'bold 15px Georgia'; ctx.fillStyle = 'rgba(255,80,80,0.75)';
            ctx.textBaseline = 'middle';
            ctx.fillText('FOLDED', x, y + 58);
        }
        ctx.restore();
    }

    _drawAISeat(ctx, seat, ai, idx) {
        const { x, y } = seat;
        const theme = this.theme;
        ctx.save();

        const cols = ai.seatColors || this._aiColors(ai.name);
        Utils.drawSeatedCharacter(ctx, x, y - 92, 22, cols, ai.folded);

        const thinking = this.state === 'ai_turn' && this.turnSeat === idx + 1;
        if (thinking) { ctx.shadowColor = theme.trim; ctx.shadowBlur = 18; }

        const aiCallPre = Math.max(0, this.currentBet - ai.currentBet);
        let pillH = 0;
        if (!ai.folded && ai.currentBet > 0) pillH += 24;
        if (!ai.folded && aiCallPre > 0 && ai.chips > 0) pillH += 24;
        const h = ai.folded ? 68 : (118 + pillH);
        Utils.roundRect(ctx, x - 82, y - 32, 164, h, 9);
        ctx.fillStyle   = ai.folded ? 'rgba(20,18,26,0.78)' : 'rgba(8,8,12,0.82)';
        ctx.fill();
        ctx.strokeStyle = thinking ? theme.trim : (ai.folded ? 'rgba(130,70,70,0.4)' : 'rgba(255,255,255,0.12)');
        ctx.lineWidth   = thinking ? 2 : (ai.folded ? 1.5 : 1);
        ctx.stroke();
        ctx.shadowBlur  = 0;

        ctx.font = 'bold 13px Georgia';
        ctx.fillStyle = ai.folded ? '#444' : '#ddd';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(ai.name, x, y - 25);

        ctx.font = '11px Georgia'; ctx.fillStyle = ai.folded ? '#333' : '#aaa';
        ctx.fillText(Utils.formatChips(ai.chips), x, y - 11);

        let aiPillOff = 0;
        const aiCardYBase = y + 21;
        const aiCall = Math.max(0, this.currentBet - ai.currentBet);
        if (ai.currentBet > 0) {
            this._drawBetPill(ctx, x, y + 4 + aiPillOff, `Bet ${Utils.formatChips(ai.currentBet)}`, '#ffe9b0');
            aiPillOff += 24;
        }
        if (!ai.folded && aiCall > 0 && ai.chips > 0) {
            this._drawBetPill(ctx, x, y + 4 + aiPillOff, `To call ${Utils.formatChips(aiCall)}`, '#ffcc80');
            aiPillOff += 24;
        }
        const aiCardY = aiCardYBase + aiPillOff;

        if (ai.folded) {
            ctx.font = 'bold 11px Georgia'; ctx.fillStyle = 'rgba(255,60,60,0.45)';
            ctx.fillText('FOLDED', x, y + 20);
        } else {
            const numCards = ai.holeCards.length;
            const cw = 36, ch = 50, gap = 4;
            const tw = numCards * cw + (numCards - 1) * gap;
            const sx = x - tw / 2;
            for (let i = 0; i < numCards; i++) {
                this._drawCard(ctx, sx + i * (cw + gap), aiCardY, cw, ch, null, false);
            }
        }

        if (thinking) {
            const pulsing = 0.5 + Math.sin(this.aiTimer * 3.5) * 0.5;
            ctx.save();
            ctx.shadowColor = theme.glow || theme.label;
            ctx.shadowBlur = 8 + pulsing * 8;
            ctx.globalAlpha = 0.6 + pulsing * 0.4;
            ctx.font = 'bold 10px Arial'; ctx.fillStyle = theme.label;
            ctx.fillText('thinking...', x, y - 108);
            ctx.restore();
        }
        ctx.restore();
    }

    _drawChipAnimations(ctx) {
        for (const anim of this.chipAnimations) {
            ctx.save();
            const prog = Math.min(1, anim.progress);
            const easeOut = 1 - Math.pow(1 - prog, 3);
            const x = anim.fromX + (anim.toX - anim.fromX) * easeOut;
            const y = anim.fromY + (anim.toY - anim.fromY) * easeOut;
            ctx.globalAlpha = 1 - prog;
            Utils.fillEllipse(ctx, x, y, 10, 7, prog % 2 === 0 ? '#c62828' : '#1b5e20');
            ctx.restore();
        }
    }

    _drawParticleEffects(ctx) {
        for (const p of this.particleEffects) {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = p.size;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    _drawBadges(ctx) {
        for (const b of this.badges) {
            if (!b.displayAlpha || b.displayAlpha <= 0) continue;
            ctx.save();
            ctx.globalAlpha = Math.min(1, b.displayAlpha);

            ctx.font = 'bold 12px Georgia';
            const tw = ctx.measureText(b.text).width;
            const bw = tw + 18, bh = 24;

            Utils.roundRect(ctx, b.x - bw/2, b.y - bh/2, bw, bh, 5);
            ctx.fillStyle   = 'rgba(0,0,0,0.82)';
            ctx.fill();
            ctx.strokeStyle = b.color;
            ctx.lineWidth   = 1.5;
            ctx.stroke();

            ctx.fillStyle    = b.color;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.text, b.x, b.y);
            ctx.restore();
        }
    }

    _drawStreetLabel(ctx) {
        if (!this.streetLabel || this.labelAlpha <= 0) return;
        ctx.save();
        ctx.globalAlpha  = Math.min(1, this.labelAlpha);
        ctx.font         = 'bold 58px Georgia';
        ctx.fillStyle    = this.theme.label;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor  = this.theme.glow;
        ctx.shadowBlur   = 28;
        ctx.fillText(this.streetLabel, C.WIDTH/2, C.HEIGHT/2 - 145);
        ctx.restore();
    }

    _drawActionLog(ctx) {
        if (!this.actionLog.length) return;
        ctx.save();
        ctx.font      = '12px Georgia';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const x = 18, y = C.HEIGHT - 168;
        for (let i = 0; i < this.actionLog.length; i++) {
            ctx.fillStyle = `rgba(190,190,190,${1 - i * 0.17})`;
            ctx.fillText(this.actionLog[i], x, y + i * 19);
        }
        ctx.restore();
    }

    _drawRoundIndicator(ctx) {
        if (this.state !== 'player_action' || this.playerFolded) return;
        const roundNames = { preflop:'PRE-FLOP', flop:'FLOP', turn:'TURN', river:'RIVER' };
        const label = roundNames[this.round];
        if (!label) return;
        ctx.save();
        ctx.font         = 'bold 13px Georgia';
        ctx.fillStyle    = 'rgba(200,168,75,0.65)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`— ${label} —  Your turn`, C.WIDTH/2, C.HEIGHT - 58);
        ctx.restore();
    }

    // ── Showdown display ──────────────────────────────────────────────────────

    _drawShowdownCards(ctx) {
        if (!this.showdownResults.length) return;
        const winner = this.showdownResults[0];

        const pr = this.showdownResults.find(r => r.type === 'player');
        if (pr && !this.playerFolded) {
            const seat = this.seats[0];
            const isWinner = pr === winner;
            const numCards = this.playerCards.length;
            const cw = 50, ch = 72, gap = 8;
            const tw = numCards * cw + (numCards - 1) * gap;
            const sx = seat.x - tw / 2;
            const y0 = seat.y + 22;
            ctx.save();
            if (isWinner) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 16; }
            else ctx.globalAlpha = 0.75;
            const faceUp = !this.playerMuckedShowdown &&
                (this.state !== 'showdown_choice' || this.showdownRevealPlayer);
            for (let j = 0; j < numCards; j++) {
                this._drawCard(ctx, sx + j * (cw + gap), y0, cw, ch, faceUp ? this.playerCards[j] : null, faceUp);
            }
            ctx.restore();
            ctx.save();
            ctx.font = `bold ${isWinner ? 14 : 12}px Georgia`;
            ctx.fillStyle = isWinner ? '#ffd700' : '#888';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            if (!faceUp && this.state === 'showdown_choice') ctx.fillText('Show or muck?', seat.x, y0 + ch + 4);
            else if (this.playerMuckedShowdown) ctx.fillText('Mucked', seat.x, y0 + ch + 4);
            else ctx.fillText(pr.hand?.name || '', seat.x, y0 + ch + 4);
            ctx.restore();
        }

        for (let i = 0; i < this.aiPlayers.length; i++) {
            const ai   = this.aiPlayers[i];
            if (ai.folded) continue;
            const seat = this.seats[i + 1];
            const result = this.showdownResults.find(r => r.ref === ai);
            const isWinner = result === winner;

            const numCards = ai.holeCards.length;
            const cw = 36, ch = 50, gap = 4;
            const tw = numCards*cw + (numCards-1)*gap;
            const sx = seat.x - tw/2;

            ctx.save();
            if (isWinner) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 16; }
            else           { ctx.globalAlpha = 0.6; }

            for (let j = 0; j < numCards; j++) {
                this._drawCard(ctx, sx + j*(cw+gap), seat.y+17, cw, ch, ai.holeCards[j], true);
            }
            ctx.restore();

            // Hand name label
            ctx.save();
            ctx.font         = `bold ${isWinner ? 13 : 11}px Georgia`;
            ctx.fillStyle    = isWinner ? '#ffd700' : '#777';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'top';
            if (isWinner) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 8; }
            ctx.fillText(result?.hand?.name || '', seat.x, seat.y + 70);
            ctx.restore();
        }
    }

    _drawResultBanner(ctx) {
        if (!this.lastResult) return;
        const { winner, pot, reason } = this.lastResult;
        const cx = C.WIDTH / 2;
        const cy = C.HEIGHT / 2 - 148;

        const isPlayerWin = winner.type === 'player';
        const color = isPlayerWin ? '#4cff7a' : (winner.type === 'ai' && this.playerFolded) ? '#aaaaaa' : '#ff6666';

        ctx.save();
        ctx.shadowColor  = color;
        ctx.shadowBlur   = 22;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        // Main result line
        ctx.font      = 'bold 30px Georgia';
        ctx.fillStyle = color;
        const mainText = isPlayerWin
            ? `You win $${pot}!`
            : reason === 'fold' ? `${winner.name} wins $${pot}` : `${winner.name} wins`;
        ctx.fillText(mainText, cx, cy);

        // Sub-line: hand name
        const sub = isPlayerWin
            ? (this.showdownResults[0]?.hand?.name || '')
            : reason === 'fold' ? 'everyone folded'
            : (this.showdownResults.find(r => r.type === 'player')?.hand
                ? `Your hand: ${this.showdownResults.find(r=>r.type==='player').hand.name}`
                : '');
        if (sub) {
            ctx.shadowBlur   = 8;
            ctx.font         = '16px Georgia';
            ctx.fillStyle    = 'rgba(255,255,255,0.75)';
            ctx.fillText(sub, cx, cy + 34);
        }

        // Countdown
        if (this.state === 'hand_over' && this.pauseTimer > 0) {
            ctx.shadowBlur   = 0;
            ctx.font         = '12px Georgia';
            ctx.fillStyle    = 'rgba(180,180,180,0.4)';
            ctx.fillText(`Next hand in ${Math.ceil(this.pauseTimer)}…`, cx, cy + 62);
        }

        ctx.restore();
    }

    // ── Emoji reactions ──────────────────────────────────────────────────────

    spawnEmoji(emoji, seatIdx) {
        const seat = this.seats[seatIdx] || this.seats[0];
        this.floatingEmojis.push({
            emoji,
            x: seat.x + (Math.random() - 0.5) * 20,
            y: seat.y - 90,
            age: 0,
            lifetime: 2.0 + Math.random() * 0.5,
            vx: (Math.random() - 0.5) * 20,
            vy: 50 + Math.random() * 30,
            size: 28 + Math.random() * 10
        });
    }

    triggerAiEmojiReaction() {
        // Some AI players randomly react with an emoji
        for (let i = 0; i < this.aiPlayers.length; i++) {
            if (this.aiPlayers[i].folded) continue;
            if (Math.random() < 0.45) {
                const delay = 300 + Math.random() * 800;
                const idx = i + 1;
                const pick = this.emojiOptions[Math.floor(Math.random() * this.emojiOptions.length)];
                setTimeout(() => this.spawnEmoji(pick, idx), delay);
            }
        }
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

    // Emoji bar is now HTML-based; these methods support it from main.js
    onPlayerEmoji(emoji) {
        this.spawnEmoji(emoji, 0);
        this.triggerAiEmojiReaction();
        if (typeof Sounds !== 'undefined') Sounds.play('chip');
    }

    // ── Coach state ───────────────────────────────────────────────────────────

    getCoachState() {
        const n = this._numSeats();
        const isButton = this.dealerSeat === 0;
        const isBigBlind = this.bbSeat === 0;
        const isSmallBlind = this.sbSeat === 0;
        const actsAfter = this.turnSeat === 0 &&
            this._nextSeatClockwise(this.dealerSeat) !== 0;
        return {
            gameType:    this.gameType,
            round:       this.round,
            holeCards:   this.playerCards,
            community:   this.community,
            pot:         this.pot,
            callAmount:  Math.max(0, this.currentBet - this.playerBet),
            playerChips: this.playerChips,
            bigBlind:    this.bigBlind,
            difficulty:  this.difficulty,
            dealerSeat:  this.dealerSeat,
            turnSeat:    this.turnSeat,
            numSeats:    n,
            isButton,
            isBigBlind,
            isSmallBlind,
            actsInLatePosition: isButton || (n > 2 && this.dealerSeat === 0)
        };
    }
}
