'use strict';

// ─────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────
class Card {
    static RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    static SUITS = ['♠','♥','♦','♣'];
    static VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

    constructor(rank, suit) {
        this.rank = rank;
        this.suit = suit;
        this.value = Card.VALUES[rank];
        this.isRed = suit === '♥' || suit === '♦';
    }

    toString() { return this.rank + this.suit; }
}

// ─────────────────────────────────────────────
// Deck
// ─────────────────────────────────────────────
class Deck {
    constructor() {
        this.cards = [];
        for (const suit of Card.SUITS) {
            for (const rank of Card.RANKS) {
                this.cards.push(new Card(rank, suit));
            }
        }
        this.shuffle();
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Utils.randInt(0, i);
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal(n = 1) {
        const dealt = [];
        for (let i = 0; i < n; i++) {
            if (this.cards.length === 0) break;
            dealt.push(this.cards.pop());
        }
        return dealt;
    }

    dealOne() {
        return this.cards.pop() || null;
    }
}

// ─────────────────────────────────────────────
// HandEvaluator  — evaluates and compares poker hands
// ─────────────────────────────────────────────
const HandEvaluator = {
    HAND_NAMES: [
        'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
        'Straight', 'Flush', 'Full House', 'Four of a Kind',
        'Straight Flush', 'Royal Flush'
    ],

    // Evaluate a 5-card hand, return { rank, score, name, cards }
    evaluate5(cards) {
        const sorted = [...cards].sort((a, b) => b.value - a.value);
        const values = sorted.map(c => c.value);
        const suits = sorted.map(c => c.suit);

        const isFlush = suits.every(s => s === suits[0]);
        const isStraight = this._checkStraight(values);

        // Count values
        const counts = {};
        values.forEach(v => counts[v] = (counts[v] || 0) + 1);
        const groups = Object.entries(counts)
            .map(([v, c]) => ({ v: +v, c }))
            .sort((a, b) => b.c - a.c || b.v - a.v);

        let rank;
        let primary = groups.map(g => g.v); // significance order

        if (isFlush && isStraight && values[0] === 14) { rank = 9; }
        else if (isFlush && isStraight) { rank = 8; primary = this._straightOrder(values); }
        else if (groups[0].c === 4) { rank = 7; }
        else if (groups[0].c === 3 && groups[1]?.c === 2) { rank = 6; }
        else if (isFlush) { rank = 5; primary = values; }
        else if (isStraight) { rank = 4; primary = this._straightOrder(values); }
        else if (groups[0].c === 3) { rank = 3; }
        else if (groups[0].c === 2 && groups[1]?.c === 2) { rank = 2; }
        else if (groups[0].c === 2) { rank = 1; }
        else { rank = 0; primary = values; }

        const score = this._score(rank, primary);
        return { rank, score, name: this.HAND_NAMES[rank], cards: sorted };
    },

    // Best 5 from 7 cards (Texas Hold'em)
    bestOf7(sevenCards) {
        let best = null;
        const n = sevenCards.length;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                const five = sevenCards.filter((_, idx) => idx !== i && idx !== j);
                const h = this.evaluate5(five);
                if (!best || h.score > best.score) best = h;
            }
        }
        return best;
    },

    /**
     * Omaha: must use exactly 2 hole cards + 3 community cards.
     * This evaluator only considers valid 2+3 combinations (see nested loops).
     */
    bestOmaha(holeCards, community) {
        let best = null;
        // C(4,2) = 6 hole combos
        for (let i = 0; i < holeCards.length - 1; i++) {
            for (let j = i + 1; j < holeCards.length; j++) {
                const hole2 = [holeCards[i], holeCards[j]];
                // C(5,3) = 10 community combos (or fewer if < 5 cards)
                for (let a = 0; a < community.length - 2; a++) {
                    for (let b = a + 1; b < community.length - 1; b++) {
                        for (let cc = b + 1; cc < community.length; cc++) {
                            const five = [...hole2, community[a], community[b], community[cc]];
                            const h = this.evaluate5(five);
                            if (!best || h.score > best.score) best = h;
                        }
                    }
                }
            }
        }
        return best;
    },

    // Estimate hand strength 0-1 for AI / coach (pre-flop)
    preflopStrength(holeCards, gameType) {
        if (gameType === 'holdem') {
            const [a, b] = holeCards;
            const hi = Math.max(a.value, b.value);
            const lo = Math.min(a.value, b.value);
            const suited = a.suit === b.suit;
            const paired = a.value === b.value;
            const gap = hi - lo;

            if (paired) return 0.5 + (a.value - 2) / 12 * 0.5;
            if (hi === 14 && lo >= 10) return 0.85;
            if (hi >= 11 && lo >= 10) return 0.75;
            let base = (hi + lo - 4) / 24;
            if (suited) base += 0.08;
            if (gap <= 1) base += 0.05;
            return Utils.clamp(base, 0.1, 0.95);
        } else {
            // Omaha: evaluate 4 hole cards
            let score = 0;
            for (let i = 0; i < holeCards.length - 1; i++) {
                for (let j = i + 1; j < holeCards.length; j++) {
                    const s = this.preflopStrength([holeCards[i], holeCards[j]], 'holdem');
                    score = Math.max(score, s);
                }
            }
            return score;
        }
    },

    // Estimate relative hand strength post-flop (0–1) — for coach / AI heuristics
    // NOTE: Do NOT use rank/9: Straight is rank 4 → 0.44 and reads as "weak" by mistake.
    postflopStrength(holeCards, community, gameType) {
        if (community.length < 3) return this.preflopStrength(holeCards, gameType);
        let hand;
        if (gameType === 'holdem') {
            hand = this.bestOf7([...holeCards, ...community]);
        } else {
            hand = this.bestOmaha(holeCards, community);
        }
        if (!hand) return 0.3;
        const base = [
            0.2,  // High Card
            0.38, // One Pair
            0.5,  // Two Pair
            0.62, // Three of a Kind
            0.78, // Straight — strong made hand
            0.84, // Flush
            0.9,  // Full House
            0.95, // Four of a Kind
            0.98, // Straight Flush
            0.99  // Royal Flush
        ];
        let s = base[Math.min(hand.rank, 9)] ?? 0.35;
        const kick = Math.min(0.03, ((hand.score % 1e10) / 1e10) * 0.03);
        s += kick;
        if (gameType === 'omaha' && hand.rank <= 4) {
            s -= 0.04;
        }
        return Utils.clamp(s, 0.05, 0.99);
    },

    // ── helpers ──────────────────────────────

    _checkStraight(values) {
        const unique = [...new Set(values)].sort((a, b) => b - a);
        if (unique.length < 5) return false;
        // Normal
        let consec = 1;
        for (let i = 1; i < unique.length; i++) {
            if (unique[i - 1] - unique[i] === 1) consec++;
            else consec = 1;
            if (consec === 5) return true;
        }
        // Wheel: A-2-3-4-5
        if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) return true;
        return false;
    },

    _straightOrder(values) {
        // Return highest card of the straight
        const unique = [...new Set(values)].sort((a, b) => b - a);
        for (let i = 0; i <= unique.length - 5; i++) {
            if (unique[i] - unique[i + 4] === 4) return [unique[i]];
        }
        // Wheel
        return [5];
    },

    _score(rank, primary) {
        let s = rank * 1e10;
        primary.slice(0, 5).forEach((v, i) => {
            s += v * Math.pow(15, 4 - i);
        });
        return s;
    }
};
