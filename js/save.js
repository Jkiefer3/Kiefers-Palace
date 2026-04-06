'use strict';

/**
 * Single localStorage blob: chips, wardrobe, achievements, settings, daily goals.
 */
const KieferSave = {
    KEY: 'kp_palace_v2',

    data: {
        chips: C.STARTING_CHIPS,
        unlocked: [0],
        equipped: 0,
        achievements: {},
        dailyDate: '',
        dailyHands: 0,
        handsPlayedTotal: 0,
        mute: false,
        lastDailyBonus: '',   // ISO date string of last daily bonus claim
        lastSpinTime: 0,      // timestamp of last spin (4-hour cooldown)
        cardBack: 'classic',  // active card back id
        unlockedBacks: ['classic'],
        unlockedVIP: [],      // array of VIP table IDs unlocked
        // All-time stats
        stats: {
            totalWon: 0,
            totalLost: 0,
            sessionsPlayed: 0,
            biggestWin: 0,
            biggestLoss: 0,
            pokerWon: 0, pokerLost: 0, pokerSessions: 0,
            bjWon: 0, bjLost: 0, bjSessions: 0,
            solWon: 0, solLost: 0, solSessions: 0,
            peakChips: C.STARTING_CHIPS
        }
    },

    load() {
        try {
            const raw = localStorage.getItem(this.KEY);
            if (raw) {
                const d = JSON.parse(raw);
                if (d && typeof d === 'object') {
                    if (typeof d.chips === 'number' && d.chips >= 0) this.data.chips = d.chips;
                    if (Array.isArray(d.unlocked)) this.data.unlocked = d.unlocked;
                    if (typeof d.equipped === 'number') this.data.equipped = d.equipped;
                    if (d.achievements && typeof d.achievements === 'object') {
                        this.data.achievements = { ...this.data.achievements, ...d.achievements };
                    }
                    if (typeof d.dailyDate === 'string') this.data.dailyDate = d.dailyDate;
                    if (typeof d.dailyHands === 'number') this.data.dailyHands = d.dailyHands;
                    if (typeof d.handsPlayedTotal === 'number') this.data.handsPlayedTotal = d.handsPlayedTotal;
                    if (typeof d.mute === 'boolean') this.data.mute = d.mute;
                    if (typeof d.lastDailyBonus === 'string') this.data.lastDailyBonus = d.lastDailyBonus;
                    if (typeof d.lastSpinTime === 'number') this.data.lastSpinTime = d.lastSpinTime;
                    if (typeof d.cardBack === 'string') this.data.cardBack = d.cardBack;
                    if (Array.isArray(d.unlockedBacks)) this.data.unlockedBacks = d.unlockedBacks;
                    if (Array.isArray(d.unlockedVIP)) this.data.unlockedVIP = d.unlockedVIP;
                    if (d.stats && typeof d.stats === 'object') {
                        this.data.stats = { ...this.data.stats, ...d.stats };
                    }
                }
            }
            const legacy = localStorage.getItem('kp_palace_data');
            if (legacy && !raw) {
                const d = JSON.parse(legacy);
                if (d && Array.isArray(d.unlocked)) {
                    this.data.unlocked = d.unlocked;
                    this.data.equipped = typeof d.equipped === 'number' ? d.equipped : 0;
                }
                this.persist();
            }
        } catch (e) { /* ignore */ }
        return this.data;
    },

    persist() {
        try {
            localStorage.setItem(this.KEY, JSON.stringify(this.data));
        } catch (e) { /* ignore */ }
    },

    setChips(n) {
        this.data.chips = Math.max(0, Math.floor(n));
        this.persist();
    },

    getChips() {
        return this.data.chips;
    },

    /** @param {string} id */
    unlockAchievement(id) {
        if (this.data.achievements[id]) return false;
        this.data.achievements[id] = { at: Date.now() };
        this.persist();
        return true;
    },

    /** Daily hand count for lightweight goals */
    noteHandPlayed() {
        const today = new Date().toISOString().slice(0, 10);
        if (this.data.dailyDate !== today) {
            this.data.dailyDate = today;
            this.data.dailyHands = 0;
        }
        this.data.dailyHands++;
        this.persist();
    },

    setMute(m) {
        this.data.mute = !!m;
        this.persist();
    },

    isMuted() {
        return !!this.data.mute;
    },

    canClaimDailyBonus() {
        const today = new Date().toISOString().slice(0, 10);
        return this.data.lastDailyBonus !== today;
    },

    claimDailyBonus(amount) {
        const today = new Date().toISOString().slice(0, 10);
        if (this.data.lastDailyBonus === today) return false;
        this.data.lastDailyBonus = today;
        this.data.chips += amount;
        this.persist();
        return true;
    },

    canSpin() {
        const cooldown = 4 * 60 * 60 * 1000; // 4 hours
        return Date.now() - (this.data.lastSpinTime || 0) >= cooldown;
    },

    getSpinCooldownRemaining() {
        const cooldown = 4 * 60 * 60 * 1000;
        const elapsed = Date.now() - (this.data.lastSpinTime || 0);
        return Math.max(0, cooldown - elapsed);
    },

    recordSpin() {
        this.data.lastSpinTime = Date.now();
        this.persist();
    },

    buyCardBack(id, cost) {
        if (this.data.unlockedBacks.includes(id)) return false;
        if (this.data.chips < cost) return false;
        this.data.chips -= cost;
        this.data.unlockedBacks.push(id);
        this.persist();
        return true;
    },

    setCardBack(id) {
        this.data.cardBack = id;
        this.persist();
    },

    getCardBack() {
        return this.data.cardBack || 'classic';
    },

    isCardBackUnlocked(id) {
        return this.data.unlockedBacks.includes(id);
    },

    buyVIPTable(id, cost) {
        if (this.data.unlockedVIP.includes(id)) return false;
        if (this.data.chips < cost) return false;
        this.data.chips -= cost;
        this.data.unlockedVIP.push(id);
        this.persist();
        return true;
    },

    isVIPUnlocked(id) {
        return this.data.unlockedVIP.includes(id);
    },

    /**
     * Record a table session when leaving. net = chips out - chips in.
     * @param {'holdem'|'blackjack'|'solitaire'} gameType
     * @param {number} net  positive = profit, negative = loss
     */
    recordSession(gameType, net) {
        const s = this.data.stats;
        s.sessionsPlayed++;
        if (net >= 0) {
            s.totalWon += net;
            if (net > s.biggestWin) s.biggestWin = net;
        } else {
            s.totalLost += Math.abs(net);
            if (Math.abs(net) > s.biggestLoss) s.biggestLoss = Math.abs(net);
        }
        if (gameType === 'holdem') {
            s.pokerSessions++;
            if (net >= 0) s.pokerWon += net; else s.pokerLost += Math.abs(net);
        } else if (gameType === 'blackjack') {
            s.bjSessions++;
            if (net >= 0) s.bjWon += net; else s.bjLost += Math.abs(net);
        } else if (gameType === 'solitaire') {
            s.solSessions++;
            if (net >= 0) s.solWon += net; else s.solLost += Math.abs(net);
        }
        // Track peak chips
        if (this.data.chips > s.peakChips) s.peakChips = this.data.chips;
        this.persist();
    },

    getStats() {
        const s = this.data.stats;
        return {
            ...s,
            netProfit: s.totalWon - s.totalLost,
            pokerNet: s.pokerWon - s.pokerLost,
            bjNet: s.bjWon - s.bjLost,
            solNet: s.solWon - s.solLost
        };
    },

    /** Called after each completed hand (showdown or fold win). */
    onHandEnd(won, amount) {
        this.noteHandPlayed();
        this.data.handsPlayedTotal = (this.data.handsPlayedTotal || 0) + 1;
        let anyNew = false;
        if (won && !this.data.achievements.first_win && this.unlockAchievement('first_win')) anyNew = true;
        if (this.data.handsPlayedTotal >= 10 && !this.data.achievements.hands_10 && this.unlockAchievement('hands_10')) anyNew = true;
        if (this.data.handsPlayedTotal >= 100 && !this.data.achievements.hands_100 && this.unlockAchievement('hands_100')) anyNew = true;
        if (amount >= 500 && won && !this.data.achievements.big_pot && this.unlockAchievement('big_pot')) anyNew = true;
        if (this.data.dailyHands >= 5 && !this.data.achievements.daily_5 && this.unlockAchievement('daily_5')) anyNew = true;
        this.persist();
        return anyNew;
    }
};

KieferSave.load();
