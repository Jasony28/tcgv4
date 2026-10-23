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
      const buyerRef = auction.highestBidderId ?
        db.collection('users').doc(auction.highestBidderId) : null;
      const buyerSnap = buyerRef ? await transaction.get(buyerRef) : null;

      // Objet de l'annonce : carte ou booster (anciennes annonces :
      // cardId et quantity à la racine). Même logique que
      // market-service.js côté site.
      const item = auction.item ||
        {type: 'card', cardId: auction.cardId,
          quantity: auction.quantity || 1};
      const itemPath = item.type === 'booster' ?
        `boosterInventory.${item.boosterType}` :
        `collection.${item.cardId}.quantity`;
      const inc = admin.firestore.FieldValue.increment;

      if (buyerSnap && buyerSnap.exists) {
        // --- CAS 1: ENCHÈRE GAGNÉE ---
        console.log(`Annonce ${doc.id} gagnée par ` +
          `${auction.highestBidderPseudo}`);
        transaction.update(buyerRef, {[itemPath]: inc(item.quantity)});
        if (sellerSnap.exists) {
          transaction.update(sellerRef,
              {coins: inc(auction.currentPrice)});
        }
      } else {
        // --- CAS 2: PERSONNE (ou échange non conclu) ---
        // L'objet revient au vendeur.
        console.log(`Annonce ${doc.id} expirée sans preneur.`);
        if (sellerSnap.exists) {
          transaction.update(sellerRef, {[itemPath]: inc(item.quantity)});
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
