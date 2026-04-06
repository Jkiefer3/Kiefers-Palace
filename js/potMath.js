'use strict';

/**
 * Side-pot distribution for no-limit hold'em style contribution stacks.
 * @param {Map<number, number>|Object} investments seatIndex -> total chips put in pot this hand
 * @param {Array<{ seat: number, folded: boolean, handScore: number }>} players
 * @returns {Map<number, number>} seatIndex -> amount won
 */
function distributeSidePots(investments, players) {
    const invMap = investments instanceof Map ? investments : new Map(Object.entries(investments).map(([k, v]) => [+k, v]));
    const payouts = new Map();
    const seats = [...invMap.keys()];
    seats.forEach(s => payouts.set(s, 0));

    const levels = [...new Set(seats.map(s => invMap.get(s) || 0).filter(x => x > 0))].sort((a, b) => a - b);
    let prev = 0;

    for (const level of levels) {
        const delta = level - prev;
        const contributors = seats.filter(s => (invMap.get(s) || 0) >= level).length;
        const potSlice = delta * contributors;
        const eligible = players.filter(p => !p.folded && (invMap.get(p.seat) || 0) >= level);
        if (potSlice <= 0 || eligible.length === 0) {
            prev = level;
            continue;
        }
        const best = Math.max(...eligible.map(p => p.handScore));
        const winners = eligible.filter(p => p.handScore === best);
        const share = Math.floor(potSlice / winners.length);
        let rem = potSlice - share * winners.length;
        winners.forEach((w, i) => {
            const extra = i < rem ? 1 : 0;
            payouts.set(w.seat, (payouts.get(w.seat) || 0) + share + extra);
        });
        prev = level;
    }

    return payouts;
}

if (typeof window !== 'undefined') {
    window.distributeSidePots = distributeSidePots;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { distributeSidePots };
}
