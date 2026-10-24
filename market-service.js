// Fichier: market-service.js — logique de l'Hôtel des Ventes (sans interface, testable)
// Deux types d'annonces :
//  - 'auction' : enchère en pièces (le meilleur enchérisseur gagne à la fin)
//  - 'trade'   : échange — le vendeur choisit 1 à 5 cartes qu'il accepte en retour ;
//                le premier joueur qui donne une de ces cartes remporte l'objet immédiatement.
// L'objet mis en vente est une carte ou un booster (classic / v2 / legendary).
import {
    collection, query, where, getDocs, doc, runTransaction, increment, Timestamp
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { allCardsV3Released, V3_RELEASED } from './cards-v3.js';

export const ALL_CARDS = [...allCards, ...allCardsV2, ...allCardsV3Released];
export const MAX_WANTED_CARDS = 5;
export const DURATIONS_HOURS = [6, 12, 24, 48];

export const BOOSTER_INFO = {
    classic: { name: 'Booster Classique', minPrice: 10 },
    v2: { name: 'Booster V2', minPrice: 15 },
    ...(V3_RELEASED ? { v3: { name: 'Booster V3', minPrice: 15 } } : {}),
    legendary: { name: 'Booster Légendaire', minPrice: 50 },
    v3_legendary: { name: 'Booster Légendaire V3', minPrice: 80 }
};
// Displays fermées (boîtes de boosters) : objets de collection, surtout quand leur série est terminée
export const DISPLAY_INFO = {
    classic: { name: 'Display Classique', minPrice: 100 },
    v2: { name: 'Display V2', minPrice: 130 },
    ...(V3_RELEASED ? { v3: { name: 'Display V3', minPrice: 150 } } : {}),
    legendary: { name: 'Coffret Légendaire', minPrice: 160 }
};
export const CARD_MIN_PRICES = { 'Commune': 5, 'Rare': 10, 'epique': 25, 'Légendaire': 100 };

// Taxe de l'Hôtel des Ventes sur les enchères vendues : ces pièces sortent du jeu,
// ce qui évite que la monnaie s'accumule sans fin (inflation). Même valeur dans scripts/close-logic.mjs.
export const MARKET_TAX_RATE = 0.10;
/** Ce que le vendeur touche réellement pour une vente à `price` pièces (taxe arrondie au-dessus). */
export const sellerProceeds = (price) => price - Math.ceil(price * MARKET_TAX_RATE);

export const findCard = (cardId) => ALL_CARDS.find(c => c.id === cardId);

/** Nom affiché : "Nicolas (V2)" pour distinguer les cartes du même nom entre collections */
export const cardLabel = (card) => card ? (card.version ? `${card.name} (${card.version.toUpperCase()})` : card.name) : '';

/** Objet d'une annonce, compatible avec les anciennes enchères (cardId/quantity à la racine). */
export function getListingItem(listing) {
    if (listing.item) return listing.item;
    return { type: 'card', cardId: listing.cardId, quantity: listing.quantity || 1 };
}
export const getListingType = (listing) => listing.type || 'auction';

/** Nom / image / rareté affichables pour un objet. */
export function describeItem(item) {
    if (item.type === 'booster') {
        const info = BOOSTER_INFO[item.boosterType] || { name: 'Booster' };
        return { name: info.name, image: 'assets/booster/booster.png', rarity: null, boosterType: item.boosterType };
    }
    if (item.type === 'display') {
        const info = DISPLAY_INFO[item.displayType] || { name: 'Display' };
        return { name: info.name, image: 'assets/booster/booster.png', rarity: null, boosterType: item.displayType };
    }
    const card = findCard(item.cardId);
    return { name: card ? cardLabel(card) : item.cardId, image: card?.image || '', rarity: card?.rarity || 'Commune' };
}

export function minPriceFor(item) {
    const unit = item.type === 'booster' ? (BOOSTER_INFO[item.boosterType]?.minPrice || 10)
        : item.type === 'display' ? (DISPLAY_INFO[item.displayType]?.minPrice || 100)
        : (CARD_MIN_PRICES[findCard(item.cardId)?.rarity] || 5);
    return unit * (item.quantity || 1);
}

/** Champ Firestore de l'inventaire correspondant à l'objet. */
function itemField(item) {
    if (item.type === 'booster') return `boosterInventory.${item.boosterType}`;
    if (item.type === 'display') return `displayInventory.${item.displayType}`;
    return `collection.${item.cardId}.quantity`;
}
function ownedCount(userData, item) {
    if (item.type === 'booster') return userData.boosterInventory?.[item.boosterType] || 0;
    if (item.type === 'display') return userData.displayInventory?.[item.displayType] || 0;
    return userData.collection?.[item.cardId]?.quantity || 0;
}

// Additionne plusieurs mouvements sur un même document en une seule écriture
function addTo(updates, field, n) {
    updates[field] = (updates[field] || 0) + n;
}
function toIncrements(totals) {
    const out = {};
    for (const [field, n] of Object.entries(totals)) if (n !== 0) out[field] = increment(n);
    return out;
}

/**
 * Crée une annonce. L'objet est retiré de l'inventaire du vendeur (mis "en dépôt").
 * Pour une carte, le vendeur doit en garder au moins un exemplaire.
 */
export async function createListing(seller, { mode, item, startPrice, wantedCardIds, durationHours }) {
    if (!['auction', 'trade'].includes(mode)) throw new Error("Type d'annonce invalide.");
    const quantity = Math.floor(item.quantity || 1);
    if (quantity < 1) throw new Error("Quantité invalide.");
    const cleanItem = item.type === 'booster' ? { type: 'booster', boosterType: item.boosterType, quantity }
        : item.type === 'display' ? { type: 'display', displayType: item.displayType, quantity }
        : { type: 'card', cardId: item.cardId, quantity };
    if (cleanItem.type === 'booster' && !BOOSTER_INFO[cleanItem.boosterType]) throw new Error("Booster inconnu.");
    if (cleanItem.type === 'display' && !DISPLAY_INFO[cleanItem.displayType]) throw new Error("Display inconnue.");
    if (cleanItem.type === 'card' && !findCard(cleanItem.cardId)) throw new Error("Carte inconnue.");
    if (!DURATIONS_HOURS.includes(durationHours)) throw new Error("Durée invalide.");

    let price = 0;
    let wanted = [];
    if (mode === 'auction') {
        price = Math.floor(startPrice);
        const min = minPriceFor(cleanItem);
        if (!price || price < min) throw new Error(`Le prix de départ doit être d'au moins ${min} pièces.`);
    } else {
        wanted = [...new Set(wantedCardIds || [])].filter(id => findCard(id));
        if (wanted.length === 0) throw new Error("Choisis au moins une carte que tu veux recevoir.");
        if (wanted.length > MAX_WANTED_CARDS) throw new Error(`Maximum ${MAX_WANTED_CARDS} cartes demandées.`);
        if (cleanItem.type === 'card' && wanted.includes(cleanItem.cardId)) throw new Error("Tu ne peux pas demander la carte que tu proposes.");
    }

    const userRef = doc(db, "users", seller.uid);
    const listingRef = doc(collection(db, "auctions"));
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        const owned = ownedCount(snap.data(), cleanItem);
        if (cleanItem.type === 'card' && owned <= quantity) throw new Error("Garde au moins un exemplaire : tu n'as pas assez de doubles.");
        if (cleanItem.type === 'booster' && owned < quantity) throw new Error("Tu n'as pas assez de boosters.");
        if (cleanItem.type === 'display' && owned < quantity) throw new Error("Tu n'as pas assez de displays.");

        transaction.update(userRef, { [itemField(cleanItem)]: increment(-quantity) });
        transaction.set(listingRef, {
            type: mode,
            item: cleanItem,
            // Champs historiques, gardés pour les anciennes annonces et la tâche GitHub Actions
            cardId: cleanItem.type === 'card' ? cleanItem.cardId : null,
            quantity,
            sellerId: seller.uid,
            sellerPseudo: seller.pseudo || '???',
            startPrice: price,
            currentPrice: price,
            highestBidderId: null,
            highestBidderPseudo: null,
            wantedCardIds: wanted,
            createdAt: Timestamp.now(),
            endTime: Timestamp.fromMillis(Date.now() + durationHours * 3600 * 1000),
            status: 'active'
        });
    });
    return listingRef.id;
}

/**
 * Marque une écriture sur le compte d'un autre joueur : les règles Firestore vérifient que
 * l'annonce change dans la même transaction et que les deux joueurs y participent.
 */
const auctionDeal = (id) => ({ kind: 'auction', id });

/** Mise sur une enchère en pièces. Renvoie le nouveau prix. */
export async function placeBid(bidder, listingId, bidAmount) {
    const amount = Math.floor(bidAmount);
    const userRef = doc(db, "users", bidder.uid);
    const listingRef = doc(db, "auctions", listingId);
    const bidRef = doc(collection(db, "auctions", listingId, "bids"));

    await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        const listingDoc = await transaction.get(listingRef);
        if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
        if (!listingDoc.exists()) throw new Error("Annonce introuvable.");
        const listing = listingDoc.data();
        if (getListingType(listing) !== 'auction') throw new Error("Cette annonce est un échange, pas une enchère.");
        if (listing.status !== 'active') throw new Error("Enchère terminée ou annulée.");
        if (listing.sellerId === bidder.uid) throw new Error("Tu ne peux pas miser sur ta propre enchère.");
        if (listing.endTime.toMillis() <= Date.now()) throw new Error("Cette enchère est terminée.");
        if (!amount || amount <= listing.currentPrice) {
            throw new Error(`Enchère trop basse ! (minimum ${listing.currentPrice + 1})`);
        }

        // Déjà meilleur enchérisseur : on ne paie que la différence
        const alreadyHighest = listing.highestBidderId === bidder.uid;
        const cost = alreadyHighest ? amount - listing.currentPrice : amount;
        if ((userDoc.data().coins || 0) < cost) throw new Error("Pas assez de pièces pour miser !");

        if (listing.highestBidderId && !alreadyHighest) {
            transaction.update(doc(db, "users", listing.highestBidderId), { coins: increment(listing.currentPrice), lastDeal: auctionDeal(listingId) });
        }
        const pseudo = userDoc.data().pseudo || "???";
        transaction.update(userRef, { coins: increment(-cost) });
        transaction.update(listingRef, { currentPrice: amount, highestBidderId: bidder.uid, highestBidderPseudo: pseudo });
        transaction.set(bidRef, { amount, bidderId: bidder.uid, bidderPseudo: pseudo, timestamp: Timestamp.now() });
    });
    return amount;
}

/**
 * Accepte une annonce d'échange en donnant une des cartes demandées.
 * L'échange est immédiat : l'acheteur reçoit l'objet, le vendeur reçoit la carte.
 */
export async function acceptTradeListing(buyer, listingId, offeredCardId) {
    const buyerRef = doc(db, "users", buyer.uid);
    const listingRef = doc(db, "auctions", listingId);
    let result;

    await runTransaction(db, async (transaction) => {
        const listingDoc = await transaction.get(listingRef);
        const buyerDoc = await transaction.get(buyerRef);
        if (!listingDoc.exists()) throw new Error("Annonce introuvable.");
        if (!buyerDoc.exists()) throw new Error("Utilisateur non trouvé.");
        const listing = listingDoc.data();
        if (getListingType(listing) !== 'trade') throw new Error("Cette annonce n'est pas un échange.");
        if (listing.status !== 'active') throw new Error("Cette annonce n'est plus disponible.");
        if (listing.endTime.toMillis() <= Date.now()) throw new Error("Cette annonce est expirée.");
        if (listing.sellerId === buyer.uid) throw new Error("C'est ta propre annonce.");
        if (!(listing.wantedCardIds || []).includes(offeredCardId)) throw new Error("Le vendeur ne demande pas cette carte.");
        if ((buyerDoc.data().collection?.[offeredCardId]?.quantity || 0) < 1) throw new Error("Tu ne possèdes pas cette carte.");

        const sellerRef = doc(db, "users", listing.sellerId);
        const sellerDoc = await transaction.get(sellerRef);
        if (!sellerDoc.exists()) throw new Error("Le vendeur n'existe plus.");

        const item = getListingItem(listing);
        // Si l'objet est la carte que l'acheteur donne (impossible en principe), on additionne proprement
        const buyerTotals = {};
        addTo(buyerTotals, `collection.${offeredCardId}.quantity`, -1);
        addTo(buyerTotals, itemField(item), item.quantity);
        transaction.update(buyerRef, toIncrements(buyerTotals));
        transaction.update(sellerRef, { [`collection.${offeredCardId}.quantity`]: increment(1), lastDeal: auctionDeal(listingId) });
        transaction.update(listingRef, {
            status: 'completed',
            buyerId: buyer.uid,
            buyerPseudo: buyerDoc.data().pseudo || '???',
            receivedCardId: offeredCardId,
            completedAt: Timestamp.now()
        });
        result = { item, sellerId: listing.sellerId };
    });
    return result;
}

/** Annule sa propre annonce : l'objet revient au vendeur, le meilleur enchérisseur est remboursé. */
export async function cancelListing(seller, listingId) {
    const listingRef = doc(db, "auctions", listingId);
    await runTransaction(db, async (transaction) => {
        const listingDoc = await transaction.get(listingRef);
        if (!listingDoc.exists()) throw new Error("Annonce introuvable.");
        const listing = listingDoc.data();
        if (listing.sellerId !== seller.uid) throw new Error("Ce n'est pas ton annonce.");
        if (listing.status !== 'active') throw new Error("Cette annonce est déjà terminée.");

        const item = getListingItem(listing);
        if (listing.highestBidderId) {
            transaction.update(doc(db, "users", listing.highestBidderId), { coins: increment(listing.currentPrice), lastDeal: auctionDeal(listingId) });
        }
        transaction.update(doc(db, "users", listing.sellerId), { [itemField(item)]: increment(item.quantity) });
        transaction.update(listingRef, { status: 'cancelled' });
    });
}

/**
 * Clôture les annonces expirées (enchères gagnées, invendus rendus, échanges non conclus rendus).
 * Sans danger si plusieurs joueurs ou la tâche GitHub Actions le font en même temps : chaque annonce
 * est relue dans sa transaction et n'est traitée que si elle est encore active.
 * @returns {Promise<Array<{listing:object, outcome:'sold'|'returned'}>>}
 */
export async function finalizeExpiredListings(myUid = null) {
    const q = query(collection(db, "auctions"), where("status", "==", "active"), where("endTime", "<=", Timestamp.now()));
    const snapshot = await getDocs(q);
    const results = [];

    for (const docSnap of snapshot.docs) {
        // Les règles Firestore n'autorisent que les participants : les autres annonces sont closes par GitHub Actions
        const d = docSnap.data();
        if (myUid && d.sellerId !== myUid && d.highestBidderId !== myUid) continue;
        const listingRef = doc(db, "auctions", docSnap.id);
        let outcome = null;
        let listing = null;
        try {
            await runTransaction(db, async (transaction) => {
                outcome = null;
                const fresh = await transaction.get(listingRef);
                if (!fresh.exists() || fresh.data().status !== 'active') return;
                listing = { id: docSnap.id, ...fresh.data() };
                const item = getListingItem(listing);

                const sellerRef = doc(db, "users", listing.sellerId);
                const sellerDoc = await transaction.get(sellerRef);
                const buyerRef = listing.highestBidderId ? doc(db, "users", listing.highestBidderId) : null;
                const buyerDoc = buyerRef ? await transaction.get(buyerRef) : null;

                if (buyerDoc?.exists()) {
                    // Enchère gagnée
                    transaction.update(buyerRef, { [itemField(item)]: increment(item.quantity), lastDeal: auctionDeal(docSnap.id) });
                    if (sellerDoc.exists()) transaction.update(sellerRef, { coins: increment(sellerProceeds(listing.currentPrice)), lastDeal: auctionDeal(docSnap.id) });
                    outcome = 'sold';
                } else {
                    // Personne (ou acheteur supprimé) : l'objet revient au vendeur
                    if (sellerDoc.exists()) transaction.update(sellerRef, { [itemField(item)]: increment(item.quantity), lastDeal: auctionDeal(docSnap.id) });
                    outcome = 'returned';
                }
                transaction.update(listingRef, { status: 'ended' });
            });
        } catch (e) {
            console.error("Erreur clôture annonce :", e);
            continue;
        }
        if (outcome) results.push({ listing, outcome });
    }
    return results;
}

/** Vente directe à la console (prix fixe). */
export async function sellToConsole(uid, cardId, quantity, pricePerCard) {
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
        const currentQuantity = userDoc.data().collection?.[cardId]?.quantity || 0;
        if (quantity < 1 || currentQuantity < quantity) throw new Error("Pas assez de cartes à vendre.");
        transaction.update(userRef, {
            [`collection.${cardId}.quantity`]: increment(-quantity),
            coins: increment(pricePerCard * quantity)
        });
    });
}
