// Fichier: inventory-service.js — inventaire du joueur (boosters et displays), sans interface, testable
// boosterInventory : { classic, v2, v3, legendary }  ·  displayInventory : { classic, v2, v3, legendary }
import { doc, runTransaction, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { SHOP_DISPLAYS } from './shop-config.js';
import { DAILY_BOOSTER_LIMIT, DAILY_V2_BOOSTER_LIMIT } from './booster-draws.js';
import { isBoosterProduced, mainDailyBoosterType } from './series-config.js';
import { V3_RELEASED } from './cards-v3.js';
import { econWrite } from './econ-service.js';

// Boosters gratuits du jour : compteur et booster correspondant dans l'inventaire.
// « main » = le booster principal (V1, puis V3 une fois la V1 terminée) ; « v1 » est l'ancien nom.
const DAILY_KINDS = {
    main: { counter: 'dailyBoosterOpenedCount', limit: DAILY_BOOSTER_LIMIT, boosterType: () => mainDailyBoosterType() },
    v2: { counter: 'dailyV2BoosterOpenedCount', limit: DAILY_V2_BOOSTER_LIMIT, boosterType: () => 'v2' }
};
DAILY_KINDS.v1 = DAILY_KINDS.main;

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
        econWrite(transaction, userRef, snap.data(), {
            [`displayInventory.${type}`]: -1,
            [`boosterInventory.${def.boosterType}`]: total
        });
    });
    return { boosterType: def.boosterType, count: total };
}

/**
 * Range un booster gratuit du jour dans l'inventaire au lieu de l'ouvrir tout de suite.
 * Il compte dans la limite du jour, comme s'il avait été ouvert.
 */
export async function keepDailyBooster(uid, kind) {
    const def = DAILY_KINDS[kind];
    if (!def) throw new Error("Booster inconnu.");
    const k = { ...def, boosterType: def.boosterType() };
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        if (!k.boosterType || !isBoosterProduced(k.boosterType)) throw new Error("Cette série est terminée : plus de booster gratuit.");
        if ((snap.data()[k.counter] || 0) >= k.limit) throw new Error("Plus de booster gratuit aujourd'hui. Reviens demain !");
        econWrite(transaction, userRef, snap.data(),
            { [`boosterInventory.${k.boosterType}`]: 1 },
            { [k.counter]: (snap.data()[k.counter] || 0) + 1 });
    });
    return k.boosterType;
}

/** Nouveau jour (heure de Paris) : les boosters gratuits repartent à zéro. Les règles vérifient le jour avec l'heure du serveur. */
export function resetDailyCounters(uid) {
    return updateDoc(doc(db, "users", uid), {
        dailyBoosterOpenedCount: 0,
        dailyV2BoosterOpenedCount: 0,
        dailyLastReset: serverTimestamp()
    });
}

// Booster ouvert depuis l'inventaire : type → champ de boosterInventory et message d'erreur
const OPENED_FROM_INVENTORY = {
    classic: "Pas de booster classique à ouvrir.",
    legendary: "Pas de booster légendaire à ouvrir.",
    v2: "Pas de booster V2 à ouvrir.",
    v3: "Pas de booster V3 à ouvrir.",
    v3_legendary: "Pas de booster légendaire V3 à ouvrir."
};

/**
 * Enregistre un booster ouvert : ses cartes vont dans la collection, et il est retiré de l'inventaire
 * (ou compté dans les boosters gratuits du jour : boosterType 'daily' / 'daily_v2').
 */
export async function saveOpenedBooster(uid, boosterType, drawnCards) {
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
        const currentData = userDoc.data();

        // Chaque carte obtenue, doublons compris
        const deltas = {};
        for (const card of drawnCards) {
            if (!card || !card.id) {
                console.error("Carte tirée invalide ou introuvable :", card);
                continue;
            }
            deltas[`collection.${card.id}.quantity`] = (deltas[`collection.${card.id}.quantity`] || 0) + 1;
        }
        const extra = {};

        // Boosters gratuits : seulement si leur série est encore en cours
        if ((boosterType === 'daily' && !mainDailyBoosterType()) || (boosterType === 'daily_v2' && !isBoosterProduced('v2'))) {
            throw new Error("Cette série est terminée : plus de booster gratuit.");
        }
        if (boosterType === 'daily') {
            // Vérification côté transaction : empêche de dépasser la limite (autre onglet, double clic...)
            if ((currentData.dailyBoosterOpenedCount || 0) >= DAILY_BOOSTER_LIMIT) throw new Error("Boosters quotidiens épuisés. Revenez demain !");
            extra.dailyBoosterOpenedCount = (currentData.dailyBoosterOpenedCount || 0) + 1;
        } else if (boosterType === 'daily_v2') {
            if ((currentData.dailyV2BoosterOpenedCount || 0) >= DAILY_V2_BOOSTER_LIMIT) throw new Error("Boosters V2 du jour épuisés. Revenez demain !");
            extra.dailyV2BoosterOpenedCount = (currentData.dailyV2BoosterOpenedCount || 0) + 1;
        } else if (OPENED_FROM_INVENTORY[boosterType]) {
            if ((boosterType === 'v3' || boosterType === 'v3_legendary') && !V3_RELEASED) throw new Error("La collection V3 n'est pas encore sortie.");
            if ((currentData.boosterInventory?.[boosterType] || 0) < 1) throw new Error(OPENED_FROM_INVENTORY[boosterType]);
            deltas[`boosterInventory.${boosterType}`] = -1;
        }

        econWrite(transaction, userRef, currentData, deltas, extra);
    });
}
