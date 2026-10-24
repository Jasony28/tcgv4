// Fichier: achievements.js — réclamation des récompenses de succès
import { doc, runTransaction, increment, Timestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { ACHIEVEMENTS } from './achievements-config.js';
import { convertEndedBoosters } from './series-config.js';

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
        const updates = { [`achievements.${achievementId}`]: { claimed: true, at: Timestamp.now() } };
        // Boosters d'une série terminée : remplacés par leur valeur en pièces
        const { boosters, coins } = convertEndedBoosters({ classic: r.classic, v2: r.v2, v3: r.v3, legendary: r.legendary });
        if ((r.coins || 0) + coins) updates.coins = increment((r.coins || 0) + coins);
        for (const [type, n] of Object.entries(boosters)) updates[`boosterInventory.${type}`] = increment(n);
        transaction.update(userRef, updates);
    });
    return achievement;
}
