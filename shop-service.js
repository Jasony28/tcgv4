// Fichier: shop-service.js — logique de la boutique (sans interface, testable)
// Cartes du jour, boosters (avec l'offre du jour), displays, packs spéciaux, calendrier de cadeaux.
import { doc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { getDayKey, getWeekKey, previousDayKey, isWeekend } from './daily-utils.js';
import {
    getDailyShop, SHOP_BOOSTERS, SHOP_DISPLAYS, SHOP_PACKS, GIFT_CALENDAR,
    boosterPriceToday, rollMysteryPack, MYSTERY_TABLE
} from './shop-config.js';
import { isBoosterProduced, convertEndedBoosters } from './series-config.js';

const ENDED = "Cette série est terminée : plus aucun booster n'est produit.";

/** Achats du jour du joueur (remis à zéro automatiquement chaque jour). */
export function getShopState(data, day = getDayKey()) {
    const s = (data?.shop && data.shop.day === day) ? data.shop : {};
    const count = (src, keys) => Object.fromEntries(keys.map(k => [k, src?.[k] || 0]));
    return {
        day,
        bought: s.bought || {},
        boosters: count(s.boosters, Object.keys(SHOP_BOOSTERS)),
        displays: count(s.displays, Object.keys(SHOP_DISPLAYS)),
        packs: count(s.packs, Object.keys(SHOP_PACKS))
    };
}

/**
 * Où en est le calendrier de cadeaux.
 * @returns {{claimedToday:boolean, day:number, reward:object}} day = jour 1 à 7 du cadeau (à prendre ou pris aujourd'hui)
 */
export function getGiftStatus(data, today = getDayKey()) {
    const cal = data?.giftCalendar || {};
    if (cal.lastDay === today) return { claimedToday: true, day: cal.day, reward: GIFT_CALENDAR[cal.day - 1] };
    const day = (cal.lastDay === previousDayKey(today)) ? (cal.day % GIFT_CALENDAR.length) + 1 : 1;
    return { claimedToday: false, day, reward: GIFT_CALENDAR[day - 1] };
}

/** Le pack peut-il être acheté maintenant ? */
export function packAvailability(data, packId, now = new Date()) {
    const pack = SHOP_PACKS[packId];
    if (!pack) return { available: false, reason: 'Pack inconnu' };
    // Un pack qui contient un booster d'une série terminée n'est plus vendu
    const types = packId === 'mystery'
        ? MYSTERY_TABLE.flatMap(e => Object.keys(e.contents))
        : Object.keys(pack.contents || {});
    if (types.some(t => !isBoosterProduced(t, getDayKey(now)))) return { available: false, reason: 'Série terminée' };
    if (pack.limit === 'once' && data?.packsBought?.[packId]) return { available: false, reason: 'Déjà acheté' };
    if (pack.limit === 'daily' && getShopState(data, getDayKey(now)).packs[packId] >= 1) return { available: false, reason: 'Revient demain' };
    if (pack.limit === 'weekend') {
        if (!isWeekend(now)) return { available: false, reason: 'Samedi et dimanche' };
        if (data?.packsBought?.[packId] === getWeekKey(now)) return { available: false, reason: 'Déjà acheté ce week-end' };
    }
    return { available: true };
}

// Transaction commune : relit le joueur et son état boutique, applique la modification
async function shopTransaction(uid, mutate) {
    const userRef = doc(db, "users", uid);
    let result;
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        const data = snap.data();
        const state = getShopState(data, getDayKey());
        const out = mutate(data, state) || {};
        result = out.result;
        const updates = out.updates || {};
        updates.shop = state;
        transaction.update(userRef, updates);
    });
    return result;
}

const pay = (data, price) => {
    if ((data.coins || 0) < price) throw new Error("Pas assez de pièces !");
    return { coins: increment(-price) };
};
const addBoosters = (updates, boosters) => {
    for (const [type, n] of Object.entries(boosters || {})) {
        if (n > 0) updates[`boosterInventory.${type}`] = increment(n);
    }
    return updates;
};

export function buyCard(uid, offer) {
    const { card, price } = offer;
    return shopTransaction(uid, (data, state) => {
        if (!getDailyShop(getDayKey()).some(o => o.card.id === card.id)) throw new Error("La boutique vient de changer !");
        if (state.bought[card.id]) throw new Error("Tu as déjà acheté cette carte aujourd'hui.");
        state.bought[card.id] = true;
        return { updates: { ...pay(data, price), [`collection.${card.id}.quantity`]: increment(1) } };
    });
}

export function buyBooster(uid, type) {
    const def = SHOP_BOOSTERS[type];
    return shopTransaction(uid, (data, state) => {
        if (!def) throw new Error("Booster inconnu.");
        if (!isBoosterProduced(type, getDayKey())) throw new Error(ENDED);
        if (state.boosters[type] >= def.dailyLimit) throw new Error("Limite du jour atteinte pour ce booster.");
        const price = boosterPriceToday(type, getDayKey());
        state.boosters[type]++;
        return { updates: addBoosters(pay(data, price), { [type]: 1 }), result: { price } };
    });
}

export function buyDisplay(uid, type) {
    const def = SHOP_DISPLAYS[type];
    return shopTransaction(uid, (data, state) => {
        if (!def) throw new Error("Display inconnue.");
        if (!isBoosterProduced(def.boosterType, getDayKey())) throw new Error(ENDED);
        if (state.displays[type] >= def.dailyLimit) throw new Error("Une seule par jour : reviens demain !");
        state.displays[type]++;
        return { updates: { ...pay(data, def.price), [`displayInventory.${type}`]: increment(1) } };
    });
}

/** Achète un pack. Renvoie son contenu (utile pour le Pack Mystère). */
export function buyPack(uid, packId, rand = Math.random) {
    const pack = SHOP_PACKS[packId];
    // Tirage du Pack Mystère fait avant la transaction (une transaction peut être rejouée)
    const mystery = packId === 'mystery' ? rollMysteryPack(rand) : null;
    return shopTransaction(uid, (data, state) => {
        const check = packAvailability(data, packId);
        if (!check.available) throw new Error(`${pack?.name || 'Pack'} : ${check.reason.toLowerCase()}.`);
        const contents = mystery ? mystery.contents : pack.contents;
        const updates = addBoosters(pay(data, pack.price), contents);
        if (pack.coins) updates.coins = increment(pack.coins - pack.price);
        if (pack.limit === 'daily') state.packs[packId]++;
        if (pack.limit === 'once') updates[`packsBought.${packId}`] = true;
        if (pack.limit === 'weekend') updates[`packsBought.${packId}`] = getWeekKey();
        return { updates, result: { contents, coins: pack.coins || 0, label: mystery?.label } };
    });
}

/** Récupère le cadeau du jour du calendrier. */
export function claimGift(uid) {
    return shopTransaction(uid, (data) => {
        const today = getDayKey();
        const status = getGiftStatus(data, today);
        if (status.claimedToday) throw new Error("Cadeau déjà récupéré aujourd'hui.");
        // Booster d'une série terminée : remplacé par sa valeur en pièces
        const { boosters, coins } = convertEndedBoosters(status.reward.boosters, today);
        const updates = addBoosters({ coins: increment(status.reward.coins + coins) }, boosters);
        updates.giftCalendar = { lastDay: today, day: status.day };
        return { updates, result: { ...status, reward: { coins: status.reward.coins + coins, boosters } } };
    });
}
