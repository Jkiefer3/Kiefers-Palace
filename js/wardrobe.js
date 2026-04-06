'use strict';

const WardrobeSystem = (function () {
    const OUTFITS = [
        { id: 0, name: 'Classic', price: 0,
            skinColor: '#f5d0ba', hairColor: 'hsl(28, 48%, 18%)', shirtColor: 'hsl(220, 45%, 38%)', pantsColor: 'hsl(222, 22%, 28%)' },
        { id: 1, name: 'Ruby Night', price: 120,
            skinColor: '#e8b89a', hairColor: 'hsl(340, 55%, 22%)', shirtColor: 'hsl(350, 58%, 36%)', pantsColor: 'hsl(350, 30%, 18%)' },
        { id: 2, name: 'Emerald Room', price: 180,
            skinColor: '#d4a574', hairColor: 'hsl(88, 40%, 22%)', shirtColor: 'hsl(145, 42%, 32%)', pantsColor: 'hsl(145, 28%, 20%)' },
        { id: 3, name: 'Desert Sands', price: 220,
            skinColor: '#c68642', hairColor: 'hsl(40, 50%, 24%)', shirtColor: 'hsl(38, 55%, 42%)', pantsColor: 'hsl(28, 35%, 26%)' },
        { id: 4, name: 'Royal Violet', price: 280,
            skinColor: '#f5d0ba', hairColor: 'hsl(265, 45%, 20%)', shirtColor: 'hsl(265, 48%, 36%)', pantsColor: 'hsl(265, 35%, 22%)' },
        { id: 5, name: 'Azure Coast', price: 350,
            skinColor: '#e8b89a', hairColor: 'hsl(200, 38%, 22%)', shirtColor: 'hsl(205, 62%, 38%)', pantsColor: 'hsl(215, 40%, 24%)' },
        { id: 6, name: 'Obsidian', price: 420,
            skinColor: '#d4a574', hairColor: 'hsl(0, 0%, 12%)', shirtColor: 'hsl(220, 14%, 28%)', pantsColor: 'hsl(220, 10%, 16%)' },
        { id: 7, name: 'Golden Ace', price: 500,
            skinColor: '#f5d0ba', hairColor: 'hsl(45, 70%, 28%)', shirtColor: 'hsl(48, 65%, 38%)', pantsColor: 'hsl(40, 45%, 22%)' }
    ];

    function _syncFromSave() {
        if (typeof KieferSave === 'undefined') return;
        if (!Array.isArray(KieferSave.data.unlocked) || KieferSave.data.unlocked.length === 0) {
            KieferSave.data.unlocked = [0];
        }
    }

    return {
        OUTFITS,

        isUnlocked(id) {
            _syncFromSave();
            return KieferSave.data.unlocked.includes(id);
        },

        getEquipped() {
            _syncFromSave();
            return KieferSave.data.equipped;
        },

        getEquippedOutfit() {
            const o = OUTFITS.find(x => x.id === KieferSave.data.equipped);
            return o || OUTFITS[0];
        },

        /** @returns {boolean} true if purchase succeeded */
        buy(id, game) {
            if (this.isUnlocked(id)) return false;
            const outfit = OUTFITS.find(o => o.id === id);
            if (!outfit || !game || typeof game.playerChips !== 'number') return false;
            if (game.playerChips < outfit.price) return false;
            game.playerChips -= outfit.price;
            KieferSave.data.unlocked.push(id);
            KieferSave.data.unlocked.sort((a, b) => a - b);
            KieferSave.setChips(game.playerChips);
            return true;
        },

        equip(id) {
            if (!this.isUnlocked(id)) return false;
            KieferSave.data.equipped = id;
            KieferSave.persist();
            return true;
        },

        outfitById(id) {
            return OUTFITS.find(o => o.id === id) || null;
        }
    };
})();
