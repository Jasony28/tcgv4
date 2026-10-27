// Fichier: econ-service.js — écritures de l'économie (pièces, cartes, boosters, displays)
// Ces fonctions ne tournent que sur le serveur (server/worker.js) : les règles Firestore interdisent
// aux joueurs de modifier eux-mêmes leur économie.
import { increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

/**
 * Applique des mouvements de l'économie au compte, dans une transaction (ou un lot writeBatch).
 * @param {object} deltas - { 'coins': n, 'collection.ID.quantity': n, 'boosterInventory.T': n, 'displayInventory.T': n }
 * @param {object} [extra] - autres champs à écrire tels quels
 */
export function econWrite(t, userRef, userData, deltas, extra = {}) {
    const updates = { ...extra };
    for (const [field, n] of Object.entries(deltas)) if (n) updates[field] = increment(n);
    if (Object.keys(updates).length) t.update(userRef, updates);
}

/** Affaire entre joueurs (enchère, échange, don de clan) : gardée sur le compte pour l'historique */
export const dealStamp = (kind, id, extra = {}) => ({ kind, id, ...extra, at: serverTimestamp() });
