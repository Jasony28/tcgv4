// Fichier: scripts/close-logic.mjs
// Clôture des annonces expirées de l'Hôtel des Ventes, exécutée par GitHub Actions
// (remplace l'ancienne Cloud Function Firebase). Même règles que market-service.js côté site :
//  - enchère avec un enchérisseur : l'objet va au gagnant, les pièces au vendeur ;
//  - personne (ou échange non conclu) : l'objet revient au vendeur.
// Chaque annonce est relue dans sa transaction : si le site l'a déjà clôturée, on ne fait rien
// (pas de double paiement, même si les deux tournent en même temps).

// Taxe de l'Hôtel des Ventes (même valeur que MARKET_TAX_RATE dans market-service.js)
const MARKET_TAX_RATE = 0.10;
export const sellerProceeds = (price) => price - Math.ceil(price * MARKET_TAX_RATE);

const BOOSTER_NAMES = {
    classic: 'Booster Classique', v2: 'Booster V2', v3: 'Booster V3', legendary: 'Booster Légendaire'
};

export function getListingItem(listing) {
    if (listing.item) return listing.item;
    return { type: 'card', cardId: listing.cardId, quantity: listing.quantity || 1 };
}

function itemField(item) {
    return item.type === 'booster'
        ? `boosterInventory.${item.boosterType}`
        : `collection.${item.cardId}.quantity`;
}

// Met à jour "meilleure vente / meilleur achat" seulement si le prix est plus élevé
function bestUpdate(userData, key, entry) {
    const current = userData?.stats?.[key]?.price || 0;
    return entry.price > current ? { [`stats.${key}`]: entry } : {};
}

/**
 * @param {{db, FieldValue, Timestamp, log?}} deps - Firestore (firebase-admin) et ses utilitaires
 * @returns {Promise<Array<{id:string, outcome:'sold'|'returned'}>>}
 */
export async function closeExpiredListings({ db, FieldValue, Timestamp, log = console.log }) {
    const expired = await db.collection('auctions')
        .where('status', '==', 'active')
        .where('endTime', '<=', Timestamp.now())
        .get();

    const results = [];
    for (const docSnap of expired.docs) {
        try {
            const outcome = await db.runTransaction(async (t) => {
                const fresh = await t.get(docSnap.ref);
                if (!fresh.exists || fresh.data().status !== 'active') return null;
                const listing = fresh.data();
                const item = getListingItem(listing);
                const inc = (n) => FieldValue.increment(n);

                const sellerRef = db.collection('users').doc(listing.sellerId);
                const seller = await t.get(sellerRef);
                const buyerRef = listing.highestBidderId ? db.collection('users').doc(listing.highestBidderId) : null;
                const buyer = buyerRef ? await t.get(buyerRef) : null;

                let result;
                if (buyer && buyer.exists) {
                    const entry = {
                        cardId: item.type === 'card' ? item.cardId : null,
                        ...(item.type === 'booster' ? { name: BOOSTER_NAMES[item.boosterType] || 'Booster' } : {}),
                        price: listing.currentPrice
                    };
                    t.update(buyerRef, { [itemField(item)]: inc(item.quantity), ...bestUpdate(buyer.data(), 'bestPurchase', entry) });
                    if (seller.exists) {
                        t.update(sellerRef, {
                            coins: inc(sellerProceeds(listing.currentPrice)),
                            'stats.cardsSoldMarket': inc(1),
                            ...bestUpdate(seller.data(), 'bestSale', entry)
                        });
                    }
                    result = 'sold';
                } else {
                    if (seller.exists) {
                        const isAuction = (listing.type || 'auction') === 'auction';
                        t.update(sellerRef, { [itemField(item)]: inc(item.quantity), ...(isAuction ? { 'stats.failedSales': inc(1) } : {}) });
                    }
                    result = 'returned';
                }
                t.update(docSnap.ref, { status: 'ended' });
                return result;
            });
            if (outcome) {
                results.push({ id: docSnap.id, outcome });
                log(`Annonce ${docSnap.id} : ${outcome === 'sold' ? 'vendue' : 'rendue au vendeur'}`);
            }
        } catch (e) {
            log(`Erreur sur l'annonce ${docSnap.id} : ${e.message}`);
        }
    }
    return results;
}
