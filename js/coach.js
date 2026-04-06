'use strict';

const Coach = {

    advise(gameState) {
        const {
            gameType, round, holeCards, community, pot, callAmount, playerChips, bigBlind, difficulty,
            isButton, isBigBlind, isSmallBlind, numSeats
        } = gameState;

        if (!holeCards || holeCards.length === 0) {
            return this._welcome(gameType, difficulty);
        }

        const tips  = [];
        const lines = [];

        // Calculate hand strength
        const strength = community.length >= 3
            ? HandEvaluator.postflopStrength(holeCards, community, gameType)
            : HandEvaluator.preflopStrength(holeCards, gameType);

        const drawBonus = this._computeDrawBonus(holeCards, community, gameType, round);
        const effectiveStrength = Math.min(0.99, strength + drawBonus);

        // Get best hand
        const hand = community.length >= 3
            ? (gameType === 'holdem'
                ? HandEvaluator.bestOf7([...holeCards, ...community])
                : HandEvaluator.bestOmaha(holeCards, community))
            : null;

        // ── Hand description ──────────────────────────────────────────────────
        if (round === 'preflop') {
            lines.push(this._preflopDesc(holeCards, gameType, strength));
            lines.push(this._positionAdvice(isButton, isBigBlind, isSmallBlind, numSeats));
        } else if (hand) {
            const boardTex = this._boardTexture(community);
            const icon = strength > 0.72 ? '💪' : strength > 0.45 ? '🤔' : '⚠️';
            lines.push(`${icon} Best hand: <strong>${hand.name}</strong> on a <strong>${boardTex}</strong> board.`);
            if (hand.rank >= 4 && gameType === 'holdem') {
                lines.push(`<span style="opacity:0.95">In Hold'em a made <strong>${hand.name}</strong> is strong — bet for value and protect against draws.</span>`);
            }
        }

        // ── Action advice with pot odds and EV ─────────────────────────────────
        const callAmt = callAmount;
        if (callAmt === 0) {
            this._adviseWhenCanCheck(lines, round, strength, effectiveStrength);
        } else {
            this._adviseWhenFacing(lines, round, strength, effectiveStrength, pot, callAmt, playerChips, community);
        }

        // ── Pot odds explanation ──────────────────────────────────────────────
        if (callAmt > 0) {
            const potOdds = this._calculatePotOdds(pot, callAmt);
            const outs = this._countOuts(holeCards, community, gameType);
            const equity = this._estimateEquity(effectiveStrength, outs, community.length);

            tips.push({
                text: `📊 <strong>Pot odds:</strong> ${potOdds.toFixed(1)}% — you win the pot ${potOdds.toFixed(1)}% of the time to break even.`
            });

            if (outs.total > 0 && community.length < 5) {
                const impliedOdds = this._impliedOdds(pot, callAmt, outs.total, community.length, difficulty);
                tips.push({
                    text: `🎯 <strong>Draw potential:</strong> ${outs.total} outs → ~${equity.toFixed(1)}% equity. Implied odds: ${impliedOdds > potOdds ? '✓ favorable' : '✗ unfavorable'}.`
                });
            }
        }

        // ── Draw detection and analysis ───────────────────────────────────────
        if (community.length >= 3) {
            const draws = this._detectDraws(holeCards, community, gameType);
            const outs = this._countOuts(holeCards, community, gameType);
            if (draws.length > 0) {
                const cardsLeft = community.length < 5 ? `${5 - community.length} card(s) left` : 'no more cards';
                const outDesc = outs.total > 0 ? ` (${outs.total} outs)` : '';
                tips.push({ text: `🎯 <strong>Draws:</strong> ${draws.join(', ')}${outDesc}. ${cardsLeft}.` });
            }

            // Omaha-specific draw info
            if (gameType === 'omaha') {
                const omahaInfo = this._omahaNutAnalysis(holeCards, community, draws);
                if (omahaInfo) {
                    tips.push({ text: omahaInfo });
                }
            }
        }

        // ── Board texture analysis ────────────────────────────────────────────
        if (community.length >= 3) {
            const boardInfo = this._analyzeBoardTexture(community);
            if (boardInfo) {
                tips.push({ text: `🎴 <strong>Board texture:</strong> ${boardInfo}` });
            }
        }

        // ── Bet sizing recommendations ────────────────────────────────────────
        if (callAmt === 0 && community.length > 0 && community.length < 5) {
            const sizing = this._betSizingAdvice(strength, effectiveStrength, pot, community.length);
            if (sizing) {
                tips.push({ text: `💰 ${sizing}` });
            }
        }

        // ── Bluff detection and opportunities ─────────────────────────────────
        if (community.length >= 3 && community.length < 5) {
            const bluffInfo = this._bluffOpportunities(community, strength);
            if (bluffInfo) {
                tips.push({ text: bluffInfo });
            }
        }

        // ── Round-specific tip ────────────────────────────────────────────────
        const rtip = this._roundTip(round, gameType, difficulty);
        if (rtip) tips.push({ text: rtip });

        // ── Stack pressure analysis ───────────────────────────────────────────
        if (callAmt > 0 && playerChips > 0) {
            const stackPressure = this._analyzeStackPressure(callAmt, playerChips, pot);
            if (stackPressure) {
                tips.push({ text: stackPressure });
            }
        }

        // ── Omaha-specific warnings ───────────────────────────────────────────
        if (gameType === 'omaha' && community.length >= 3) {
            const suitCounts = {};
            holeCards.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit]||0)+1);
            const doublesuited = Object.values(suitCounts).some(n => n >= 2);
            if (!doublesuited) {
                tips.push({ text: '⚠️ Omaha: remember you must use exactly 2 hole cards + 3 community cards to make a 5-card hand.' });
            }
        }

        return { advice: lines.join(' '), tips };
    },

    // ──────────────────────────────────────────────────────────────────────────
    // POT ODDS & EQUITY CALCULATIONS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Calculate exact pot odds as a percentage.
     * Pot odds = callAmount / (pot + callAmount) * 100
     */
    _calculatePotOdds(pot, callAmount) {
        if (pot + callAmount === 0) return 0;
        return (callAmount / (pot + callAmount)) * 100;
    },

    /**
     * Count outs for common draw scenarios.
     * Returns { flushOuts, straightOuts, overcardOuts, total }
     */
    _countOuts(holeCards, community, gameType) {
        const outs = {
            flushOuts: 0,
            straightOuts: 0,
            overcardOuts: 0,
            total: 0,
            description: []
        };

        if (community.length < 3) return outs;

        const all = [...holeCards, ...community];
        const usedCards = new Set(all.map(c => c.toString()));

        // Count flush outs
        const suitMap = {};
        all.forEach(c => { suitMap[c.suit] = (suitMap[c.suit] || 0) + 1; });
        for (const [suit, cnt] of Object.entries(suitMap)) {
            if (cnt === 4) {
                // 13 cards of suit minus 4 already present = 9 outs
                outs.flushOuts = 9;
                outs.description.push('9 flush outs');
                break;
            }
        }

        // Count straight outs (simplified approach)
        const vals = [...new Set(all.map(c => c.value))].sort((a, b) => a - b);
        let straightOuts = 0;

        // Check for open-ended straight draws
        for (let i = 0; i <= vals.length - 4; i++) {
            const lo = vals[i];
            const hi = vals[i + 3];
            if (hi - lo === 3) {
                // Open-ended straight draw: 8 outs (4 low, 4 high)
                straightOuts = 8;
                break;
            }
        }

        // Check for gutshot straight draws (if no OESD found)
        if (straightOuts === 0) {
            for (let i = 0; i <= vals.length - 4; i++) {
                const lo = vals[i];
                const hi = vals[i + 3];
                if (hi - lo === 4) {
                    // Gutshot: 4 outs
                    straightOuts = 4;
                    break;
                }
            }
        }

        if (straightOuts > 0) {
            outs.straightOuts = straightOuts;
            outs.description.push(`${straightOuts} straight outs`);
        }

        // Count overcard outs (rough estimate)
        if (community.length >= 3) {
            const boardMax = Math.max(...community.map(c => c.value));
            let overcards = 0;
            for (const card of holeCards) {
                if (card.value > boardMax && !usedCards.has(card.toString())) {
                    overcards++;
                }
            }
            // Each overcard = ~3 outs (accounting for blockers)
            if (overcards > 0) {
                outs.overcardOuts = overcards * 3;
                outs.description.push(`${overcards} overcard(s)`);
            }
        }

        // Total outs (subtract overlaps)
        outs.total = outs.flushOuts + outs.straightOuts + outs.overcardOuts;
        // Cap at reasonable max and subtract duplicates
        outs.total = Math.min(outs.total, 15);

        return outs;
    },

    /**
     * Estimate equity based on strength and outs.
     * Uses simple heuristic: strength * 100 for made hands, outs * 4 for draws.
     */
    _estimateEquity(strength, outs, boardSize) {
        if (boardSize >= 5) {
            // River: just use strength
            return Math.min(strength * 100, 99);
        }

        // For draws: use the "rule of 4" (outs * 4 on flop, outs * 2 on turn)
        const drawEquity = boardSize === 3 ? outs.total * 4 : outs.total * 2;
        const madeHandEquity = strength * 100;

        // If strong made hand, use strength; if draw-heavy, use draw equity
        return Math.min(Math.max(madeHandEquity, drawEquity), 99);
    },

    /**
     * Calculate implied odds: if we make our draw, can we win more?
     * Returns implied odds percentage (higher is better).
     */
    _impliedOdds(pot, callAmount, outs, boardSize, difficulty) {
        if (outs === 0) return 0;

        // Rule of 4 (flop) / Rule of 2 (turn)
        const cardsLeft = boardSize === 3 ? 2 : 1;
        const baseEquity = boardSize === 3 ? outs * 4 : outs * 2;

        // Assume we win 1.5x pot when we hit (conservative)
        const futureWin = pot * 1.5;
        const impliedOdds = (callAmount / futureWin) * 100;

        return Math.max(baseEquity, impliedOdds);
    },

    // ──────────────────────────────────────────────────────────────────────────
    // BOARD TEXTURE ANALYSIS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Analyze board texture: wet vs dry, paired, monotone, etc.
     */
    _boardTexture(community) {
        if (community.length < 3) return 'incomplete';

        const suits = community.map(c => c.suit);
        const values = community.map(c => c.value);
        const suitMap = {};
        suits.forEach(s => { suitMap[s] = (suitMap[s] || 0) + 1; });

        const maxSuit = Math.max(...Object.values(suitMap));
        const gaps = [];
        const sorted = [...values].sort((a,b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
            gaps.push(sorted[i] - sorted[i-1]);
        }
        const avgGap = gaps.reduce((a,b) => a + b, 0) / gaps.length;

        const isPaired = values.length !== new Set(values).size;
        const isMonotone = maxSuit === 3;
        const isWet = avgGap <= 3 || isMonotone || values.some(v => values.filter(x => x === v).length > 1);

        if (isMonotone) return 'monotone (flush-heavy)';
        if (isPaired) return 'paired (full house possible)';
        if (isWet) return 'wet (connected, many draws)';
        return 'dry (few draws)';
    },

    /**
     * Analyze board texture in detail.
     */
    _analyzeBoardTexture(community) {
        if (community.length < 3) return null;

        const suits = community.map(c => c.suit);
        const values = community.map(c => c.value);
        const suitCounts = {};
        suits.forEach(s => { suitCounts[s] = (suitCounts[s] || 0) + 1; });

        const maxSuitCount = Math.max(...Object.values(suitCounts));
        const isPaired = values.length !== new Set(values).size;
        const sorted = [...values].sort((a, b) => a - b);

        let texture = '';
        if (isPaired) {
            texture += '📌 Paired board — full houses and trips possible. ';
        }
        if (maxSuitCount === 3) {
            texture += '♦ Monotone board (3 same suit) — flush draws are strong. ';
        } else if (maxSuitCount === 2) {
            texture += '♦ Two-flush on board — flush draws are possible. ';
        }

        // Connectivity
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) {
            gaps.push(sorted[i] - sorted[i-1]);
        }
        const hasHighCards = sorted.some(v => v >= 12);
        if (sorted[sorted.length - 1] - sorted[0] <= 5) {
            texture += '📍 Connected board — straight draws likely. ';
        } else if (hasHighCards) {
            texture += '👑 High card board — overcards matter. ';
        }

        return texture.trim() || null;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // POSITION & STRATEGY
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Position-aware strategic advice.
     */
    _positionAdvice(isButton, isBigBlind, isSmallBlind, numSeats) {
        if (isButton === undefined) return '';

        if (isButton) {
            return '📍 <strong>Button:</strong> you act last postflop. Play wider ranges, steal blinds, apply maximum pressure.';
        } else if (isBigBlind) {
            return '📍 <strong>Big Blind:</strong> you defend the blind. Can call wider preflop, but out of position postflop — be careful with marginal hands.';
        } else if (isSmallBlind) {
            return '📍 <strong>Small Blind:</strong> worst position at the table. Play tight, premium hands only unless stealing.';
        } else {
            if (numSeats <= 3) {
                return '📍 <strong>Early position:</strong> few players left to act — play tight, strong hands only.';
            } else if (numSeats <= 5) {
                return '📍 <strong>Middle position:</strong> moderate hands acceptable. Standard opening range.';
            } else {
                return '📍 <strong>Late position:</strong> many have folded — play wider, apply pressure, steal.';
            }
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // HAND RANGE ESTIMATION
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Estimate opponent range based on board and action.
     * Returns a description of likely hands.
     */
    _estimateOpponentRange(community, round, difficulty) {
        if (round === 'preflop') {
            return 'opening range (depends on position)';
        }

        const boardTex = this._boardTexture(community);
        if (boardTex.includes('pair')) {
            return 'sets, overpairs, top pairs, draws';
        }
        if (boardTex.includes('monotone')) {
            return 'strong pairs, flush draws, nut draws';
        }
        if (boardTex.includes('wet')) {
            return 'pairs, straight draws, flush draws, overcards';
        }
        return 'mixed hands: pairs, draws, overcards';
    },

    // ──────────────────────────────────────────────────────────────────────────
    // BET SIZING RECOMMENDATIONS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Recommend bet sizing (1/3, 1/2, 2/3, pot, overbet).
     */
    _betSizingAdvice(strength, effectiveStrength, pot, boardSize) {
        if (effectiveStrength < 0.35) return null; // Too weak to bet

        if (effectiveStrength > 0.8) {
            // Strong hand: bet for value
            const amount = pot * 2/3;
            return `<strong>Bet sizing:</strong> consider <strong>2/3 pot (~$${Math.round(amount)})</strong> for value — strong hand.`;
        } else if (effectiveStrength > 0.6) {
            // Medium strength: standard sizing
            const amount = pot * 1/2;
            return `<strong>Bet sizing:</strong> try <strong>half pot (~$${Math.round(amount)})</strong> to balance value and bluffs.`;
        } else if (effectiveStrength > 0.45) {
            // Marginal hand: smaller bet or check
            const amount = pot * 1/3;
            return `<strong>Bet sizing:</strong> if betting, <strong>1/3 pot (~$${Math.round(amount)})</strong> for semi-bluff value.`;
        }
        return null;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // BLUFF DETECTION & OPPORTUNITIES
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Detect when the board texture favors bluffing.
     */
    _bluffOpportunities(community, strength) {
        if (community.length >= 5) {
            // River
            if (strength < 0.35) {
                return '🎭 River bluff opportunity on this dry board — but have a story (hand progression).';
            }
            return null;
        }

        const boardTex = this._boardTexture(community);

        if (boardTex.includes('dry')) {
            if (strength < 0.4) {
                return '🎭 <strong>Bluff setup:</strong> dry boards favor aggression — bet confidently even with weak hands if it fits your story.';
            }
        }

        if (boardTex.includes('connected')) {
            return '🎭 <strong>Bluff risk:</strong> connected boards have many made hands/draws — bluffs may meet resistance.';
        }

        return null;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // EXPECTED VALUE (EV) CALCULATIONS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Calculate EV of a call decision.
     */
    _calculateCallEV(strength, potOdds, pot, callAmount) {
        // EV = (strength * winAmount) + ((1 - strength) * -callAmount)
        // Simplified: if strength > potOdds, positive EV
        const winAmount = pot + callAmount;
        const ev = (strength * winAmount) - ((1 - strength) * callAmount);
        return ev;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // OMAHA-SPECIFIC STRATEGY
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Omaha-specific analysis: nut draws, wrap draws, blockers.
     */
    _omahaNutAnalysis(holeCards, community, draws) {
        if (draws.length === 0) return null;

        // Check for nut flush draw (blocker analysis would be complex; simplified)
        const info = [];

        if (draws.some(d => d.includes('flush'))) {
            const ace = holeCards.some(c => c.value === 14);
            if (ace) {
                info.push('🎯 You have a <strong>nut flush draw</strong> (broadway flush possible) — strong hand.');
            } else {
                info.push('🎯 You have a <strong>flush draw</strong> — but watch for nut flush draws by opponents.');
            }
        }

        if (draws.some(d => d.includes('open-ended'))) {
            // Omaha wrap draws (multiple straight possibilities)
            info.push('📍 <strong>Strong straight draw</strong> in Omaha — but be careful of straights losing to full houses.');
        }

        // Check for danglers (hole cards not involved in any draw)
        const cardsInDraws = new Set();
        for (const draw of draws) {
            // Simplified: assume 2 cards per draw on average
            // In a real implementation, track which specific cards are involved
        }

        const danger = holeCards.length - cardsInDraws.size;
        if (danger >= 2) {
            info.push('⚠️ You have <strong>dangler cards</strong> (not helping any draw) — reduces your equity.');
        }

        return info.length > 0 ? info.join(' ') : null;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // STACK PRESSURE & ICM
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Analyze stack pressure and ICM implications.
     */
    _analyzeStackPressure(callAmount, playerChips, pot) {
        const stackRatio = callAmount / playerChips;
        const potCommitment = callAmount / (pot + callAmount);

        if (stackRatio > 0.5) {
            return `💸 <strong>Stack crisis:</strong> calling $${callAmount} commits ${Math.round(stackRatio * 100)}% of your chips. Play tight, fold marginal hands.`;
        } else if (stackRatio > 0.3) {
            return `💸 <strong>Stack pressure:</strong> ${Math.round(stackRatio * 100)}% of stack at risk — only call with premium hands or draws.`;
        } else if (potCommitment > 0.5) {
            return `💰 <strong>Pot commitment:</strong> you're already ${Math.round(potCommitment * 100)}% committed — see it through.`;
        }

        return null;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // ACTION ADVICE
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Give advice when the player can check (callAmount == 0).
     */
    _adviseWhenCanCheck(lines, round, strength, effectiveStrength) {
        if (round === 'river') {
            if (strength > 0.72) {
                lines.push('💪 Strong hand on the river — <strong>bet for value</strong>. No more cards to fear.');
            } else if (strength > 0.48) {
                lines.push('🤔 Marginal showdown hand — <strong>check and call</strong>. Bet only if you can get called by worse.');
            } else {
                lines.push('⚠️ Weak hand — <strong>check</strong>. No more cards coming, so there\'s no free card to wait for.');
            }
        } else if (effectiveStrength > 0.72) {
            lines.push('💪 Strong hand — <strong>bet</strong> to build the pot and charge drawing hands.');
        } else if (effectiveStrength > 0.48) {
            lines.push('🤔 Decent hand — <strong>bet for value</strong> or check and see what happens. Watch opponent reactions.');
        } else if (effectiveStrength > 0.35) {
            lines.push('⚠️ Weak hand — <strong>check</strong> for a free card. Consider checking to control the pot.');
        } else {
            lines.push('⚠️ Very weak hand — <strong>check</strong> and fold to aggression.');
        }
    },

    /**
     * Give advice when facing a bet (must call or fold/raise).
     */
    _adviseWhenFacing(lines, round, strength, effectiveStrength, pot, callAmount, playerChips, community) {
        const potOdds = this._calculatePotOdds(pot, callAmount);
        const outs = this._countOuts([], community, 'holdem'); // Simple out count for generic case
        const equity = this._estimateEquity(effectiveStrength, outs, community.length);
        const evCall = this._calculateCallEV(effectiveStrength, potOdds / 100, pot, callAmount);

        if (effectiveStrength > 0.75) {
            lines.push(`💪 Very strong hand! Don't just call $${callAmount} — consider <strong>raising</strong> to maximize value and thin the field.`);
        } else if (equity >= potOdds && effectiveStrength > 0.45) {
            lines.push(`✓ Calling $${callAmount} has positive EV (~${Math.round(equity - potOdds)}% advantage). Your ${Math.round(equity)}% equity beats the ${Math.round(potOdds)}% pot odds.`);
        } else if (effectiveStrength > 0.3 && community.length < 5) {
            lines.push(`🤔 The math is borderline. You'd need to win more than 1 in ${Math.round((pot + callAmount) / callAmount)} times. Only call with strong draw potential or fold.`);
        } else {
            lines.push(`❌ Calling $${callAmount} is a <strong>fold</strong>. Your equity (~${Math.round(equity)}%) can't overcome the ${Math.round(potOdds)}% pot odds. Long-term losing play.`);
        }

        // Stack pressure context
        if (callAmount > playerChips * 0.4 && effectiveStrength < 0.6) {
            lines.push(`⚠️ This call risks ${Math.round(callAmount / playerChips * 100)}% of your stack on a marginal hand. Consider folding to preserve chips.`);
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // HAND DESCRIPTIONS
    // ──────────────────────────────────────────────────────────────────────────

    _preflopDesc(holeCards, gameType, strength) {
        if (gameType === 'holdem') {
            const [a, b] = holeCards;
            const suited    = a.suit === b.suit;
            const paired    = a.value === b.value;
            const connected = Math.abs(a.value - b.value) === 1;
            const oneGap    = Math.abs(a.value - b.value) === 2;

            const tier = strength > 0.82 ? '🌟 <strong>Premium hand</strong>'
                       : strength > 0.65 ? '✅ <strong>Strong hand</strong>'
                       : strength > 0.45 ? '⚠️ <strong>Playable hand</strong>'
                       : '❌ <strong>Weak hand</strong>';

            let features = '';
            if (paired)              features = `pocket ${a.rank}s — a pair right away!`;
            else if (suited && connected) features = `suited connector (${a.rank}${a.suit}–${b.rank}${b.suit}) — great multi-way potential`;
            else if (suited && oneGap)    features = `suited one-gapper — flush & near-straight draws possible`;
            else if (suited)              features = `${a.rank}–${b.rank} suited — flush draw upside`;
            else if (connected)           features = `${a.rank}–${b.rank} connected — straight draw potential`;
            else                          features = `${a.rank}–${b.rank} offsuit`;

            const action = strength > 0.78 ? ' <strong>Raise</strong> to build the pot and gain initiative.'
                         : strength > 0.55 ? ' <strong>Call or raise</strong> — solid value.'
                         : strength > 0.38 ? ' Worth a call in position; fold to big raises.'
                         : ' <strong>Fold</strong>, especially facing aggression.';

            return `${tier}: ${features}.${action}`;
        } else {
            // Omaha
            const suits  = holeCards.map(c => c.suit);
            const suitMap = {};
            suits.forEach(s => suitMap[s] = (suitMap[s]||0)+1);
            const maxS   = Math.max(...Object.values(suitMap));
            const vals   = holeCards.map(c => c.value).sort((a,b)=>a-b);
            const hasPair = holeCards.some((c,i) => holeCards.some((c2,j) => i!==j && c.value===c2.value));
            const span    = vals[3] - vals[0];

            const tier = strength > 0.78 ? '🌟 <strong>Premium Omaha hand</strong>'
                       : strength > 0.58 ? '✅ <strong>Strong Omaha hand</strong>'
                       : strength > 0.40 ? '⚠️ <strong>Playable Omaha hand</strong>'
                       : '❌ <strong>Weak Omaha hand</strong>';

            const features = [];
            if (hasPair)  features.push('contains a pair');
            if (maxS >= 2) features.push(maxS >= 3 ? 'triple-suited ♦♦♦' : 'double-suited ♦♦');
            if (span <= 4) features.push('connected/rundown');

            return `${tier}${features.length ? ': ' + features.join(', ') : ''}. ${strength > 0.6 ? 'Play aggressively.' : strength > 0.4 ? 'Proceed with caution.' : 'Low equity — be very selective.'}`;
        }
    },

    // ──────────────────────────────────────────────────────────────────────────
    // DRAW DETECTION
    // ──────────────────────────────────────────────────────────────────────────

    _computeDrawBonus(holeCards, community, gameType, round) {
        if (community.length < 3) return 0;
        const draws = this._detectDraws(holeCards, community, gameType);
        let bonus = 0;
        if (draws.some(d => d.includes('flush'))) bonus += 0.28;
        if (draws.some(d => d.includes('open-ended'))) bonus += 0.2;
        if (draws.some(d => d.includes('gutshot') || d.includes('wheel'))) bonus += 0.1;
        const mult = round === 'turn' ? 0.6 : (round === 'river' ? 0 : 1);
        return bonus * mult;
    },

    _detectDraws(holeCards, community, gameType) {
        if (gameType === 'omaha' && holeCards.length >= 4) {
            return this._detectDrawsOmaha(holeCards, community);
        }
        return this._detectDrawsForCombo(holeCards, community, false);
    },

    _detectDrawsOmaha(holeCards, community) {
        const labels = new Set();
        for (let i = 0; i < holeCards.length - 1; i++) {
            for (let j = i + 1; j < holeCards.length; j++) {
                const pair = [holeCards[i], holeCards[j]];
                for (const d of this._detectDrawsForCombo(pair, community, true)) {
                    labels.add(d);
                }
            }
        }
        return [...labels];
    },

    /**
     * @param {boolean} requireHoleDraw — if true (Omaha 2-card combo), draws must involve those hole cards.
     */
    _detectDrawsForCombo(holeCards, community, requireHoleDraw) {
        const draws = [];
        const all   = [...holeCards, ...community];
        const holeVals = new Set(holeCards.map(c => c.value));

        const suitMap = {};
        all.forEach(c => { suitMap[c.suit] = (suitMap[c.suit] || 0) + 1; });
        for (const [suit, cnt] of Object.entries(suitMap)) {
            if (cnt === 4) {
                const fromHole = holeCards.filter(c => c.suit === suit).length;
                if (fromHole >= 1) {
                    if (!requireHoleDraw) {
                        draws.push('flush draw (4 to a flush)');
                        break;
                    }
                    const fromBoard = community.filter(c => c.suit === suit).length;
                    if (fromHole + fromBoard === 4) {
                        draws.push('flush draw (4 to a flush)');
                        break;
                    }
                }
            }
        }

        const vals = [...new Set(all.map(c => c.value))].sort((a, b) => a - b);

        const patternTouchesHole = (lo, hi) => {
            for (let r = lo; r <= hi; r++) {
                if (holeVals.has(r)) return true;
            }
            return false;
        };

        for (let i = 0; i <= vals.length - 4; i++) {
            const span = vals[i + 3] - vals[i];
            const lo = vals[i], hi = vals[i + 3];
            if (span === 3 && hi - lo === 3) {
                if (!requireHoleDraw || patternTouchesHole(lo, hi)) {
                    draws.push('open-ended straight draw');
                    break;
                }
            } else if (span === 4 && hi - lo === 4) {
                if (!requireHoleDraw || patternTouchesHole(lo, hi)) {
                    draws.push('gutshot straight draw');
                    break;
                }
            }
        }

        if (vals.includes(14) && vals.includes(2) && vals.includes(3) && vals.includes(4)) {
            const wheelOk = !requireHoleDraw || holeVals.has(14) || holeVals.has(2) || holeVals.has(3) || holeVals.has(4);
            if (wheelOk && !draws.some(d => d.includes('straight'))) {
                draws.push('wheel straight draw (A–5)');
            }
        }

        return draws;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // ROUND TIPS
    // ──────────────────────────────────────────────────────────────────────────

    _roundTip(round, gameType, difficulty) {
        const pool = {
            preflop: [
                '📍 <strong>Position tip:</strong> acting last (being "in position") is a huge advantage — you see what others do first.',
                '🃏 <strong>Hand selection:</strong> tight is right pre-flop. Playing too many hands is the #1 beginner mistake.',
                '💰 <strong>Raise sizing:</strong> 2.5–3× the big blind is standard. Bigger raises reduce the field; smaller raises get more calls.',
                '🎯 <strong>3-bet strategy:</strong> re-raising (3-betting) shows strength and can win the pot immediately or win cheaply postflop.',
            ],
            flop: [
                '🔍 <strong>Board evaluation:</strong> did this flop hit your hand? Help your opponents more than you?',
                '⚡ <strong>Critical moment:</strong> the flop is where most chips are won or lost. Play strong hands aggressively, marginal ones carefully.',
                '🃏 <strong>Continuation bet:</strong> c-betting after raising pre-flop shows strength and can win even if you miss the flop.',
                '📊 <strong>equity realization:</strong> you have 2 cards left to come — don\'t overvalue equity if you\'re behind.',
            ],
            turn: [
                '📈 <strong>Bet sizing:</strong> pot-sized bets on the turn apply maximum pressure on draws and marginal hands.',
                '🎯 <strong>Draw completion:</strong> if you had a draw on the flop and missed, the turn is often cheaper to give up than the river.',
                '🧮 <strong>Outs mathematics:</strong> with one card left (river), you have roughly a 2% chance per "out" of hitting.',
                '🔄 <strong>Position power:</strong> check-raising on the turn shows strength and defines opponent\'s hand.',
            ],
            river: [
                '🏁 <strong>No more cards:</strong> bet for value if you\'re ahead; bluff only when the board and hand progression tell a story.',
                '💭 <strong>River bluffs:</strong> should represent a hand that makes sense given how you\'ve bet the entire hand.',
                '🤝 <strong>Close decisions:</strong> when in doubt, check and call rather than bluff — showdown value is real on the river.',
                '🎴 <strong>Board runouts:</strong> analyze which hands beat you and which lose to you. Polarize your betting.',
            ]
        };

        const arr = pool[round];
        if (!arr) return null;
        return arr[Math.floor(Math.random() * arr.length)];
    },

    // ──────────────────────────────────────────────────────────────────────────
    // WELCOME MESSAGE
    // ──────────────────────────────────────────────────────────────────────────

    _welcome(gameType, difficulty) {
        if (gameType === 'holdem') {
            return {
                advice: "Welcome to Texas Hold'em! You get 2 private cards and share 5 community cards with all players. Best 5-card hand wins. This coach will help you with pot odds, hand strength, position strategy, and more.",
                tips: [
                    { text: '🃏 <strong>Hole cards:</strong> 2 face-down cards only you can see. Keep them secret!' },
                    { text: '💰 <strong>Betting rounds:</strong> Pre-Flop → Flop (3 cards) → Turn (1 card) → River (1 card) → Showdown.' },
                    { text: '✋ <strong>Actions:</strong> Fold (quit), Check (free pass), Call (match bet), Raise (increase bet), All-in (risk all chips).' },
                    { text: '🏆 <strong>Hand rankings (best→worst):</strong> Royal Flush · Straight Flush · 4-of-a-Kind · Full House · Flush · Straight · 3-of-a-Kind · Two Pair · Pair · High Card.' },
                    { text: '📍 <strong>Position matters:</strong> acting last postflop is a huge advantage. Play tighter early, wider late.' },
                    { text: '📊 <strong>Pot odds:</strong> compare what you pay to win against your hand\'s equity. This coach will do the math for you!' }
                ]
            };
        } else {
            return {
                advice: "Welcome to Omaha! You get 4 hole cards but MUST use exactly 2 of them (plus exactly 3 community cards) in your final 5-card hand. No exceptions! This coach specializes in Omaha strategy including nut draws, wrap draws, and board analysis.",
                tips: [
                    { text: '⚠️ <strong>The Omaha rule:</strong> exactly 2 hole cards + 3 community cards = your final hand. Not more, not less! This is mandatory.' },
                    { text: '♦ <strong>Best starting hands:</strong> double-suited, connected, high-card rundowns (e.g. A♠K♥Q♠J♥) or small pairs with broadway.' },
                    { text: '💡 <strong>Trap hands:</strong> A-A-x-x is weaker than Hold\'em (you can only use one ace), and K-K-Q-Q is common but not premium.' },
                    { text: '🏆 <strong>Board texture:</strong> boards pair often in Omaha — straights can easily lose to full houses. High pair is more valuable here.' },
                    { text: '🎯 <strong>Nut draws:</strong> play nut flush draws and wrap draws aggressively. Non-nut draws often fold to pressure.' },
                    { text: '⚠️ <strong>Omaha is variance-heavy:</strong> even good decisions can go wrong. Use position and pot odds to your advantage.' }
                ]
            };
        }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // BLACKJACK COACH — Full basic strategy engine
    // ══════════════════════════════════════════════════════════════════════════

    adviseBJ(gs) {
        const tips = [];
        const lines = [];

        if (gs.state === 'betting') {
            return this._bjBettingAdvice(gs);
        }

        if (gs.playerHand.length === 0) {
            return { advice: 'Place your bet and hit DEAL to start!', tips: [
                { text: '\uD83C\uDCCF <strong>Goal:</strong> Get closer to 21 than the dealer without going over.' }
            ]};
        }

        const pv = gs.playerValue;
        const soft = gs.isSoft;
        const upcard = gs.dealerUpcard;
        const uv = upcard ? (upcard.rank === 'A' ? 11 : Math.min(upcard.value, 10)) : 0;
        const canDouble = gs.canDouble;
        const nCards = gs.playerHand.length;

        // ── Basic strategy decision ──
        const action = this._bjBasicStrategy(pv, soft, uv, nCards, canDouble);

        // Describe hand
        const softLabel = soft ? 'Soft ' : '';
        lines.push(`\uD83C\uDCCF Your hand: <strong>${softLabel}${pv}</strong> vs dealer showing <strong>${upcard ? upcard.rank + upcard.suit : '?'}</strong> (${uv}).`);

        // Action recommendation
        const actionIcons = { hit: '\u2B07\uFE0F', stand: '\u270B', double: '\uD83D\uDCB0', surrender: '\uD83C\uDFF3\uFE0F' };
        const actionLabels = { hit: 'HIT', stand: 'STAND', double: 'DOUBLE DOWN', surrender: 'SURRENDER' };
        lines.push(`${actionIcons[action] || '\u2753'} Basic strategy says: <strong>${actionLabels[action] || action}</strong>`);

        // Explain why
        lines.push(this._bjExplainAction(action, pv, soft, uv, canDouble));

        // Bust probability
        if (pv >= 12 && !soft) {
            const bustChance = this._bjBustChance(pv);
            tips.push({ text: `\u26A0\uFE0F <strong>Bust risk if you hit:</strong> ${bustChance}%. ${bustChance > 50 ? 'High risk \u2014 consider standing.' : 'Manageable risk.'}` });
        }

        // Dealer bust probability
        const dealerBust = this._bjDealerBustChance(uv);
        tips.push({ text: `\uD83C\uDFB0 <strong>Dealer bust chance:</strong> ~${dealerBust}% with a ${uv} showing. ${dealerBust >= 35 ? 'Dealer is weak \u2014 good spot for you!' : dealerBust <= 20 ? 'Dealer is strong \u2014 be careful.' : 'Average dealer position.'}` });

        // Counting hint (simplified)
        if (gs.shoeRemaining < 200) {
            tips.push({ text: `\uD83D\uDCCA <strong>Shoe depth:</strong> ${gs.shoeRemaining} cards remaining. ${gs.shoeRemaining < 100 ? 'Shoe is getting thin \u2014 counts become more reliable.' : ''}` });
        }

        // Streak awareness
        if (Math.abs(gs.streak) >= 3) {
            if (gs.streak > 0) {
                tips.push({ text: `\uD83D\uDD25 <strong>Hot streak!</strong> ${gs.streak} wins in a row. Remember: each hand is independent \u2014 don\'t let confidence lead to over-betting.` });
            } else {
                tips.push({ text: `\u2744\uFE0F <strong>Cold streak:</strong> ${Math.abs(gs.streak)} losses. Stay disciplined \u2014 don\'t chase losses with bigger bets.` });
            }
        }

        // Double down tip
        if (canDouble && action === 'double') {
            tips.push({ text: '\uD83D\uDCB0 <strong>Double opportunity!</strong> You get exactly one more card and your bet doubles. This is a high-EV play when basic strategy recommends it.' });
        }

        return { advice: lines.join('<br>'), tips };
    },

    _bjBettingAdvice(gs) {
        const lines = [];
        const tips = [];

        lines.push('\uD83C\uDFB0 <strong>Place your bet!</strong> Click chips to build your wager, then hit DEAL.');

        // Bet sizing advice
        const bankroll = gs.playerChips + gs.currentBet;
        const pctBet = Math.round(gs.currentBet / bankroll * 100);
        if (pctBet > 20) {
            lines.push('\u26A0\uFE0F You\'re betting a large portion of your bankroll. Consider sizing down to manage variance.');
        } else if (pctBet < 3) {
            lines.push('\uD83D\uDCA1 Small bet relative to your stack. Feel free to size up if you\'re comfortable.');
        } else {
            lines.push('\u2705 Good bet size relative to your bankroll.');
        }

        tips.push({ text: '\uD83D\uDCCA <strong>Bankroll tip:</strong> The "1-3% rule" suggests betting 1-3% of your total bankroll per hand to survive variance.' });
        tips.push({ text: '\uD83C\uDCCF <strong>House edge:</strong> With perfect basic strategy, blackjack has only a ~0.5% house edge \u2014 one of the best odds in the casino!' });
        tips.push({ text: '\uD83D\uDCB0 <strong>Blackjack payout:</strong> A natural 21 (Ace + 10-value) pays 3:2, which is 1.5x your bet.' });

        return { advice: lines.join('<br>'), tips };
    },

    _bjBasicStrategy(pv, soft, uv, nCards, canDouble) {
        // Soft hands (contain an ace counted as 11)
        if (soft) {
            if (pv >= 20) return 'stand';
            if (pv === 19) return (uv === 6 && canDouble) ? 'double' : 'stand';
            if (pv === 18) {
                if (uv >= 2 && uv <= 6 && canDouble) return 'double';
                if (uv >= 9 || uv === 1) return 'hit';
                return 'stand';
            }
            if (pv === 17) return (uv >= 3 && uv <= 6 && canDouble) ? 'double' : 'hit';
            if (pv === 16 || pv === 15) return (uv >= 4 && uv <= 6 && canDouble) ? 'double' : 'hit';
            if (pv === 14 || pv === 13) return (uv >= 5 && uv <= 6 && canDouble) ? 'double' : 'hit';
            return 'hit';
        }

        // Hard hands
        if (pv >= 17) return 'stand';
        if (pv >= 13 && pv <= 16) {
            return (uv >= 2 && uv <= 6) ? 'stand' : 'hit';
        }
        if (pv === 12) {
            return (uv >= 4 && uv <= 6) ? 'stand' : 'hit';
        }
        if (pv === 11) return canDouble ? 'double' : 'hit';
        if (pv === 10) {
            return (uv >= 2 && uv <= 9 && canDouble) ? 'double' : 'hit';
        }
        if (pv === 9) {
            return (uv >= 3 && uv <= 6 && canDouble) ? 'double' : 'hit';
        }
        return 'hit'; // 8 or below
    },

    _bjExplainAction(action, pv, soft, uv, canDouble) {
        if (action === 'stand') {
            if (pv >= 17) return '\uD83D\uDCA1 With 17+, your risk of busting is too high to justify hitting.';
            if (uv >= 2 && uv <= 6) return '\uD83D\uDCA1 Dealer shows a weak card (' + uv + '). Let them risk busting instead of you.';
            return '\uD83D\uDCA1 Standing is the lowest-risk play here.';
        }
        if (action === 'hit') {
            if (pv <= 11) return '\uD83D\uDCA1 You can\'t bust with ' + pv + ' \u2014 always take a card.';
            if (soft) return '\uD83D\uDCA1 Soft hand \u2014 the Ace protects you from busting. Take the card.';
            return '\uD83D\uDCA1 Dealer shows a strong ' + uv + '. You need to improve your hand to compete.';
        }
        if (action === 'double') {
            return '\uD83D\uDCA1 Excellent doubling spot! Your hand is strong and the dealer is vulnerable. Maximize your value.';
        }
        return '';
    },

    _bjBustChance(pv) {
        // Approximate bust chances when hitting
        const chances = { 12: 31, 13: 38, 14: 46, 15: 54, 16: 62, 17: 69, 18: 77, 19: 85, 20: 92 };
        return chances[pv] || (pv >= 21 ? 100 : 0);
    },

    _bjDealerBustChance(uv) {
        // Approximate dealer bust chances by upcard
        const chances = { 2: 35, 3: 37, 4: 40, 5: 42, 6: 42, 7: 26, 8: 24, 9: 23, 10: 23, 11: 17 };
        return chances[uv] || 25;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SOLITAIRE COACH — Move analysis and strategy
    // ══════════════════════════════════════════════════════════════════════════

    adviseSolitaire(gs) {
        const tips = [];
        const lines = [];

        if (gs.state === 'won') {
            return { advice: '\uD83C\uDF89 <strong>Congratulations!</strong> You won! Great job!', tips: [
                { text: '\uD83D\uDCB0 <strong>Earnings:</strong> $' + gs.earnings + ' from ' + gs.moveCount + ' moves.' }
            ]};
        }

        const moves = gs.moves;
        const foundTotal = gs.foundTotal;
        const hiddenCards = gs.hiddenCards;
        const emptyColumns = gs.emptyColumns;

        // Progress
        const pctDone = Math.round(foundTotal / 52 * 100);
        lines.push(`\u2660\u2665\u2666\u2663 Progress: <strong>${foundTotal}/52</strong> cards to foundation (${pctDone}%). Hidden cards: <strong>${hiddenCards}</strong>.`);

        // ── Priority moves ──
        if (moves.length === 0) {
            if (gs.stockLeft > 0) {
                lines.push('\uD83D\uDCCC <strong>No moves visible.</strong> Draw from the stock pile to reveal new options.');
            } else {
                lines.push('\u26A0\uFE0F <strong>No moves available and stock is empty.</strong> The game may be stuck. Consider if any tableau rearrangements were missed.');
            }
        } else {
            // Rank moves by priority
            const ranked = this._solRankMoves(moves, gs);
            const best = ranked[0];

            if (best.priority === 'foundation') {
                lines.push(`\u2B06\uFE0F <strong>Best move:</strong> Move <strong>${best.move.card.rank}${best.move.card.suit}</strong> to the foundation. ${best.reason}`);
            } else if (best.priority === 'reveal') {
                lines.push(`\uD83D\uDD0D <strong>Best move:</strong> Move <strong>${best.move.card.rank}${best.move.card.suit}</strong> from column ${best.move.from + 1} to column ${best.move.to + 1}. ${best.reason}`);
            } else if (best.priority === 'king-to-empty') {
                lines.push(`\u265A <strong>Best move:</strong> Move a King to the empty column. ${best.reason}`);
            } else {
                lines.push(`\uD83D\uDCA1 <strong>Suggested:</strong> ${best.reason}`);
            }

            // Show alternative count
            if (ranked.length > 1) {
                lines.push(`<span style="opacity:0.7">${ranked.length} possible moves detected.</span>`);
            }
        }

        // ── Strategy tips based on game state ──

        // Empty column advice
        if (emptyColumns > 0 && hiddenCards > 0) {
            tips.push({ text: `\u265A <strong>Empty column:</strong> You have ${emptyColumns} empty column${emptyColumns > 1 ? 's' : ''}. Save ${emptyColumns > 1 ? 'them' : 'it'} for Kings \u2014 only Kings can go on empty columns. Moving a King there opens access to hidden cards beneath it.` });
        } else if (emptyColumns === 0 && hiddenCards > 0) {
            tips.push({ text: '\uD83D\uDD12 <strong>All columns occupied.</strong> Focus on uncovering hidden cards by moving face-up stacks around. Freeing a column gives you flexibility.' });
        }

        // Foundation timing
        if (foundTotal < 10) {
            tips.push({ text: '\uD83D\uDCA1 <strong>Foundation strategy:</strong> Early game \u2014 don\'t rush cards to foundations. Keep low cards in the tableau if they help build sequences. Aces and 2s are safe to move up immediately.' });
        } else if (foundTotal > 30) {
            tips.push({ text: '\uD83C\uDFC1 <strong>Endgame:</strong> With ' + foundTotal + ' cards placed, focus on clearing remaining hidden cards. Move everything to foundations when possible.' });
        }

        // Hidden cards advice
        if (hiddenCards > 15) {
            tips.push({ text: '\uD83D\uDD0D <strong>Many hidden cards:</strong> ' + hiddenCards + ' cards still face-down. Prioritize moves that uncover hidden cards over other moves \u2014 information is power in solitaire.' });
        } else if (hiddenCards > 0 && hiddenCards <= 5) {
            tips.push({ text: '\u2728 <strong>Almost there!</strong> Only ' + hiddenCards + ' hidden card' + (hiddenCards > 1 ? 's' : '') + ' left. Focus on uncovering ' + (hiddenCards > 1 ? 'them' : 'it') + ' to unlock the win.' });
        } else if (hiddenCards === 0) {
            tips.push({ text: '\u2705 <strong>All cards revealed!</strong> The game is now solvable. Move everything to the foundations systematically.' });
        }

        // Stock management
        if (gs.stockLeft > 0) {
            tips.push({ text: '\uD83C\uDCCF <strong>Stock:</strong> ' + gs.stockLeft + ' cards remaining. Exhaust tableau moves before drawing \u2014 each draw costs opportunity.' });
        }

        // Earnings check
        const netEarnings = gs.earnings - 50; // subtract buy-in
        if (netEarnings > 0) {
            tips.push({ text: '\uD83D\uDCB0 <strong>In the money!</strong> You\'ve earned $' + gs.earnings + ' so far (net +$' + netEarnings + ' after buy-in). Keep going!' });
        }

        return { advice: lines.join('<br>'), tips };
    },

    _solRankMoves(moves, gs) {
        const ranked = [];

        for (const m of moves) {
            let priority = 'other';
            let score = 0;
            let reason = '';

            if (m.type === 'tableau-to-foundation' || m.type === 'waste-to-foundation') {
                priority = 'foundation';
                score = 100;
                // Aces and 2s are always good to move up
                if (m.card.value <= 2) {
                    score = 150;
                    reason = 'Always move Aces and 2s to foundation immediately.';
                } else {
                    reason = 'Building your foundation earns $5 and progresses toward victory.';
                    // Check if moving this card up would strand something
                    score = 90;
                }
            } else if (m.type === 'tableau-to-tableau') {
                if (m.revealsHidden) {
                    priority = 'reveal';
                    score = 120;
                    reason = 'This uncovers a hidden card \u2014 top priority!';
                } else if (m.card.value === 13 && gs.emptyColumns > 0) {
                    priority = 'king-to-empty';
                    score = 80;
                    reason = 'Moving a King to an empty column opens up the board.';
                } else {
                    score = 30 + m.stackSize * 2;
                    reason = 'Reorganizes the tableau for better access.';
                }
            } else if (m.type === 'waste-to-tableau') {
                score = 50;
                reason = 'Clears the waste pile and gets a card into play.';
            }

            ranked.push({ move: m, priority, score, reason });
        }

        ranked.sort((a, b) => b.score - a.score);
        return ranked;
    }
};
