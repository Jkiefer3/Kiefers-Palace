'use strict';

class AIPlayer {
    constructor(seat, difficulty, chips, name) {
        this.seat = seat;
        this.difficulty = difficulty;
        this.chips = chips;
        this.name = name;
        this.holeCards = [];
        this.currentBet = 0;
        this.folded = false;
        this.isAllIn = false;
        this.lastAction = '';
        this.investedThisHand = 0;

        // Expert AI tracks player tendencies
        this.playerStats = { handsPlayed: 0, raises: 0, folds: 0 };

        // Personality bias based on name hash
        this.personalityBias = this._calculatePersonalityBias(name);
        // 0 = neutral, -1 = passive, +1 = aggressive
    }

    _calculatePersonalityBias(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = ((hash << 5) - hash) + name.charCodeAt(i);
            hash = hash & hash;
        }
        const normalized = ((hash % 3) - 1); // Results in -1, 0, or 1
        return normalized * 0.15; // Scale down to 0.15 personality impact
    }

    reset() {
        this.holeCards = [];
        this.currentBet = 0;
        this.folded = false;
        this.isAllIn = false;
        this.lastAction = '';
        this.investedThisHand = 0;
    }

    // Returns { action: 'fold'|'check'|'call'|'raise', amount }
    decide(gameState) {
        const { pot, callAmount, community, gameType, round, bigBlind, position, playerCount } = gameState;

        const strength = community.length >= 3
            ? HandEvaluator.postflopStrength(this.holeCards, community, gameType)
            : HandEvaluator.preflopStrength(this.holeCards, gameType);

        // Calculate position tightness (early = tighter, late = looser)
        const isEarlyPosition = position && position <= 2;
        const isLatePosition = position && position >= playerCount - 2;
        const positionMultiplier = isEarlyPosition ? 0.92 : (isLatePosition ? 1.08 : 1.0);

        // Calculate board texture (wet = many draws possible, dry = fewer draws)
        const boardTexture = community.length >= 3 ? this._calculateBoardTexture(community) : 0.5;

        switch (this.difficulty) {
            case 'beginner':   return this._beginnerDecide(strength, callAmount, pot, bigBlind, positionMultiplier);
            case 'intermediate': return this._intermediateDecide(strength, callAmount, pot, bigBlind, boardTexture, positionMultiplier);
            case 'expert':     return this._expertDecide(strength, callAmount, pot, bigBlind, round, positionMultiplier, boardTexture);
            default:           return { action: 'call', amount: callAmount };
        }
    }

    _calculateBoardTexture(community) {
        // Analyze board for draws and connectivity
        if (!community || community.length < 3) return 0.5;

        try {
            // Card objects have .value (number) and .suit (string like '♠')
            const values = community.map(c => c.value);
            const suits = community.map(c => c.suit);

            // Check for flush draw potential
            const suitCounts = {};
            suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
            const maxSuit = Math.max(...Object.values(suitCounts));
            const flushDrawPotential = maxSuit >= 3 ? 0.4 : 0;

            // Check for straight draw potential (connected board)
            const sorted = [...new Set(values)].sort((a, b) => a - b);
            let maxRun = 1, run = 1;
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i] - sorted[i - 1] <= 2) { run++; maxRun = Math.max(maxRun, run); }
                else run = 1;
            }
            const straightDrawPotential = maxRun >= 3 ? 0.3 : 0.1;

            // Check for paired board
            const hasPair = values.length !== new Set(values).size;
            const pairedReduction = hasPair ? -0.1 : 0;

            return Utils.clamp(flushDrawPotential + straightDrawPotential + pairedReduction, 0, 1);
        } catch (e) {
            return 0.5; // fallback
        }
    }

    _beginnerDecide(strength, callAmount, pot, bigBlind, positionMultiplier) {
        const r = Math.random();
        const loose = 1.15 * (1 + this.personalityBias);
        const s = Math.min(0.98, strength * loose * positionMultiplier);

        // Varying bet sizes instead of always the same multiplier
        const betSizeVariation = [1.5, 2, 2.5, 3][Math.floor(Math.random() * 4)];

        if (callAmount === 0) {
            if (r < 0.78) return { action: 'check', amount: 0 };
            return { action: 'raise', amount: Math.floor(bigBlind * betSizeVariation) };
        }

        if (s < 0.22 && r < 0.42) return { action: 'fold', amount: 0 };
        if (s > 0.68 && r < 0.28) {
            const raiseAmount = Math.min(callAmount * betSizeVariation + bigBlind, this.chips);
            return { action: 'raise', amount: Math.floor(raiseAmount) };
        }
        return { action: 'call', amount: Math.min(callAmount, this.chips) };
    }

    _intermediateDecide(strength, callAmount, pot, bigBlind, boardTexture, positionMultiplier) {
        const r = Math.random();
        const potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;
        const tight = 1.08 * (1 + this.personalityBias * 0.5);
        const s = strength * tight * positionMultiplier;

        // Adjust strategy based on board texture
        const boardAdjustment = boardTexture > 0.5 ? 1.05 : 0.98;
        const adjustedStrength = s * boardAdjustment;

        // Varying bet sizes (0.5x to 0.8x pot)
        const betSizeVariation = [0.5, 0.62, 0.75, 0.8][Math.floor(Math.random() * 4)];

        if (callAmount === 0) {
            if (adjustedStrength < 0.38) return { action: 'check', amount: 0 };
            if (r < 0.48) return { action: 'check', amount: 0 };
            const betSize = Math.floor(pot * betSizeVariation);
            return { action: 'raise', amount: Math.min(betSize, this.chips) };
        }

        if (adjustedStrength < potOdds * 1.45 && r < 0.62) return { action: 'fold', amount: 0 };

        if (adjustedStrength > 0.72 && r < 0.52) {
            const raiseSize = Math.floor(pot * betSizeVariation);
            const raise = Math.min(callAmount + raiseSize, this.chips);
            return { action: 'raise', amount: raise };
        }

        if (adjustedStrength < 0.28 && r < 0.52) return { action: 'fold', amount: 0 };
        return { action: 'call', amount: Math.min(callAmount, this.chips) };
    }

    _expertDecide(strength, callAmount, pot, bigBlind, round, positionMultiplier, boardTexture) {
        const r = Math.random();
        const potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;
        const sharp = 1.05 * (1 + this.personalityBias * 0.3);
        const s = strength * sharp * positionMultiplier;

        // Board texture affects bluff frequency and aggression
        const bluffChance = 0.16 + (boardTexture > 0.5 ? 0.04 : -0.02); // More bluffs on wet boards
        const boardAdjustment = boardTexture > 0.5 ? 1.03 : 0.97;
        const adjustedStrength = s * boardAdjustment;

        // Varying bet sizes (0.4x to 1.0x pot)
        const betSizeOptions = [0.4, 0.5, 0.65, 0.78, 0.9];
        const betSizeVariation = betSizeOptions[Math.floor(Math.random() * betSizeOptions.length)];

        // Preflop aggression: tighter in early, looser in late position
        const isPreflopAggressive = positionMultiplier > 1.0 && callAmount === 0;

        // Slow-play for expert: check strong hands occasionally to trap
        const slowPlayChance = adjustedStrength > 0.85 && callAmount > 0 && r < 0.12;

        // Bluff on weak hands when position is good and board is dry
        if (adjustedStrength < 0.22 && r < bluffChance && callAmount === 0) {
            return { action: 'raise', amount: Math.min(Math.floor(pot * betSizeVariation), this.chips) };
        }

        if (callAmount === 0) {
            if (adjustedStrength < 0.38 && !isPreflopAggressive) return { action: 'check', amount: 0 };
            const betSize = Math.floor(pot * (0.48 + adjustedStrength * 0.52));
            return { action: 'raise', amount: Math.min(betSize, this.chips) };
        }

        // Fold marginal hands on bad odds
        if (adjustedStrength < potOdds * 0.95 && r < 0.82) return { action: 'fold', amount: 0 };
        if (adjustedStrength < 0.32 && r < 0.62) return { action: 'fold', amount: 0 };

        // Strong hands: consider slow-playing or raising
        if (adjustedStrength > 0.78) {
            // Slow-play occasionally
            if (slowPlayChance) {
                return { action: 'call', amount: Math.min(callAmount, this.chips) };
            }
            if (r < 0.58) {
                const raiseSize = Math.floor(pot * (0.4 + adjustedStrength * 0.6));
                const raise = Math.min(callAmount + raiseSize, this.chips);
                return { action: 'raise', amount: raise };
            }
        }

        return { action: 'call', amount: Math.min(callAmount, this.chips) };
    }
}

// AI seat names pool
AIPlayer.NAMES = [
    'Carlos', 'Mei Lin', 'Viktor', 'Sophia', 'Remy',
    'Nadia', 'Dante', 'Yuki', 'Marco', 'Elena',
    'Ash', 'Felix', 'Zara', 'Bruno', 'Iris'
];

AIPlayer.pickNames = (n) => {
    const pool = [...AIPlayer.NAMES];
    const picked = [];
    for (let i = 0; i < n; i++) {
        const idx = Utils.randInt(0, pool.length - 1);
        picked.push(pool.splice(idx, 1)[0]);
    }
    return picked;
};
