// Fichier: shop-config.js — réglages de la boutique (modifie les chiffres ici pour équilibrer)
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { createSeededRandom } from './daily-utils.js';

// Toutes les cartes (V1 + V2) : la boutique est le seul moyen d'obtenir les cartes V2 hors échanges
export const SHOP_CARD_POOL = [...allCards, ...allCardsV2];

export const SHOP_SLOTS = 3;

// Chance d'apparition de chaque rareté, PAR emplacement (total = 100).
// Avec 5 % par emplacement, une légendaire apparaît environ 1 jour sur 7.
export const SHOP_RARITY_ODDS = [
    { rarity: 'Commune', label: 'Commune', chance: 50 },
    { rarity: 'Rare', label: 'Rare', chance: 30 },
    { rarity: 'epique', label: 'Épique', chance: 15 },
    { rarity: 'Légendaire', label: 'Légendaire', chance: 5 }
];

// Jamais plus d'une légendaire dans la boutique du jour
export const MAX_LEGENDARY_PER_DAY = 1;

export const SHOP_CARD_PRICES = { 'Commune': 10, 'Rare': 25, 'epique': 60, 'Légendaire': 200 };

export const SHOP_BOOSTERS = {
    classic: { name: 'Booster Classique', price: 20, dailyLimit: 3, description: '3 communes, 1 rare, 1 carte bonus' },
    v2: { name: 'Booster V2', price: 30, dailyLimit: 2, description: 'Cartes de la collection V2' },
    legendary: { name: 'Booster Légendaire', price: 90, dailyLimit: 1, description: '1 légendaire garantie' }
};

export const DAILY_GIFT_COINS = 5;

export const RARITY_LABELS = { 'Commune': 'Commune', 'Rare': 'Rare', 'epique': 'Épique', 'Légendaire': 'Légendaire' };

function rollRarity(rand, allowLegendary) {
    const odds = allowLegendary ? SHOP_RARITY_ODDS : SHOP_RARITY_ODDS.filter(o => o.rarity !== 'Légendaire');
    const total = odds.reduce((sum, o) => sum + o.chance, 0);
    let roll = rand() * total;
    for (const o of odds) {
        if ((roll -= o.chance) < 0) return o.rarity;
    }
    return odds[0].rarity;
}

/**
 * Les cartes de la boutique d'un jour donné. Même jour = même boutique pour tout le monde.
 * @param {string} dayKey - ex: "2026-10-23" (voir getDayKey)
 * @returns {{slot:number, card:object, price:number}[]}
 */
export function getDailyShop(dayKey) {
    const rand = createSeededRandom(`shop-${dayKey}`);
    const offers = [];
    const usedIds = new Set();
    let legendaries = 0;

    for (let slot = 0; slot < SHOP_SLOTS; slot++) {
        const rarity = rollRarity(rand, legendaries < MAX_LEGENDARY_PER_DAY);
        if (rarity === 'Légendaire') legendaries++;
        const candidates = SHOP_CARD_POOL.filter(c => c.rarity === rarity && !usedIds.has(c.id));
        const card = candidates[Math.floor(rand() * candidates.length)];
        usedIds.add(card.id);
        offers.push({ slot, card, price: SHOP_CARD_PRICES[rarity] });
    }
    // Tri par rareté croissante pour un affichage plus lisible
    const order = ['Commune', 'Rare', 'epique', 'Légendaire'];
    offers.sort((a, b) => order.indexOf(a.card.rarity) - order.indexOf(b.card.rarity));
    return offers;
}
