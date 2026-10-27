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
import { econWrite, dealStamp } from './econ-service.js';
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
// Rachat d'une carte par la console (prix fixe, décidé par le serveur)
export const CONSOLE_SELL_PRICES = { 'Commune': 1, 'Rare': 2, 'epique': 5, 'Légendaire': 20 };
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
export const MAX_BUNDLE_CARDS = 10;
const RARITY_RANK = { 'Commune': 0, 'Rare': 1, 'epique': 2, 'Légendaire': 3 };

/** Cartes d'un lot, triées de la plus rare à la moins rare : [{ cardId, quantity, card }] */
export function bundleCards(item) {
    return Object.entries(item.cards || {}).filter(([, q]) => q > 0)
        .map(([cardId, quantity]) => ({ cardId, quantity, card: findCard(cardId) }))
        .sort((a, b) => (RARITY_RANK[b.card?.rarity] || 0) - (RARITY_RANK[a.card?.rarity] || 0));
}

export function describeItem(item) {
    if (item.type === 'bundle') {
        const cards = bundleCards(item);
        const total = cards.reduce((n, c) => n + c.quantity, 0);
        return { name: `Lot de ${total} cartes`, image: cards[0]?.card?.image || '', rarity: cards[0]?.card?.rarity || 'Commune', cards };
    }
    if (item.type === 'booster') {
        const info = BOOSTER_INFO[item.boosterType] || { name: 'Booster' };
        return { name: info.name, image: 'assets/booster/booster.webp', rarity: null, boosterType: item.boosterType };
    }
    if (item.type === 'display') {
        const info = DISPLAY_INFO[item.displayType] || { name: 'Display' };
        return { name: info.name, image: 'assets/booster/booster.webp', rarity: null, boosterType: item.displayType };
    }
    const card = findCard(item.cardId);
    return { name: card ? cardLabel(card) : item.cardId, image: card?.image || '', rarity: card?.rarity || 'Commune' };
}

export function minPriceFor(item) {
    if (item.type === 'bundle') return bundleCards(item).reduce((n, c) => n + (CARD_MIN_PRICES[c.card?.rarity] || 5) * c.quantity, 0);
    const unit = item.type === 'booster' ? (BOOSTER_INFO[item.boosterType]?.minPrice || 10)
        : item.type === 'display' ? (DISPLAY_INFO[item.displayType]?.minPrice || 100)
        : (CARD_MIN_PRICES[findCard(item.cardId)?.rarity] || 5);
    return unit * (item.quantity || 1);
}

/**
 * Mouvements d'inventaire d'un objet : { champ: quantité } (signe = ajouter ou retirer).
 * Un lot touche plusieurs cartes à la fois.
 */
export function itemDeltas(item, sign = 1) {
    if (item.type === 'bundle') {
        return Object.fromEntries(bundleCards(item).map(c => [`collection.${c.cardId}.quantity`, sign * c.quantity]));
    }
    return { [itemField(item)]: sign * (item.quantity || 1) };
}
const incs = (deltas) => Object.fromEntries(Object.entries(deltas).map(([f, n]) => [f, increment(n)]));

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
export const MAX_PRICE = 1000000;

/**
 * Façon de vendre une annonce :
 *  'auction' : enchère classique · 'auction-buynow' : enchère + achat immédiat · 'fixed' : prix fixe · 'trade' : échange
 */
export function saleKind(listing) {
    if (getListingType(listing) === 'trade') return 'trade';
    if (listing.allowBids === false) return 'fixed';
    return listing.buyNowPrice ? 'auction-buynow' : 'auction';
}
/** L'achat immédiat est-il encore possible ? (il disparaît quand une enchère l'atteint) */
export const canBuyNow = (listing) => getListingType(listing) === 'auction' && !!listing.buyNowPrice && listing.currentPrice < listing.buyNowPrice
    || listing.allowBids === false;
/** Prix d'achat immédiat effectif */
export const buyNowPriceOf = (listing) => listing.allowBids === false ? listing.currentPrice : listing.buyNowPrice;

// Prix conseillés (par exemplaire) : départ d'enchère et achat immédiat
const SUGGESTED = {
    'Commune': [5, 20], 'Rare': [12, 50], 'epique': [35, 150], 'Légendaire': [130, 600]
};
/** { start, buyNow } conseillés pour un objet (selon la rareté, le type de booster/display et la quantité) */
export function suggestedPrices(item) {
    if (item.type === 'bundle') {
        return bundleCards(item).reduce((t, c) => {
            const [st, bn] = SUGGESTED[c.card?.rarity] || [5, 20];
            return { start: t.start + st * c.quantity, buyNow: t.buyNow + bn * c.quantity };
        }, { start: 0, buyNow: 0 });
    }
    const min = minPriceFor({ ...item, quantity: 1 });
    let start = min, buyNow = min * 3;
    if (item.type === 'card') [start, buyNow] = SUGGESTED[findCard(item.cardId)?.rarity] || [min, min * 3];
    if (item.type === 'display') buyNow = min * 2;
    const q = Math.max(1, item.quantity || 1);
    return { start: Math.max(start, min) * q, buyNow: Math.max(buyNow, min + 1) * q };
}

export async function createListing(seller, { mode, item, startPrice, buyNowPrice = null, fixedPrice = false, wantedCardIds, wantMode = 'one', durationHours }) {
    if (!['auction', 'trade'].includes(mode)) throw new Error("Type d'annonce invalide.");
    let cleanItem, quantity;
    if (item.type === 'bundle') {
        const cards = {};
        for (const [id, q] of Object.entries(item.cards || {})) {
            const n = Math.floor(q);
            if (n > 0 && findCard(id)) cards[id] = n;
        }
        if (Object.keys(cards).length > MAX_BUNDLE_CARDS) throw new Error(`Maximum ${MAX_BUNDLE_CARDS} cartes différentes par lot.`);
        quantity = Object.values(cards).reduce((a, b) => a + b, 0);
        if (quantity < 2) throw new Error("Un lot doit contenir au moins 2 cartes.");
        cleanItem = { type: 'bundle', cards, quantity };
    } else {
    quantity = Math.floor(item.quantity || 1);
    if (quantity < 1) throw new Error("Quantité invalide.");
    cleanItem = item.type === 'booster' ? { type: 'booster', boosterType: item.boosterType, quantity }
        : item.type === 'display' ? { type: 'display', displayType: item.displayType, quantity }
        : { type: 'card', cardId: item.cardId, quantity };
    }
    if (cleanItem.type === 'booster' && !BOOSTER_INFO[cleanItem.boosterType]) throw new Error("Booster inconnu.");
    if (cleanItem.type === 'display' && !DISPLAY_INFO[cleanItem.displayType]) throw new Error("Display inconnue.");
    if (cleanItem.type === 'card' && !findCard(cleanItem.cardId)) throw new Error("Carte inconnue.");
    if (!DURATIONS_HOURS.includes(durationHours)) throw new Error("Durée invalide.");

    let price = 0, buyNow = null;
    let wanted = [];
    if (mode === 'auction') {
        const min = minPriceFor(cleanItem);
        if (fixedPrice) {
            // Prix fixe : pas d'enchères, on achète directement à ce prix
            price = Math.floor(buyNowPrice || startPrice);
            if (!price || price < min) throw new Error(`Le prix doit être d'au moins ${min} pièces.`);
            if (price > MAX_PRICE) throw new Error(`Prix maximum : ${MAX_PRICE} pièces.`);
        } else {
            price = Math.floor(startPrice);
            if (!price || price < min) throw new Error(`Le prix de départ doit être d'au moins ${min} pièces.`);
            if (buyNowPrice) {
                buyNow = Math.floor(buyNowPrice);
                if (buyNow <= price) throw new Error("Le prix d'achat immédiat doit être plus élevé que le prix de départ.");
                if (buyNow > MAX_PRICE) throw new Error(`Prix maximum : ${MAX_PRICE} pièces.`);
            }
            if (price > MAX_PRICE) throw new Error(`Prix maximum : ${MAX_PRICE} pièces.`);
        }
    } else {
        wanted = [...new Set(wantedCardIds || [])].filter(id => findCard(id));
        if (wanted.length === 0) throw new Error("Choisis au moins une carte que tu veux recevoir.");
        if (wanted.length > MAX_WANTED_CARDS) throw new Error(`Maximum ${MAX_WANTED_CARDS} cartes demandées.`);
        if (cleanItem.type === 'card' && wanted.includes(cleanItem.cardId)) throw new Error("Tu ne peux pas demander la carte que tu proposes.");
        if (cleanItem.type === 'bundle' && wanted.some(id => cleanItem.cards[id])) throw new Error("Tu ne peux pas demander une carte que tu mets dans le lot.");
        if (!['one', 'all'].includes(wantMode)) throw new Error("Type d'échange invalide.");
    }

    const userRef = doc(db, "users", seller.uid);
    const listingRef = doc(collection(db, "auctions"));
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        if (cleanItem.type === 'bundle') {
            for (const c of bundleCards(cleanItem)) {
                if ((snap.data().collection?.[c.cardId]?.quantity || 0) <= c.quantity) throw new Error(`Garde au moins un exemplaire de ${c.card?.name || c.cardId}.`);
            }
        }
        const owned = cleanItem.type === 'bundle' ? Infinity : ownedCount(snap.data(), cleanItem);
        if (cleanItem.type === 'card' && owned <= quantity) throw new Error("Garde au moins un exemplaire : tu n'as pas assez de doubles.");
        if (cleanItem.type === 'booster' && owned < quantity) throw new Error("Tu n'as pas assez de boosters.");
        if (cleanItem.type === 'display' && owned < quantity) throw new Error("Tu n'as pas assez de displays.");

        econWrite(transaction, userRef, snap.data(), itemDeltas(cleanItem, -1));
        transaction.set(listingRef, {
            type: mode,
            item: cleanItem,
            // Champs historiques, gardés pour les anciennes annonces et la tâche GitHub Actions
            cardId: cleanItem.type === 'card' ? cleanItem.cardId : null,  // (un lot n'a pas de carte unique)
            quantity,
            sellerId: seller.uid,
            sellerPseudo: seller.pseudo || '???',
            startPrice: price,
            currentPrice: price,
            allowBids: !(mode === 'auction' && fixedPrice),
            buyNowPrice: buyNow,
            highestBidderId: null,
            highestBidderPseudo: null,
            wantedCardIds: wanted,
            wantMode: mode === 'trade' ? wantMode : null,
            createdAt: Timestamp.now(),
            endTime: Timestamp.fromMillis(Date.now() + durationHours * 3600 * 1000),
            status: 'active'
        });
    });
    return listingRef.id;
}

/**
 * Marque chaque écriture d'une affaire (sur mon compte comme sur celui de l'autre joueur) : les règles Firestore
 * vérifient que l'annonce change dans la même transaction et que chacun reçoit ou paie exactement ce qu'il doit.
 */
const auctionDeal = (id) => dealStamp('auction', id);

/** « Meilleure vente / meilleur achat » : seulement si le prix bat le record */
const bestStat = (userData, key, entry) => entry.price > (userData?.stats?.[key]?.price || 0) ? { [`stats.${key}`]: entry } : {};

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
        if (listing.allowBids === false) throw new Error("Cette annonce est à prix fixe : utilise « Acheter maintenant ».");
        if (listing.buyNowPrice && amount >= listing.buyNowPrice) throw new Error(`À ce prix, utilise plutôt l'achat immédiat (${listing.buyNowPrice} pièces).`);
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
        transaction.update(userRef, { coins: increment(-cost), lastDeal: auctionDeal(listingId) });
        transaction.update(listingRef, { currentPrice: amount, highestBidderId: bidder.uid, highestBidderPseudo: pseudo });
        transaction.set(bidRef, { amount, bidderId: bidder.uid, bidderPseudo: pseudo, timestamp: Timestamp.now() });
    });
    return amount;
}

/**
 * Achat immédiat (enchère avec prix d'achat immédiat, ou prix fixe).
 * L'acheteur paie et reçoit l'objet tout de suite, le meilleur enchérisseur éventuel est remboursé,
 * le vendeur reçoit le prix moins la taxe. L'annonce est terminée comme une enchère gagnée.
 * @returns {Promise<{item, price}>}
 */
export async function buyNow(buyer, listingId) {
    const buyerRef = doc(db, "users", buyer.uid);
    const listingRef = doc(db, "auctions", listingId);
    let result;
    await runTransaction(db, async (transaction) => {
        const listingDoc = await transaction.get(listingRef);
        if (!listingDoc.exists()) throw new Error("Annonce introuvable.");
        const listing = listingDoc.data();
        if (listing.status !== 'active') throw new Error("Cette annonce n'est plus disponible.");
        if (listing.endTime.toMillis() <= Date.now()) throw new Error("Cette annonce est terminée.");
        if (listing.sellerId === buyer.uid) throw new Error("C'est ta propre annonce.");
        if (!canBuyNow(listing)) throw new Error("L'achat immédiat n'est plus possible sur cette annonce.");
        const price = buyNowPriceOf(listing);

        const buyerDoc = await transaction.get(buyerRef);
        const sellerRef = doc(db, "users", listing.sellerId);
        const sellerDoc = await transaction.get(sellerRef);
        const previousRef = listing.highestBidderId && listing.highestBidderId !== buyer.uid ? doc(db, "users", listing.highestBidderId) : null;
        if (previousRef) await transaction.get(previousRef);
        if (!buyerDoc.exists()) throw new Error("Utilisateur non trouvé.");
        // Si j'étais déjà le meilleur enchérisseur, ma mise est déjà bloquée : je ne paie que la différence
        const already = listing.highestBidderId === buyer.uid ? listing.currentPrice : 0;
        if ((buyerDoc.data().coins || 0) < price - already) throw new Error(`Il te faut ${price - already} pièces.`);

        const item = getListingItem(listing);
        const entry = { cardId: item.cardId || null, name: describeItem(item).name, price };
        const deal = auctionDeal(listingId);
        const now = Timestamp.now();
        transaction.update(buyerRef, { coins: increment(-(price - already)), ...incs(itemDeltas(item)), lastDeal: deal, ...bestStat(buyerDoc.data(), 'bestPurchase', entry) });
        if (previousRef) transaction.update(previousRef, { coins: increment(listing.currentPrice), lastDeal: deal });
        if (sellerDoc.exists()) transaction.update(sellerRef, { coins: increment(sellerProceeds(price)), lastDeal: deal,
            'stats.cardsSoldMarket': increment(1), ...bestStat(sellerDoc.data(), 'bestSale', entry) });
        transaction.update(listingRef, {
            status: 'ended', soldBy: 'buyNow', currentPrice: price,
            highestBidderId: buyer.uid, highestBidderPseudo: buyerDoc.data().pseudo || '???',
            buyerId: buyer.uid, buyerPseudo: buyerDoc.data().pseudo || '???',
            endedAt: now, endTime: now,
            ...(item.type === 'card' ? { buyerGotNew: (buyerDoc.data().collection?.[item.cardId]?.quantity || 0) === 0 } : {})
        });
        result = { item, price };
    });
    return result;
}

/**
 * Accepte une annonce d'échange en donnant une des cartes demandées.
 * L'échange est immédiat : l'acheteur reçoit l'objet, le vendeur reçoit la carte.
 */
export async function acceptTradeListing(buyer, listingId, offeredCardId = null) {
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
        // « toutes » : il faut donner chaque carte demandée ; sinon une seule au choix
        const giving = listing.wantMode === 'all' ? [...(listing.wantedCardIds || [])] : [offeredCardId];
        if (listing.wantMode !== 'all' && !(listing.wantedCardIds || []).includes(offeredCardId)) throw new Error("Le vendeur ne demande pas cette carte.");
        const missing = giving.filter(id => (buyerDoc.data().collection?.[id]?.quantity || 0) < 1);
        if (missing.length) throw new Error(listing.wantMode === 'all' ? `Il te manque ${missing.length} des cartes demandées.` : "Tu ne possèdes pas cette carte.");

        const sellerRef = doc(db, "users", listing.sellerId);
        const sellerDoc = await transaction.get(sellerRef);
        if (!sellerDoc.exists()) throw new Error("Le vendeur n'existe plus.");

        const item = getListingItem(listing);
        // Pour l'historique : chacun reçoit-il une carte qu'il n'avait pas encore ?
        const buyerGotNew = item.type === 'card' && (buyerDoc.data().collection?.[item.cardId]?.quantity || 0) === 0;
        const sellerGotNew = (sellerDoc.data().collection?.[offeredCardId]?.quantity || 0) === 0;
        // Si l'objet est la carte que l'acheteur donne (impossible en principe), on additionne proprement
        const buyerTotals = {};
        for (const id of giving) addTo(buyerTotals, `collection.${id}.quantity`, -1);
        for (const [f, n] of Object.entries(itemDeltas(item))) addTo(buyerTotals, f, n);
        transaction.update(buyerRef, { ...toIncrements(buyerTotals), lastDeal: auctionDeal(listingId) });
        transaction.update(sellerRef, { ...Object.fromEntries(giving.map(id => [`collection.${id}.quantity`, increment(1)])), lastDeal: auctionDeal(listingId) });
        transaction.update(listingRef, {
            status: 'completed',
            buyerId: buyer.uid,
            buyerPseudo: buyerDoc.data().pseudo || '???',
            receivedCardId: giving[0],
            receivedCardIds: giving,
            completedAt: Timestamp.now(),
            buyerGotNew,
            sellerGotNew
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
        transaction.update(doc(db, "users", listing.sellerId), { ...incs(itemDeltas(item)), lastDeal: auctionDeal(listingId) });
        transaction.update(listingRef, { status: 'cancelled', cancelledAt: Timestamp.now() });
    });
}

/**
 * Clôture les annonces expirées (enchères gagnées, invendus rendus, échanges non conclus rendus).
 * Sans danger si plusieurs joueurs ou la tâche GitHub Actions le font en même temps : chaque annonce
 * est relue dans sa transaction et n'est traitée que si elle est encore active.
 * @returns {Promise<Array<{listing:object, outcome:'sold'|'returned'}>>}
 */
export async function finalizeExpiredListings(myUid = null, max = Infinity) {
    const q = query(collection(db, "auctions"), where("status", "==", "active"), where("endTime", "<=", Timestamp.now()));
    const snapshot = await getDocs(q);
    const results = [];

    for (const docSnap of snapshot.docs) {
        // Les règles Firestore n'autorisent que les participants : les autres annonces sont closes par GitHub Actions
        const d = docSnap.data();
        if (myUid && d.sellerId !== myUid && d.highestBidderId !== myUid) continue;
        if (results.length >= max) break;
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

                const closing = { status: 'ended', endedAt: Timestamp.now() };
                if (buyerDoc?.exists()) {
                    // Enchère gagnée (statistiques des deux joueurs dans la même transaction)
                    const entry = { cardId: item.cardId || null, name: describeItem(item).name, price: listing.currentPrice };
                    if (item.type === 'card') closing.buyerGotNew = (buyerDoc.data().collection?.[item.cardId]?.quantity || 0) === 0;
                    transaction.update(buyerRef, { ...incs(itemDeltas(item)), lastDeal: auctionDeal(docSnap.id), ...bestStat(buyerDoc.data(), 'bestPurchase', entry) });
                    if (sellerDoc.exists()) transaction.update(sellerRef, { coins: increment(sellerProceeds(listing.currentPrice)), lastDeal: auctionDeal(docSnap.id),
                        'stats.cardsSoldMarket': increment(1), ...bestStat(sellerDoc.data(), 'bestSale', entry) });
                    outcome = 'sold';
                } else {
                    // Personne (ou acheteur supprimé) : l'objet revient au vendeur
                    if (sellerDoc.exists()) transaction.update(sellerRef, { ...incs(itemDeltas(item)), lastDeal: auctionDeal(docSnap.id),
                        ...(getListingType(listing) === 'auction' ? { 'stats.failedSales': increment(1) } : {}) });
                    outcome = 'returned';
                }
                transaction.update(listingRef, closing);
            });
        } catch (e) {
            console.error("Erreur clôture annonce :", e);
            continue;
        }
        if (outcome) results.push({ listing, outcome });
    }
    return results;
}

/** Vente directe à la console, au prix fixe de la rareté (CONSOLE_SELL_PRICES). Renvoie les pièces gagnées. */
export async function sellToConsole(uid, cardId, quantity) {
    const card = findCard(cardId);
    if (!card) throw new Error("Carte inconnue.");
    const pricePerCard = CONSOLE_SELL_PRICES[card.rarity] || 1;
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Quantité invalide.");
    const userRef = doc(db, "users", uid);
    await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
        const currentQuantity = userDoc.data().collection?.[cardId]?.quantity || 0;
        if (quantity < 1 || currentQuantity < quantity) throw new Error("Pas assez de cartes à vendre.");
        econWrite(transaction, userRef, userDoc.data(), {
            [`collection.${cardId}.quantity`]: -quantity,
            coins: pricePerCard * quantity
        });
    });    return { coins: pricePerCard * quantity, rarity: card.rarity };
}
