// Fichier: inventory-service.js — inventaire du joueur (boosters et displays), sans interface, testable
// boosterInventory : { classic, v2, v3, legendary }  ·  displayInventory : { classic, v2, v3, legendary }
import { doc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { SHOP_DISPLAYS } from './shop-config.js';
import { DAILY_BOOSTER_LIMIT, DAILY_V2_BOOSTER_LIMIT } from './booster-draws.js';
import { isBoosterProduced } from './series-config.js';

// Boosters gratuits du jour : compteur et booster correspondant dans l'inventaire
const DAILY_KINDS = {
    v1: { counter: 'dailyBoosterOpenedCount', limit: DAILY_BOOSTER_LIMIT, boosterType: 'classic' },
    v2: { counter: 'dailyV2BoosterOpenedCount', limit: DAILY_V2_BOOSTER_LIMIT, boosterType: 'v2' }
};

/** Ouvre une display : ses boosters (+ bonus) vont dans l'inventaire. Renvoie le nombre de boosters reçus. */
export async function openDisplay(uid, type) {
    const def = SHOP_DISPLAYS[type];
    if (!def) throw new Error("Display inconnue.");
    const total = def.boosters + def.bonus;
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        if ((snap.data().displayInventory?.[type] || 0) < 1) throw new Error("Tu n'as pas cette display.");
        transaction.update(userRef, {
            [`displayInventory.${type}`]: increment(-1),
            [`boosterInventory.${def.boosterType}`]: increment(total)
        });
    });
    return { boosterType: def.boosterType, count: total };
}

/**
 * Range un booster gratuit du jour dans l'inventaire au lieu de l'ouvrir tout de suite.
 * Il compte dans la limite du jour, comme s'il avait été ouvert.
 */
export async function keepDailyBooster(uid, kind) {
    const k = DAILY_KINDS[kind];
    if (!k) throw new Error("Booster inconnu.");
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        if (!isBoosterProduced(k.boosterType)) throw new Error("Cette série est terminée : plus de booster gratuit.");
        if ((snap.data()[k.counter] || 0) >= k.limit) throw new Error("Plus de booster gratuit aujourd'hui. Reviens demain !");
        transaction.update(userRef, {
            [k.counter]: increment(1),
            [`boosterInventory.${k.boosterType}`]: increment(1)
        });
    });
    return k.boosterType;
}
