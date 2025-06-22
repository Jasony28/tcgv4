// On importe les outils nécessaires de Firebase pour le backend
const {onSchedule} = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

// On initialise l'accès "administrateur" à notre base de données.
admin.initializeApp();
const db = admin.firestore();

/**
 * Cloud Function planifiée pour finaliser les enchères expirées.
 * Elle s'exécutera automatiquement toutes les 5 minutes.
 */
exports.finalizeExpiredAuctions =
onSchedule('every 5 minutes', async (event) => {
  console.log(
    'Lancement de la tâche : ' +
    'Vérification des enchères expirées...'
  );

  const now = admin.firestore.Timestamp.now();

  const query = db
    .collection('auctions')
    .where('status', '==', 'active')
    .where('endTime', '<=', now);

  const expiredAuctions = await query.get();

  // S'il n'y a aucune enchère expirée, on arrête la fonction.
  if (expiredAuctions.empty) {
    console.log('Aucune enchère à finaliser.');
    return null;
  }

  const promises = [];

  expiredAuctions.forEach((doc) => {
    const auction = doc.data();
    const auctionRef = doc.ref;

    const promise = db.runTransaction(async (transaction) => {
      const sellerRef = db.collection('users').doc(auction.sellerId);

      if (auction.highestBidderId) {
        // --- CAS 1: VENTE RÉUSSIE ---
        const bidLog =
          `Enchère ${doc.id} gagnée par ` +
          `${auction.highestBidderPseudo}`;
        console.log(bidLog);
        const buyerRef =
          db.collection('users').doc(auction.highestBidderId);

        // 1. Donner la carte au gagnant
        const buyerCardPath = `collection.${auction.cardId}.quantity`;
        transaction.update(buyerRef, {
          [buyerCardPath]: admin.firestore.FieldValue.increment(
            auction.quantity
          ),
        });

        // 2. Donner l'argent au vendeur
        transaction.update(sellerRef, {
          coins: admin.firestore.FieldValue.increment(
            auction.currentPrice
          ),
        });
      } else {
        // --- CAS 2: VENTE ÉCHOUÉE (pas d'enchérisseur) ---
        console.log(
          `Enchère ${doc.id} expirée sans enchérisseur.`
        );
        // 1. Rendre la carte au vendeur
        const sellerCardPath = `collection.${auction.cardId}.quantity`;
        transaction.update(sellerRef, {
          [sellerCardPath]: admin.firestore.FieldValue.increment(
            auction.quantity
          ),
        });
      }

      transaction.update(auctionRef, {status: 'ended'});
    });

    promises.push(promise);
  });

  // On attend que toutes les transactions soient terminées
  await Promise.all(promises);
  const logFinal =
    `${promises.length} enchère(s) ont été ` +
    'finalisée(s).';
  console.log(logFinal);

  // On indique à Firebase que la fonction a terminé son travail
  return null;
});
