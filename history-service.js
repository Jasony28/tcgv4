// Fichier: history-service.js — historique de l'Hôtel des Ventes et des échanges (sans interface, testable)
//
// Tout vient de données déjà enregistrées : les annonces terminées restent dans « auctions »
// (vendeur, acheteur, prix, carte reçue…) et les échanges entre amis dans « tradeRequests ».
// On ne fait que les relire et les transformer en une liste d'événements pour le joueur.
//
// Un événement : {
//   id, kind, time (ms), partner (pseudo de l'autre joueur ou null),
//   gave: [objets], got: [objets], coins (variation de pièces, + ou −),
//   price (prix de vente brut, pour les enchères), newCards: [cardId] (cartes qu'il n'avait pas encore)
// }
// kind : 'sale' (vendu), 'purchase' (remporté), 'market-trade' (échange au marché),
//        'friend-trade' (échange entre amis), 'unsold' (rendu, personne n'a acheté),
//        'cancelled' (annonce annulée), 'refunded' (remboursé : le vendeur a annulé)
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { getListingItem, getListingType, sellerProceeds } from './market-service.js';
import { BOOSTER_TYPES } from './trade-service.js';

/** Horodatage Firestore → millisecondes (0 si absent) */
const ms = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;

/** Un objet d'une offre d'échange entre amis → liste d'objets affichables */
function offerItems(offer) {
    const items = [];
    for (const [cardId, quantity] of Object.entries(offer?.cards || {})) {
        if (quantity > 0) items.push({ type: 'card', cardId, quantity });
    }
    for (const t of BOOSTER_TYPES) {
        const n = offer?.boosters?.[t] || 0;
        if (n > 0) items.push({ type: 'booster', boosterType: t, quantity: n });
    }
    return items;
}

/** Transforme une annonce de l'Hôtel des Ventes en événement vu par le joueur `uid` (ou null si rien à montrer). */
export function listingToEvent(listing, uid) {
    const item = getListingItem(listing);
    const type = getListingType(listing);
    const isSeller = listing.sellerId === uid;
    const isWinner = listing.highestBidderId === uid;
    const isBuyer = listing.buyerId === uid;
    const base = { id: `a_${listing.id}`, partner: null, gave: [], got: [], coins: 0, price: null, newCards: [] };
    const receivedCard = listing.receivedCardId ? { type: 'card', cardId: listing.receivedCardId, quantity: 1 } : null;
    const endTime = ms(listing.endedAt) || ms(listing.endTime);

    // Échange au marché conclu (annonce « trade » où quelqu'un a donné une carte demandée)
    if (listing.status === 'completed' && receivedCard) {
        const time = ms(listing.completedAt) || ms(listing.createdAt);
        if (isSeller) {
            return { ...base, kind: 'market-trade', time, partner: listing.buyerPseudo || '???',
                gave: [item], got: [receivedCard], newCards: listing.sellerGotNew ? [listing.receivedCardId] : [] };
        }
        if (isBuyer) {
            return { ...base, kind: 'market-trade', time, partner: listing.sellerPseudo || '???',
                gave: [receivedCard], got: [item], newCards: listing.buyerGotNew && item.type === 'card' ? [item.cardId] : [] };
        }
        return null;
    }

    if (listing.status === 'ended') {
        const sold = type === 'auction' && !!listing.highestBidderId;
        if (sold && isSeller) {
            return { ...base, kind: 'sale', time: endTime, partner: listing.highestBidderPseudo || '???',
                gave: [item], coins: sellerProceeds(listing.currentPrice), price: listing.currentPrice };
        }
        if (sold && isWinner) {
            return { ...base, kind: 'purchase', time: endTime, partner: listing.sellerPseudo || '???',
                got: [item], coins: -listing.currentPrice, price: listing.currentPrice,
                newCards: listing.buyerGotNew && item.type === 'card' ? [item.cardId] : [] };
        }
        if (!sold && isSeller) return { ...base, kind: 'unsold', time: endTime, gave: [item] };
        return null;
    }

    if (listing.status === 'cancelled') {
        const time = ms(listing.cancelledAt) || ms(listing.createdAt);
        if (isSeller) return { ...base, kind: 'cancelled', time, gave: [item] };
        if (isWinner) return { ...base, kind: 'refunded', time, partner: listing.sellerPseudo || '???', gave: [item], price: listing.currentPrice };
    }
    return null; // annonces encore actives : elles sont dans les autres onglets
}

/** Transforme un échange entre amis terminé en événement vu par `uid`. */
export function tradeToEvent(trade, uid, pseudos = {}) {
    if (trade.status !== 'completed') return null;
    const amFrom = trade.from === uid;
    if (!amFrom && trade.to !== uid) return null;
    const mine = amFrom ? trade.offerA : trade.offerB;
    const theirs = amFrom ? trade.offerB : trade.offerA;
    const partnerUid = amFrom ? trade.to : trade.from;
    return {
        id: `t_${trade.id}`,
        kind: 'friend-trade',
        time: ms(trade.completedAt) || ms(trade.createdAt),
        partner: pseudos[partnerUid] || 'Un ami',
        gave: offerItems(mine),
        got: offerItems(theirs),
        coins: (theirs?.coins || 0) - (mine?.coins || 0),
        price: null,
        newCards: (amFrom ? trade.newCardsFrom : trade.newCardsTo) || []
    };
}

/** Totaux affichés en haut de l'historique. */
export function summarize(events) {
    const out = { earned: 0, spent: 0, cardsReceived: 0, newCards: 0, sales: 0, purchases: 0, trades: 0 };
    for (const e of events) {
        if (e.coins > 0) out.earned += e.coins;
        if (e.coins < 0) out.spent -= e.coins;
        for (const it of e.got) if (it.type === 'card') out.cardsReceived += it.quantity;
        out.newCards += e.newCards.length;
        if (e.kind === 'sale') out.sales++;
        if (e.kind === 'purchase') out.purchases++;
        if (e.kind === 'market-trade' || e.kind === 'friend-trade') out.trades++;
    }
    return out;
}

/**
 * Cartes reçues (achats + échanges), regroupées par carte, la plus récente d'abord.
 * @returns {Array<{cardId, quantity, isNew, lastTime, from: string[]}>}
 */
export function receivedCards(events) {
    const byCard = new Map();
    for (const e of events) {
        for (const it of e.got) {
            if (it.type !== 'card') continue;
            const entry = byCard.get(it.cardId) || { cardId: it.cardId, quantity: 0, isNew: false, lastTime: 0, from: [] };
            entry.quantity += it.quantity;
            entry.isNew = entry.isNew || e.newCards.includes(it.cardId);
            entry.lastTime = Math.max(entry.lastTime, e.time);
            if (e.partner && !entry.from.includes(e.partner)) entry.from.push(e.partner);
            byCard.set(it.cardId, entry);
        }
    }
    return [...byCard.values()].sort((a, b) => b.lastTime - a.lastTime);
}

/** Charge tout l'historique du joueur, du plus récent au plus ancien. */
export async function loadMarketHistory(uid) {
    // Requêtes sur un seul champ : aucun index Firestore à créer
    const auctionQueries = ['sellerId', 'highestBidderId', 'buyerId']
        .map(field => getDocs(query(collection(db, "auctions"), where(field, "==", uid))));
    const tradeQueries = ['from', 'to']
        .map(field => getDocs(query(collection(db, "tradeRequests"), where(field, "==", uid))));
    const [aSnaps, tSnaps] = await Promise.all([Promise.all(auctionQueries), Promise.all(tradeQueries)]);

    const listings = new Map();
    for (const snap of aSnaps) for (const d of snap.docs) listings.set(d.id, { id: d.id, ...d.data() });
    const trades = new Map();
    for (const snap of tSnaps) for (const d of snap.docs) if (d.data().status === 'completed') trades.set(d.id, { id: d.id, ...d.data() });

    // Pseudos des amis (les échanges entre amis ne les enregistrent pas)
    const partnerUids = [...new Set([...trades.values()].map(t => t.from === uid ? t.to : t.from))];
    const pseudos = {};
    await Promise.all(partnerUids.map(async (pid) => {
        try {
            const s = await getDoc(doc(db, "users", pid));
            if (s.exists()) pseudos[pid] = s.data().pseudo || null;
        } catch { /* ami supprimé : on affiche « Un ami » */ }
    }));

    const events = [
        ...[...listings.values()].map(l => listingToEvent(l, uid)),
        ...[...trades.values()].map(t => tradeToEvent(t, uid, pseudos))
    ].filter(Boolean);
    return events.sort((a, b) => b.time - a.time);
}
