// stats-manager.js

import { doc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';

/**
 * Met à jour les statistiques utilisateur dans Firestore.
 * @param {string} userId - L'ID de l'utilisateur à mettre à jour.
 * @param {Object} statsUpdate - Objet contenant les champs à mettre à jour.
 */
export async function updateUserStats(userId, statsUpdate) {
  if (!userId || !statsUpdate || typeof statsUpdate !== 'object') {
    console.warn('updateUserStats appelé avec des paramètres invalides.');
    return;
  }

  const userRef = doc(db, "users", userId);

  try {
    await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");

      const currentStats = userDoc.data().stats || {};
      const updates = {};

      // Incrémentation des compteurs
      if (typeof statsUpdate.boostersOpened === 'number' && statsUpdate.boostersOpened > 0) {
        updates['stats.boostersOpened'] = increment(statsUpdate.boostersOpened);
      }
      if (typeof statsUpdate.cardsSoldConsole === 'number' && statsUpdate.cardsSoldConsole > 0) {
        updates['stats.cardsSoldConsole'] = increment(statsUpdate.cardsSoldConsole);
      }
      if (typeof statsUpdate.cardsSoldMarket === 'number' && statsUpdate.cardsSoldMarket > 0) {
        updates['stats.cardsSoldMarket'] = increment(statsUpdate.cardsSoldMarket);
      }
      if (typeof statsUpdate.failedSales === 'number' && statsUpdate.failedSales > 0) {
        updates['stats.failedSales'] = increment(statsUpdate.failedSales);
      }

      // Mise à jour de la meilleure vente
      if (statsUpdate.bestSale && typeof statsUpdate.bestSale.price === 'number') {
        const currentBestSale = currentStats.bestSale || { price: 0 };
        if (statsUpdate.bestSale.price > currentBestSale.price) {
          updates['stats.bestSale'] = statsUpdate.bestSale;
        }
      }

      // Mise à jour du meilleur achat
      if (statsUpdate.bestPurchase && typeof statsUpdate.bestPurchase.price === 'number') {
        const currentBestPurchase = currentStats.bestPurchase || { price: 0 };
        if (statsUpdate.bestPurchase.price > currentBestPurchase.price) {
          updates['stats.bestPurchase'] = statsUpdate.bestPurchase;
        }
      }

      // Applique la transaction si updates non vide
      if (Object.keys(updates).length > 0) {
        transaction.update(userRef, updates);
      }
    });
  } catch (error) {
    console.error("Erreur lors de la mise à jour des statistiques utilisateur :", error);
  }
}
