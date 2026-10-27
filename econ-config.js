// Fichier: econ-config.js — garde-fou anti-triche de l'économie (mêmes chiffres que firestore.rules)
//
// Chaque écriture qu'un joueur fait sur son propre compte a une « valeur » :
//   pièces gagnées + valeur des boosters, displays et cartes gagnés − ce qu'il a perdu.
// Les gains positifs s'additionnent dans econ.used (remis à zéro chaque jour, minuit UTC) et ne peuvent pas
// dépasser DAILY_GAIN_LIMIT : un tricheur qui modifie son compte ne peut donc plus se donner des pièces
// ou des cartes à l'infini. Les achats, ventes à la console et ouvertures normales ne coûtent presque rien.
// Les affaires entre joueurs (marché, échanges) et les succès sont vérifiés à part, au chiffre près.
//
// ⚠️ Après avoir changé un chiffre ici : node scripts/gen-rules-data.mjs (recopie dans firestore.rules)
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { allCardsV3 } from './cards-v3.js';

export const DAILY_GAIN_LIMIT = 1000;
export const MAX_ECON_CARDS = 12; // cartes différentes touchées par une seule écriture

export const CARD_VALUE = { 'Commune': 1, 'Rare': 2, 'epique': 8, 'Légendaire': 100 };
export const UNKNOWN_CARD_VALUE = 100;
export const BOOSTER_VALUE = { classic: 10, v2: 13, v3: 10, legendary: 100, v3_legendary: 100 };
export const DISPLAY_VALUE = { classic: 120, v2: 130, v3: 100, legendary: 400 };

/** Jour UTC (nombre de jours depuis 1970), le même calcul que les règles */
export const econDay = (ms = Date.now()) => Math.floor(ms / 86400000);

// Toutes les cartes, y compris celles pas encore sorties
export const ECON_CARDS = [...allCards, ...allCardsV2, ...allCardsV3];
const rarityOf = new Map(ECON_CARDS.map(c => [c.id, c.rarity]));
export const cardValue = (id) => CARD_VALUE[rarityOf.get(id)] ?? UNKNOWN_CARD_VALUE;
// Clé courte de chaque rareté dans le reçu econ/{uid} (les règles vérifient chaque liste d'un coup)
export const RARITY_KEYS = { 'Commune': 'c', 'Rare': 'r', 'epique': 'e', 'Légendaire': 'l' };
export const cardRarityKey = (id) => RARITY_KEYS[rarityOf.get(id)];

/**
 * Valeur d'une écriture : deltas = { 'coins': n, 'collection.ID.quantity': n, 'boosterInventory.T': n, 'displayInventory.T': n }
 * (les autres champs sont ignorés). Renvoie { gain, cardsGain, cards } : cards = cartes touchées.
 */
export function econGain(deltas) {
    let gain = 0, cardsGain = 0;
    const cards = [];
    for (const [field, n] of Object.entries(deltas)) {
        if (!n) continue;
        if (field === 'coins') gain += n;
        else if (field.startsWith('boosterInventory.')) gain += n * (BOOSTER_VALUE[field.slice(17)] || 0);
        else if (field.startsWith('displayInventory.')) gain += n * (DISPLAY_VALUE[field.slice(17)] || 0);
        else if (field.startsWith('collection.')) {
            const id = field.slice(11, -'.quantity'.length);
            if (!cardRarityKey(id)) throw new Error(`Carte inconnue : ${id}`);
            if (!cards.includes(id)) cards.push(id);
            cardsGain += n * cardValue(id);
        }
    }
    return { gain: gain + cardsGain, cardsGain, cards };
}

/** Valeur maximale d'une récompense de succès (un booster d'une série terminée devient des pièces) */
export function achievementValue(reward = {}) {
    const coinValue = { classic: 20, v2: 30, v3: 35, legendary: 90, v3_legendary: 120 }; // BOOSTER_COIN_VALUE
    let v = reward.coins || 0;
    for (const t of Object.keys(BOOSTER_VALUE)) v += (reward[t] || 0) * Math.max(BOOSTER_VALUE[t], coinValue[t]);
    return v;
}
