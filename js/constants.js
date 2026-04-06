'use strict';

const C = {
    WIDTH: 1200,
    HEIGHT: 750,
    PLAYER_SPEED: 230,
    PLAYER_RADIUS: 18,
    STARTING_CHIPS: 1000,

    // Game states
    STATE: {
        CASINO: 'casino',
        BUYIN: 'buyin',
        PLAYING: 'playing'
    },

    // Difficulty levels
    DIFF: {
        BEGINNER: 'beginner',
        INTERMEDIATE: 'intermediate',
        EXPERT: 'expert'
    },

    // Game types
    TYPE: {
        HOLDEM: 'holdem',
        BLACKJACK: 'blackjack',
        SOLITAIRE: 'solitaire'
    },

    // Table themes
    THEMES: {
        vegas: {
            felt: '#146b3a',
            feltInner: '#0d4d28',
            wood: '#4a2510',
            trim: '#d4af37',
            label: '#f5e6a8',
            glow: 'rgba(212,175,55,0.55)',
            name: 'Vegas Classic'
        },
        monaco: {
            felt: '#0f2d26',
            feltInner: '#0a2020',
            wood: '#2a2a2a',
            trim: '#a0a0a0',
            label: '#e0e0e0',
            glow: 'rgba(160,160,160,0.35)',
            name: 'Monaco Nights'
        },
        highroller: {
            felt: '#1e0d3a',
            feltInner: '#150828',
            wood: '#1a0a2e',
            trim: '#ffd700',
            label: '#ffd700',
            glow: 'rgba(255,215,0,0.45)',
            name: 'High Roller Suite'
        },
        tropical: {
            felt: '#0d5c52',
            feltInner: '#094840',
            wood: '#6b3800',
            trim: '#ff8c00',
            label: '#ffbe5a',
            glow: 'rgba(255,140,0,0.4)',
            name: 'Tropical Paradise'
        },
        noir: {
            felt: '#0d0d20',
            feltInner: '#080814',
            wood: '#1a0808',
            trim: '#8b0000',
            label: '#cc4444',
            glow: 'rgba(139,0,0,0.4)',
            name: 'Noir Underground'
        },
        cyber: {
            felt: '#050514',
            feltInner: '#03030e',
            wood: '#050520',
            trim: '#00e5ff',
            label: '#00e5ff',
            glow: 'rgba(0,229,255,0.5)',
            name: 'Neon Cyber'
        }
    },

    // All 5 table configs
    TABLES: [
        {
            id: 'th_beg',
            x: 220, y: 230,
            type: 'holdem',
            difficulty: 'beginner',
            buyIn: 50,
            bigBlind: 2,
            smallBlind: 1,
            theme: 'vegas',
            numAI: 2,
            label: "TEXAS HOLD'EM",
            subLabel: 'Beginner · $1/$2'
        },
        {
            id: 'th_int',
            x: 600, y: 230,
            type: 'holdem',
            difficulty: 'intermediate',
            buyIn: 100,
            bigBlind: 5,
            smallBlind: 2,
            theme: 'monaco',
            numAI: 3,
            label: "TEXAS HOLD'EM",
            subLabel: 'Intermediate · $2/$5'
        },
        {
            id: 'th_exp',
            x: 980, y: 230,
            type: 'holdem',
            difficulty: 'expert',
            buyIn: 200,
            bigBlind: 10,
            smallBlind: 5,
            theme: 'highroller',
            numAI: 4,
            label: "TEXAS HOLD'EM",
            subLabel: 'Expert · $5/$10'
        },
        {
            id: 'bj_mid',
            x: 310, y: 520,
            type: 'blackjack',
            difficulty: 'intermediate',
            buyIn: 100,
            bigBlind: 0,
            smallBlind: 0,
            minBet: 5,
            maxBet: 500,
            theme: 'noir',
            numAI: 0,
            label: 'BLACKJACK',
            subLabel: 'Bet $5–$500'
        },
        {
            id: 'sol_vegas',
            x: 890, y: 520,
            type: 'solitaire',
            difficulty: 'intermediate',
            buyIn: 50,
            bigBlind: 0,
            smallBlind: 0,
            theme: 'tropical',
            numAI: 0,
            label: 'SOLITAIRE',
            subLabel: 'Vegas Style · $5 per card'
        }
    ],

    // Purchasable card backs
    CARD_BACKS: [
        { id: 'classic',   name: 'Classic Blue',     color: '#1a3a8a', pattern: 'dots',    cost: 0,    accent: '#2255bb' },
        { id: 'crimson',   name: 'Crimson Royale',   color: '#8b0000', pattern: 'diamonds', cost: 500,  accent: '#cc2222' },
        { id: 'emerald',   name: 'Emerald Edge',     color: '#0a5c36', pattern: 'stripes', cost: 750,  accent: '#1a9a5a' },
        { id: 'midnight',  name: 'Midnight Gold',    color: '#0d0d2a', pattern: 'filigree',cost: 1000, accent: '#d4af37' },
        { id: 'neon',      name: 'Neon Pulse',       color: '#0a0020', pattern: 'circuit', cost: 1500, accent: '#00e5ff' }
    ],

    // VIP tables (unlockable)
    VIP_TABLES: [
        {
            id: 'vip_holdem',
            type: 'holdem',
            difficulty: 'expert',
            buyIn: 1000,
            bigBlind: 50,
            smallBlind: 25,
            theme: 'cyber',
            numAI: 4,
            label: "VIP HOLD'EM",
            subLabel: 'High Stakes · $25/$50',
            unlockCost: 2000
        },
        {
            id: 'vip_bj',
            type: 'blackjack',
            difficulty: 'expert',
            buyIn: 500,
            bigBlind: 0,
            smallBlind: 0,
            minBet: 25,
            maxBet: 5000,
            theme: 'cyber',
            numAI: 0,
            label: 'VIP BLACKJACK',
            subLabel: 'Bet $25–$5,000',
            unlockCost: 3000
        }
    ],

    // Table drawing dimensions
    TABLE_RX: 105,   // horizontal radius
    TABLE_RY: 68,    // vertical radius
    TABLE_COLLISION: 120,
    TABLE_INTERACT: 165
};
