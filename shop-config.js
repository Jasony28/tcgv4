// Fichier: shop-config.js — réglages de la boutique (modifie les chiffres ici pour équilibrer)
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { allCardsV3Released, V3_RELEASED } from './cards-v3.js';
import { createSeededRandom } from './daily-utils.js';
import { isBoosterProduced, isCardProduced } from './series-config.js';

// Toutes les cartes (V1 + V2, + V3 à sa sortie) : la boutique vend aussi les cartes des nouvelles collections
export const SHOP_CARD_POOL = [...allCards, ...allCardsV2, ...allCardsV3Released];

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
    v2: { name: 'Booster V2', price: 30, dailyLimit: 2, description: 'Collection V2 · 25 % de chance de légendaire' },
    ...(V3_RELEASED ? { v3: { name: 'Booster V3', price: 35, dailyLimit: 2, description: 'Cartes de la collection V3' } } : {}),
    legendary: { name: 'Booster Légendaire', price: 90, dailyLimit: 1, description: '1 légendaire garantie' }
};

// ---------- Offre du jour : un booster en promo, différent chaque jour ----------
export const DAILY_DEAL_DISCOUNT = 0.30; // -30 %

/** Booster en promo aujourd'hui (le même pour tout le monde). */
export function getDailyDeal(dayKey) {
    const rand = createSeededRandom(`deal-${dayKey}`);
    const types = Object.keys(SHOP_BOOSTERS).filter(t => isBoosterProduced(t, dayKey));
    if (types.length === 0) return { type: null, discount: DAILY_DEAL_DISCOUNT }; // aucune série en cours
    const type = types[Math.floor(rand() * types.length)];
    return { type, discount: DAILY_DEAL_DISCOUNT };
}

/** Prix d'un booster aujourd'hui (promo de l'offre du jour comprise). */
export function boosterPriceToday(type, dayKey) {
    const base = SHOP_BOOSTERS[type].price;
    return getDailyDeal(dayKey).type === type ? Math.round(base * (1 - DAILY_DEAL_DISCOUNT)) : base;
}

// ---------- Displays : une boîte de boosters, moins chère à l'unité + des boosters bonus ----------
// Elle va dans l'inventaire (page Booster) et s'ouvre quand on veut.
export const SHOP_DISPLAYS = {
    classic: { name: 'Display Classique', boosterType: 'classic', boosters: 10, bonus: 2, price: 170, dailyLimit: 1 },
    v2: { name: 'Display V2', boosterType: 'v2', boosters: 8, bonus: 2, price: 220, dailyLimit: 1 },
    ...(V3_RELEASED ? { v3: { name: 'Display V3', boosterType: 'v3', boosters: 8, bonus: 2, price: 250, dailyLimit: 1 } } : {}),
    legendary: { name: 'Coffret Légendaire', boosterType: 'legendary', boosters: 3, bonus: 1, price: 270, dailyLimit: 1 }
};
/** Économie réalisée par rapport à l'achat des boosters à l'unité (en %). */
export function displaySaving(type) {
    const d = SHOP_DISPLAYS[type];
    const unit = SHOP_BOOSTERS[d.boosterType]?.price || 0;
    return unit ? Math.round((1 - d.price / ((d.boosters + d.bonus) * unit)) * 100) : 0;
}

// ---------- Packs spéciaux ----------
// limit : 'once' (une seule fois par compte), 'daily' (1 par jour), 'weekend' (samedi/dimanche, 1 par week-end)
export const SHOP_PACKS = {
    starter: {
        name: 'Pack Débutant', icon: '🎒', limit: 'once', price: 49,
        description: '5 Boosters V3 pour bien démarrer la collection',
        contents: { v3: 5 }
    },
    mystery: {
        name: 'Pack Mystère', icon: '❓', limit: 'daily', price: 50,
        description: '2 à 6 Boosters V3 surprise… et parfois le jackpot !'
    },
    weekend: {
        name: 'Pack du Week-end', icon: '🎉', limit: 'weekend', price: 120,
        description: '4 Boosters V3 + 30 pièces',
        contents: { v3: 4 }, coins: 30
    }
};
// Tirages possibles du Pack Mystère (chance en %)
export const MYSTERY_TABLE = [
    { chance: 50, contents: { v3: 2 }, label: 'Classique' },
    { chance: 30, contents: { v3: 3 }, label: 'Bon tirage' },
    { chance: 15, contents: { v3: 4 }, label: 'Super tirage' },
    { chance: 5, contents: { v3: 6 }, label: 'JACKPOT' }
];
export function rollMysteryPack(rand = Math.random) {
    let roll = rand() * MYSTERY_TABLE.reduce((s, e) => s + e.chance, 0);
    for (const entry of MYSTERY_TABLE) if ((roll -= entry.chance) < 0) return entry;
    return MYSTERY_TABLE[0];
}

// ---------- Cadeau du jour : calendrier de 7 jours (la série repart à zéro si on rate un jour) ----------
export const GIFT_CALENDAR = [
    { coins: 5 }, { coins: 10 }, { coins: 15 }, { coins: 20 },
    { coins: 30 }, { coins: 40 }, { coins: 60, boosters: { v3: 1 } }
];
/** Gardé pour les anciens affichages */
export const DAILY_GIFT_COINS = GIFT_CALENDAR[0].coins;

// [singulier, pluriel]
const BOOSTER_WORDS = {
    classic: ['Booster Classique', 'Boosters Classiques'],
    v2: ['Booster V2', 'Boosters V2'],
    v3: ['Booster V3', 'Boosters V3'],
    legendary: ['Booster Légendaire', 'Boosters Légendaires'],
    v3_legendary: ['Booster Légendaire V3', 'Boosters Légendaires V3']
};
export const BOOSTER_NAMES = Object.fromEntries(Object.entries(BOOSTER_WORDS).map(([t, [one]]) => [t, one]));
/** "3 Boosters Classiques, 1 Booster V2" */
export function describeBoosters(boosters) {
    return Object.entries(boosters || {}).filter(([, n]) => n > 0)
        .map(([t, n]) => `${n} ${BOOSTER_WORDS[t][n > 1 ? 1 : 0]}`).join(', ');
}

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
        // Seulement les cartes des séries en cours (une série terminée ne revient plus en boutique)
        const candidates = SHOP_CARD_POOL.filter(c => c.rarity === rarity && !usedIds.has(c.id) && isCardProduced(c, dayKey));
        if (candidates.length === 0) continue; // plus aucune carte de cette rareté en circulation
        const card = candidates[Math.floor(rand() * candidates.length)];
        usedIds.add(card.id);
        offers.push({ slot, card, price: SHOP_CARD_PRICES[rarity] });
    }
    // Tri par rareté croissante pour un affichage plus lisible
    const order = ['Commune', 'Rare', 'epique', 'Légendaire'];
    offers.sort((a, b) => order.indexOf(a.card.rarity) - order.indexOf(b.card.rarity));
    return offers;
}
