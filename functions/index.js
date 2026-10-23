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
    const auctionRef = doc.ref;

    const promise = db.runTransaction(async (transaction) => {
      // On relit l'enchère dans la transaction : un client (marche.js)
      // a peut-être déjà finalisé ou annulé l'enchère entre-temps.
      // Sans ça, le vendeur serait payé deux fois.
      const auctionSnap = await transaction.get(auctionRef);
      if (!auctionSnap.exists) return;
      const auction = auctionSnap.data();
      if (auction.status !== 'active') return;

      const sellerRef = db.collection('users').doc(auction.sellerId);
      const sellerSnap = await transaction.get(sellerRef);
      const cardPath = `collection.${auction.cardId}.quantity`;

      if (auction.highestBidderId) {
        // --- CAS 1: VENTE RÉUSSIE ---
        const bidLog =
          `Enchère ${doc.id} gagnée par ` +
          `${auction.highestBidderPseudo}`;
        console.log(bidLog);
        const buyerRef =
          db.collection('users').doc(auction.highestBidderId);
        const buyerSnap = await transaction.get(buyerRef);

        if (buyerSnap.exists) {
          // 1. Donner la carte au gagnant
          transaction.update(buyerRef, {
            [cardPath]: admin.firestore.FieldValue.increment(
              auction.quantity
            ),
          });
        }

        // 2. Donner l'argent au vendeur
        if (sellerSnap.exists) {
          transaction.update(sellerRef, {
            coins: admin.firestore.FieldValue.increment(
              auction.currentPrice
            ),
          });
        }
      } else {
        // --- CAS 2: VENTE ÉCHOUÉE (pas d'enchérisseur) ---
        console.log(
          `Enchère ${doc.id} expirée sans enchérisseur.`
        );
        // 1. Rendre la carte au vendeur
        if (sellerSnap.exists) {
          transaction.update(sellerRef, {
            [cardPath]: admin.firestore.FieldValue.increment(
              auction.quantity
            ),
          });
        }
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
