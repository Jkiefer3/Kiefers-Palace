'use strict';

const Game = {
    canvas: null,
    ctx: null,
    state: C.STATE.CASINO,
    playerChips: C.STARTING_CHIPS,
    lastTime: 0,
    mouse: { x: 0, y: 0 },

    casino: null,
    pokerGame: null,
    pendingTable: null,

    init() {
        this.playerChips = typeof KieferSave !== 'undefined' ? KieferSave.getChips() : C.STARTING_CHIPS;

        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = C.WIDTH;
        this.canvas.height = C.HEIGHT;

        this.casino = new CasinoFloor();

        this._setupInputs();
        this._setupUI();
        this._setupAuxUI();
        this._resizeCanvas();
        this._updateChipsDisplay();
        this._refreshAchievementHud();

        requestAnimationFrame(t => this._loop(t));
        window.addEventListener('resize', () => this._resizeCanvas());
    },

    _resizeCanvas() {
        const wrap = document.getElementById('game-wrapper');
        if (!wrap) return;
        const maxW = Math.min(1200, window.innerWidth - 24);
        const scale = maxW / C.WIDTH;
        wrap.style.width = `${C.WIDTH * scale}px`;
        wrap.style.height = `${C.HEIGHT * scale}px`;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
    },

    _loop(timestamp) {
        const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
        this.lastTime = timestamp;
        this._update(dt);
        this._render();
        this._syncOverlays();
        requestAnimationFrame(t => this._loop(t));
    },

    _syncOverlays() {
        const sb = document.getElementById('showdown-bar');
        if (sb) {
            const showSD = this.pokerGame && this.pokerGame instanceof PokerGame
                && this.pokerGame.state === 'showdown_choice';
            sb.classList.toggle('hidden', !showSD);
        }
        // Emoji bar visible during showdown / hand_over / showdown_choice (all game types)
        const eb = document.getElementById('emoji-bar');
        if (eb) {
            const showEmoji = this.pokerGame && this.pokerGame.emojiBarVisible;
            eb.classList.toggle('hidden', !showEmoji);
        }
        // Blackjack action bar
        const bjBar = document.getElementById('bj-action-btns');
        if (bjBar) {
            const showBJ = this.pokerGame && this.pokerGame instanceof BlackjackGame
                && this.pokerGame.state === 'playing';
            bjBar.style.display = showBJ ? 'flex' : 'none';
        }
        const bjDealBar = document.getElementById('bj-deal-bar');
        if (bjDealBar) {
            const showDeal = this.pokerGame && this.pokerGame instanceof BlackjackGame
                && (this.pokerGame.state === 'betting' || this.pokerGame.state === 'hand_over');
            bjDealBar.style.display = showDeal ? 'flex' : 'none';
        }
        // Solitaire action bar
        const solBar = document.getElementById('sol-action-btns');
        if (solBar) {
            const showSol = this.pokerGame && this.pokerGame instanceof SolitaireGame
                && this.pokerGame.state === 'playing';
            solBar.style.display = showSol ? 'flex' : 'none';
        }
    },

    _update(dt) {
        if (this.state === C.STATE.CASINO) {
            this.casino.update(dt, this.mouse.x, this.mouse.y);

            const pointer = this.casino.hoveredTable || this.casino.tabHover ||
                (this.casino.activeTab === 'wardrobe' && this.casino.wardrobeHoverId !== null) ||
                (this.casino.activeTab === 'cashier' && this.casino.cashierHover !== null);
            this.canvas.style.cursor = pointer ? 'pointer' : 'default';

            // Sync chips after wheel spin or daily bonus
            if (this.casino._wheelChipsNeedSync) {
                this.playerChips = KieferSave.getChips();
                this._updateChipsDisplay();
                this.casino._wheelChipsNeedSync = false;
            }

        } else if (this.state === C.STATE.PLAYING && this.pokerGame) {
            this.pokerGame.update(dt);
            this._updateChipsDisplay();

            if (this.pokerGame instanceof PokerGame) {
                this._updateActionButtons();
                const coachPanel = document.getElementById('coach-panel');
                const coachOpen  = coachPanel && !coachPanel.classList.contains('hidden');
                if (coachOpen && this.pokerGame &&
                    (this.pokerGame.streetJustChanged || this.pokerGame.playerTurnStarted)) {
                    this._refreshCoach();
                    this.pokerGame.streetJustChanged   = false;
                    this.pokerGame.playerTurnStarted = false;
                }

                if (this.pokerGame.state === 'hand_over'
                    && this.pokerGame.pauseTimer <= 0
                    && this.pokerGame.playerChips <= 0) {
                    this._handleBust();
                }
            } else if (this.pokerGame instanceof BlackjackGame) {
                // Auto-refresh coach when BJ state changes
                const coachPanel = document.getElementById('coach-panel');
                const coachOpen  = coachPanel && !coachPanel.classList.contains('hidden');
                if (coachOpen) {
                    const bjState = this.pokerGame.state;
                    if (this._lastBJState !== bjState || this._lastBJCards !== (this.pokerGame.playerHand || []).length) {
                        this._refreshCoach();
                        this._lastBJState = bjState;
                        this._lastBJCards = (this.pokerGame.playerHand || []).length;
                    }
                }
                if (this.pokerGame.playerChips <= 0
                    && this.pokerGame.state === 'hand_over') {
                    this._handleBust();
                }
            } else if (this.pokerGame instanceof SolitaireGame) {
                // Auto-refresh coach when solitaire state changes
                const coachPanel2 = document.getElementById('coach-panel');
                const coachOpen2  = coachPanel2 && !coachPanel2.classList.contains('hidden');
                if (coachOpen2) {
                    const solMoveCount = (this.pokerGame.moveCount || 0);
                    if (this._lastSolMoves !== solMoveCount) {
                        this._refreshCoach();
                        this._lastSolMoves = solMoveCount;
                    }
                }
            }
        }
    },

    _render() {
        this.ctx.clearRect(0, 0, C.WIDTH, C.HEIGHT);
        if (this.state === C.STATE.CASINO || this.state === C.STATE.BUYIN) {
            this.casino.render(this.ctx);
        } else if (this.state === C.STATE.PLAYING && this.pokerGame) {
            this.pokerGame.render(this.ctx);
        }
        // Chips display always updated
        if (this.pokerGame) {
            const cd = document.getElementById('chips-amount');
            if (cd) cd.textContent = '$' + this.pokerGame.playerChips.toLocaleString();
        }
    },

    _setupInputs() {
        this.canvas.addEventListener('mousemove', e => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = C.WIDTH / rect.width;
            const scaleY = C.HEIGHT / rect.height;
            this.mouse.x = (e.clientX - rect.left) * scaleX;
            this.mouse.y = (e.clientY - rect.top) * scaleY;
            // Forward hover to blackjack chip selector
            if (this.state === C.STATE.PLAYING && this.pokerGame instanceof BlackjackGame) {
                this.pokerGame.handleMouseMove(this.mouse.x, this.mouse.y);
            }
        });

        this.canvas.addEventListener('click', e => {
            if (this.state === C.STATE.CASINO) {
                const table = this.casino.handleClick(this.mouse.x, this.mouse.y, this);
                if (table) this._showBuyInModal(table);
            } else if (this.state === C.STATE.PLAYING && this.pokerGame) {
                if (this.pokerGame instanceof BlackjackGame) {
                    this.pokerGame.handleBetClick(this.mouse.x, this.mouse.y);
                } else if (this.pokerGame instanceof SolitaireGame) {
                    this.pokerGame.handleClick(this.mouse.x, this.mouse.y);
                }
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') this._handleEscape();
        });
    },

    _handleEscape() {
        if (this.state === C.STATE.PLAYING) this._leaveTable();
    },

    _setupUI() {
        document.getElementById('buyin-confirm').addEventListener('click', () => this._confirmBuyIn());
        document.getElementById('buyin-cancel').addEventListener('click', () => {
            document.getElementById('buyin-modal').classList.add('hidden');
            this.state = C.STATE.CASINO;
        });
        document.getElementById('bust-ok').addEventListener('click', () => {
            document.getElementById('bust-modal').classList.add('hidden');
            this.playerChips = 500;
            KieferSave.setChips(this.playerChips);
            this._updateChipsDisplay();
        });
        document.getElementById('leave-btn').addEventListener('click', () => this._leaveTable());
        document.getElementById('coach-btn').addEventListener('click', () => this._openCoach());
        document.getElementById('coach-close').addEventListener('click', () => {
            document.getElementById('coach-panel').classList.add('hidden');
        });

        this._createActionButtons();
        this._createBlackjackButtons();
        this._createSolitaireButtons();
    },

    _setupAuxUI() {
        const sb = document.getElementById('btn-show-cards');
        const mb = document.getElementById('btn-muck-cards');
        if (sb) sb.addEventListener('click', () => {
            if (this.pokerGame) this.pokerGame.playerShowdownChoice(true);
        });
        if (mb) mb.addEventListener('click', () => {
            if (this.pokerGame) this.pokerGame.playerShowdownChoice(false);
        });
        // Emoji bar buttons
        const emojiBar = document.getElementById('emoji-bar');
        if (emojiBar) {
            emojiBar.querySelectorAll('.emoji-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (this.pokerGame) {
                        this.pokerGame.onPlayerEmoji(btn.dataset.emoji);
                    }
                });
            });
        }

        const mute = document.getElementById('btn-mute');
        if (mute) {
            mute.addEventListener('click', () => {
                KieferSave.setMute(!KieferSave.isMuted());
                mute.textContent = KieferSave.isMuted() ? '🔇' : '🔊';
            });
            mute.textContent = KieferSave.isMuted() ? '🔇' : '🔊';
        }
    },

    _createActionButtons() {
        const wrapper = document.getElementById('game-wrapper');

        const bar = document.createElement('div');
        bar.id = 'action-btns';
        bar.style.cssText = `
            position:absolute; bottom:16px; left:50%; transform:translateX(-50%);
            display:none; gap:10px; align-items:center; z-index:20;
        `;
        wrapper.appendChild(bar);

        const rp = document.createElement('div');
        rp.id = 'raise-panel';
        rp.style.cssText = `
            position:absolute; bottom:64px; left:50%; transform:translateX(-50%);
            background:rgba(0,0,0,0.92); border:1px solid #c8a84b; border-radius:10px;
            padding:12px 20px; display:none; gap:10px; align-items:center; z-index:25;
        `;
        rp.innerHTML = `
            <span style="color:#c8a84b;font-family:Georgia;font-size:13px;">Raise:</span>
            <input type="range" id="raise-slider" min="2" max="1000" value="4"
                style="width:160px;accent-color:#c8a84b;">
            <span id="raise-val" style="color:#f5d76e;font-family:Georgia;font-size:15px;min-width:55px;">$4</span>
            <button id="btn-raise-confirm" style="
                background:rgba(100,70,0,0.9);border:2px solid #c8a84b;color:#fff;
                padding:8px 16px;border-radius:6px;cursor:pointer;font-family:Georgia;font-size:14px;">
                Confirm
            </button>
        `;
        wrapper.appendChild(rp);

        const mkBtn = (id, label, bg, border) => {
            const b = document.createElement('button');
            b.id = id; b.textContent = label;
            b.style.cssText = `background:${bg};border:2px solid ${border};color:#fff;
                padding:10px 22px;border-radius:8px;font-size:15px;font-family:Georgia,serif;
                cursor:pointer;min-width:88px;transition:filter 0.15s;`;
            b.onmouseenter = () => b.style.filter = 'brightness(1.25)';
            b.onmouseleave = () => b.style.filter = 'brightness(1)';
            return b;
        };

        this.btnFold  = mkBtn('btn-fold',  'Fold',  'rgba(110,0,0,0.85)',  '#cc3333');
        this.btnCheck = mkBtn('btn-check', 'Check', 'rgba(15,55,15,0.85)', '#4caf50');
        this.btnCall  = mkBtn('btn-call',  'Call',  'rgba(10,45,10,0.85)', '#66bb6a');
        this.btnRaise = mkBtn('btn-raise', 'Raise ▲', 'rgba(90,60,0,0.85)', '#c8a84b');

        bar.append(this.btnFold, this.btnCheck, this.btnCall, this.btnRaise);

        this.btnFold.addEventListener('click',  () => { if (this.pokerGame) this.pokerGame.playerFold(); });
        this.btnCheck.addEventListener('click', () => { if (this.pokerGame) this.pokerGame.playerCheck(); });
        this.btnCall.addEventListener('click',  () => { if (this.pokerGame) this.pokerGame.playerCall(); });

        this.btnRaise.addEventListener('click', () => {
            const panel = document.getElementById('raise-panel');
            const opening = panel.style.display !== 'flex';
            panel.style.display = opening ? 'flex' : 'none';
            if (opening && this.pokerGame) {
                const slider = document.getElementById('raise-slider');
                const callAmount = Math.max(0, this.pokerGame.currentBet - this.pokerGame.playerBet);
                const raiseCapacity = this.pokerGame.playerChips - callAmount;
                slider.min = this.pokerGame.minRaise;
                slider.max = Math.max(this.pokerGame.minRaise, raiseCapacity);
                slider.value = Math.min(this.pokerGame.minRaise, raiseCapacity);
                document.getElementById('raise-val').textContent = '$' + slider.value;
            }
        });

        document.getElementById('raise-slider').addEventListener('input', e => {
            document.getElementById('raise-val').textContent = '$' + e.target.value;
        });

        document.getElementById('btn-raise-confirm').addEventListener('click', () => {
            const amount = parseInt(document.getElementById('raise-slider').value);
            if (this.pokerGame && amount > 0) {
                this.pokerGame.playerRaise(amount);
                document.getElementById('raise-panel').style.display = 'none';
            }
        });
    },

    _createBlackjackButtons() {
        const wrapper = document.getElementById('game-wrapper');

        // BJ playing actions (Hit / Stand / Double)
        const bjBar = document.createElement('div');
        bjBar.id = 'bj-action-btns';
        bjBar.style.cssText = `
            position:absolute; bottom:16px; left:50%; transform:translateX(-50%);
            display:none; gap:10px; align-items:center; z-index:20;
        `;
        wrapper.appendChild(bjBar);

        const mkBtn = (id, label, bg, border) => {
            const b = document.createElement('button');
            b.id = id; b.textContent = label;
            b.style.cssText = `background:${bg};border:2px solid ${border};color:#fff;
                padding:10px 22px;border-radius:8px;font-size:15px;font-family:Georgia,serif;
                cursor:pointer;min-width:88px;transition:filter 0.15s;`;
            b.onmouseenter = () => b.style.filter = 'brightness(1.25)';
            b.onmouseleave = () => b.style.filter = 'brightness(1)';
            return b;
        };

        const btnHit = mkBtn('btn-bj-hit', 'Hit', 'rgba(15,55,15,0.85)', '#4caf50');
        const btnStand = mkBtn('btn-bj-stand', 'Stand', 'rgba(110,0,0,0.85)', '#cc3333');
        const btnDouble = mkBtn('btn-bj-double', 'Double', 'rgba(90,60,0,0.85)', '#c8a84b');
        bjBar.append(btnHit, btnStand, btnDouble);

        btnHit.addEventListener('click', () => {
            if (this.pokerGame instanceof BlackjackGame) this.pokerGame.hit();
        });
        btnStand.addEventListener('click', () => {
            if (this.pokerGame instanceof BlackjackGame) this.pokerGame.stand();
        });
        btnDouble.addEventListener('click', () => {
            if (this.pokerGame instanceof BlackjackGame) this.pokerGame.doubleDown();
        });

        // BJ deal bar (betting / hand_over states)
        const dealBar = document.createElement('div');
        dealBar.id = 'bj-deal-bar';
        dealBar.style.cssText = `
            position:absolute; bottom:16px; left:50%; transform:translateX(-50%);
            display:none; gap:10px; align-items:center; z-index:20;
        `;
        wrapper.appendChild(dealBar);

        const btnDeal = mkBtn('btn-bj-deal', 'DEAL', 'rgba(15,55,15,0.85)', '#4caf50');
        btnDeal.style.minWidth = '120px';
        btnDeal.style.fontSize = '18px';
        dealBar.appendChild(btnDeal);

        btnDeal.addEventListener('click', () => {
            if (!(this.pokerGame instanceof BlackjackGame)) return;
            if (this.pokerGame.state === 'betting') {
                this.pokerGame.placeBet(this.pokerGame.currentBet);
            } else if (this.pokerGame.state === 'hand_over') {
                this.pokerGame.newHand();
            }
        });
    },

    _createSolitaireButtons() {
        const wrapper = document.getElementById('game-wrapper');

        const solBar = document.createElement('div');
        solBar.id = 'sol-action-btns';
        solBar.style.cssText = `
            position:absolute; bottom:16px; left:50%; transform:translateX(-50%);
            display:none; gap:10px; align-items:center; z-index:20;
        `;
        wrapper.appendChild(solBar);

        const mkBtn = (id, label, bg, border) => {
            const b = document.createElement('button');
            b.id = id; b.textContent = label;
            b.style.cssText = `background:${bg};border:2px solid ${border};color:#fff;
                padding:10px 22px;border-radius:8px;font-size:15px;font-family:Georgia,serif;
                cursor:pointer;min-width:88px;transition:filter 0.15s;`;
            b.onmouseenter = () => b.style.filter = 'brightness(1.25)';
            b.onmouseleave = () => b.style.filter = 'brightness(1)';
            return b;
        };

        const btnHint = mkBtn('btn-sol-hint', '💡 Hint', 'rgba(20,60,100,0.85)', '#4a9eff');
        const btnGiveUp = mkBtn('btn-sol-giveup', '🏳️ Give Up', 'rgba(110,0,0,0.85)', '#cc3333');
        solBar.append(btnHint, btnGiveUp);

        btnHint.addEventListener('click', () => {
            if (!(this.pokerGame instanceof SolitaireGame)) return;
            if (this.pokerGame.state !== 'playing') return;
            const hint = this.pokerGame.getHint();
            this._showSolitaireHint(hint);
        });

        btnGiveUp.addEventListener('click', () => {
            if (!(this.pokerGame instanceof SolitaireGame)) return;
            this.pokerGame.giveUp();
        });
    },

    _showSolitaireHint(hint) {
        // Flash the coach panel open with the hint
        const panel = document.getElementById('coach-panel');
        panel.classList.remove('hidden');
        this._refreshCoach();
    },

    _updateActionButtons() {
        const bar = document.getElementById('action-btns');
        const rp  = document.getElementById('raise-panel');
        if (!this.pokerGame || !(this.pokerGame instanceof PokerGame)) {
            bar.style.display = 'none'; return;
        }

        const show = this.pokerGame.state === 'player_action'
            && !this.pokerGame.playerFolded;

        bar.style.display = show ? 'flex' : 'none';
        if (!show) { rp.style.display = 'none'; return; }

        const callAmt = Math.max(0, this.pokerGame.currentBet - this.pokerGame.playerBet);
        const canCheck = callAmt === 0;

        this.btnCheck.style.display = canCheck ? '' : 'none';
        this.btnCall.style.display  = canCheck ? 'none' : '';
        this.btnCall.textContent    = canCheck ? 'Call' : `Call $${callAmt}`;
    },

    _showBuyInModal(tableCfg) {
        this.pendingTable = tableCfg;
        this.state = C.STATE.BUYIN;

        const theme = C.THEMES[tableCfg.theme];
        const canAfford = this.playerChips >= tableCfg.buyIn;

        const typeLabels = {
            holdem: "Texas Hold'em",
            blackjack: 'Blackjack',
            solitaire: 'Solitaire'
        };
        const type = typeLabels[tableCfg.type] || tableCfg.type;

        document.getElementById('buyin-title').textContent = theme.name;

        let descHTML = `<strong>${type}</strong><br>`;
        if (tableCfg.type === 'holdem') {
            const diff = tableCfg.difficulty.charAt(0).toUpperCase() + tableCfg.difficulty.slice(1);
            descHTML += `${diff}<br>`;
            descHTML += `Buy-in: <strong>$${tableCfg.buyIn}</strong> &nbsp;&middot;&nbsp; Blinds: $${tableCfg.smallBlind}/$${tableCfg.bigBlind}<br>`;
        } else if (tableCfg.type === 'blackjack') {
            descHTML += `Buy-in: <strong>$${tableCfg.buyIn}</strong><br>`;
            descHTML += `Bet range: $${tableCfg.minBet}&ndash;$${tableCfg.maxBet} &nbsp;&middot;&nbsp; Blackjack pays 3:2<br>`;
        } else if (tableCfg.type === 'solitaire') {
            descHTML += `Cost: <strong>$${tableCfg.buyIn}</strong> per game<br>`;
            descHTML += `Earn $5 for each card placed on foundations<br>`;
        }
        descHTML += `<br>Your chips: <strong>$${this.playerChips}</strong>`;
        if (!canAfford) descHTML += '<br><span style="color:#f66">\u26A0 Not enough chips!</span>';

        document.getElementById('buyin-desc').innerHTML = descHTML;

        const btn = document.getElementById('buyin-confirm');
        btn.disabled = !canAfford;
        btn.style.opacity = canAfford ? '1' : '0.4';

        document.getElementById('buyin-modal').classList.remove('hidden');
    },

    _confirmBuyIn() {
        document.getElementById('buyin-modal').classList.add('hidden');
        if (!this.pendingTable) return;

        const buyIn = this.pendingTable.buyIn;
        this.playerChips -= buyIn;

        try {
            if (this.pendingTable.type === 'blackjack') {
                this.pokerGame = new BlackjackGame(this.pendingTable, buyIn);
            } else if (this.pendingTable.type === 'solitaire') {
                this.pokerGame = new SolitaireGame(this.pendingTable, buyIn);
            } else {
                this.pokerGame = new PokerGame(this.pendingTable, buyIn);
            }
        } catch(e) {
            console.error('Game init error:', e);
            this.playerChips += buyIn;
            this.state = C.STATE.CASINO;
            return;
        }

        this.state = C.STATE.PLAYING;
        document.getElementById('leave-btn').classList.remove('hidden');
        // Show coach for all game types
        document.getElementById('coach-btn').classList.remove('hidden');
        this._pushHandHistory(`— Sat down ${this.pendingTable.label} —`);
        this._updateChipsDisplay();
        this._syncBankroll();
    },

    _leaveTable() {
        if (this.pokerGame) {
            // Record session stats before leaving
            const chipsOut = this.pokerGame.playerChips;
            const buyIn = this.pendingTable ? this.pendingTable.buyIn : 0;
            const net = chipsOut - buyIn;
            const gameType = this.pendingTable ? this.pendingTable.type : 'holdem';
            KieferSave.recordSession(gameType, net);

            this.playerChips += chipsOut;
        }
        this.pokerGame = null;
        this.state = C.STATE.CASINO;

        document.getElementById('leave-btn').classList.add('hidden');
        document.getElementById('coach-btn').classList.add('hidden');
        document.getElementById('coach-panel').classList.add('hidden');
        document.getElementById('action-btns').style.display = 'none';
        document.getElementById('raise-panel').style.display = 'none';
        document.getElementById('result-flash').classList.add('hidden');
        const eb = document.getElementById('emoji-bar');
        if (eb) eb.classList.add('hidden');
        const bjBar = document.getElementById('bj-action-btns');
        if (bjBar) bjBar.style.display = 'none';
        const bjDeal = document.getElementById('bj-deal-bar');
        if (bjDeal) bjDeal.style.display = 'none';
        const solBar = document.getElementById('sol-action-btns');
        if (solBar) solBar.style.display = 'none';
        this._updateChipsDisplay();
        this._syncBankroll();
    },

    _handleBust() {
        this._leaveTable();
        document.getElementById('bust-modal').classList.remove('hidden');
    },

    _openCoach() {
        const panel = document.getElementById('coach-panel');
        panel.classList.toggle('hidden');
        if (panel.classList.contains('hidden')) return;
        this._refreshCoach();
    },

    _refreshCoach() {
        if (this.pokerGame) {
            let result;
            if (this.pokerGame instanceof BlackjackGame) {
                result = Coach.adviseBJ(this.pokerGame.getCoachState());
            } else if (this.pokerGame instanceof SolitaireGame) {
                result = Coach.adviseSolitaire(this.pokerGame.getCoachState());
            } else {
                result = Coach.advise(this.pokerGame.getCoachState());
            }
            document.getElementById('coach-advice').innerHTML = result.advice;
            document.getElementById('coach-tips').innerHTML =
                result.tips.map(t => `<div class="tip">${t.text}</div>`).join('');
        } else {
            document.getElementById('coach-advice').textContent = 'Click a table to get live coaching!';
            document.getElementById('coach-tips').innerHTML =
                '<div class="tip">Start at a Beginner table to learn the ropes.</div>';
        }
    },

    _updateChipsDisplay() {
        const chips = (this.pokerGame && this.state === C.STATE.PLAYING)
            ? this.pokerGame.playerChips
            : this.playerChips;
        document.getElementById('chips-amount').textContent = Utils.formatChips(chips);
    },

    _syncBankroll() {
        let total = this.playerChips;
        if (this.state === C.STATE.PLAYING && this.pokerGame) {
            total += this.pokerGame.playerChips;
        }
        KieferSave.setChips(total);
    },

    _pushHandHistory(line) {
        const el = document.getElementById('hand-history-body');
        if (!el) return;
        const row = document.createElement('div');
        row.className = 'hand-history-line';
        row.textContent = line;
        el.insertBefore(row, el.firstChild);
        while (el.children.length > 40) el.removeChild(el.lastChild);
    },

    _afterShowdownPayout(evt) {
        const w = evt.playerWon ? `Won showdown +$${evt.playerWon}` : 'Lost at showdown';
        this._pushHandHistory(w);
        KieferSave.onHandEnd(evt.playerWon > 0, evt.playerWon || 0);
        this._syncBankroll();
        this._refreshAchievementHud();
    },

    _afterFoldWin(evt) {
        const w = evt.playerWon ? `Won pot +$${evt.amount} (fold)` : '';
        if (w) this._pushHandHistory(w);
        KieferSave.onHandEnd(evt.playerWon, evt.amount || 0);
        this._syncBankroll();
        this._refreshAchievementHud();
    },

    _refreshAchievementHud() {
        const el = document.getElementById('achievement-hud');
        if (!el || typeof KieferSave === 'undefined' || !KieferSave.data.achievements) return;
        const n = Object.keys(KieferSave.data.achievements).length;
        el.textContent = `🏆 ${n}`;
    }
};

window.addEventListener('load', () => Game.init());
