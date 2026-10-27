// Fichier: achievements.js — réclamation des récompenses de succès
import { doc, runTransaction, Timestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { ACHIEVEMENTS } from './achievements-config.js';
import { convertEndedBoosters } from './series-config.js';
import { achievementValue } from './econ-config.js';
import { econWrite } from './econ-service.js';

/**
 * Donne la récompense d'un succès. Tout est revérifié dans la transaction
 * (cartes toujours possédées, pas déjà réclamé) pour éviter double récompense / triche.
 * @returns {Promise<object>} le succès réclamé
 */
export async function claimAchievement(uid, achievementId) {
    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievement) throw new Error("Succès inconnu.");
    const userRef = doc(db, "users", uid);

    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        const data = snap.data();
        if (data.achievements?.[achievementId]?.claimed) throw new Error("Succès déjà réclamé.");
        const missing = achievement.cardIds.filter(id => !(data.collection?.[id]?.quantity > 0));
        if (missing.length) throw new Error(`Il te manque encore ${missing.length} carte(s).`);

        const r = achievement.reward;
        // Boosters d'une série terminée : remplacés par leur valeur en pièces
        const { boosters, coins } = convertEndedBoosters({ classic: r.classic, v2: r.v2, v3: r.v3, legendary: r.legendary });
        const deltas = { coins: (r.coins || 0) + coins };
        for (const [type, n] of Object.entries(boosters)) deltas[`boosterInventory.${type}`] = n;
        // La récompense ne compte pas dans le plafond du jour : les règles revérifient les cartes du succès
        econWrite(transaction, userRef, data, deltas,
            { [`achievements.${achievementId}`]: { claimed: true, at: Timestamp.now() }, 'econ.claim': achievementId }, achievementValue(r));
    });
    return achievement;
}
