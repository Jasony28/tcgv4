// Fichier: server/actions.js — tout ce qui touche à l'économie du jeu, exécuté par le serveur.
// Le jeu envoie seulement « quoi faire » (acheter tel booster, ouvrir tel booster…) : les prix, les tirages,
// les récompenses et les quêtes sont décidés ici, avec le même code que le jeu (services *.js).
import { doc, getDoc } from './firestore-rest.js';
import { db } from '../firebase-config.js';
import { getDayKey } from '../daily-utils.js';
import { getDailyShop } from '../shop-config.js';
import { buyCard, buyBooster, buyDisplay, buyPack, claimGift } from '../shop-service.js';
import { openDisplay, keepDailyBooster, saveOpenedBooster, resetDailyCounters } from '../inventory-service.js';
import { drawBooster } from '../booster-draws.js';
import { mainDailyBoosterType } from '../series-config.js';
import { claimAchievement } from '../achievements.js';
import { updateQuestProgress, updateQuestsProgress, claimPassRewards } from '../quest-manager.js';
import { updateUserStats } from '../stats-manager.js';
import {
    createListing, placeBid, buyNow, acceptTradeListing, cancelListing, finalizeExpiredListings, sellToConsole, getListingItem
} from '../market-service.js';
import { validateTrade } from '../trade-service.js';
import { createClan, createCardRequest, donateCard } from '../clan-service.js';

export class UserError extends Error {}

// ---------- Vérification des paramètres envoyés par le jeu ----------

const str = (v, name) => {
    if (typeof v !== 'string' || !v || v.length > 200) throw new UserError(`Paramètre invalide : ${name}`);
    return v;
};
const int = (v, name, min = 1, max = 1000000) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new UserError(`Paramètre invalide : ${name}`);
    return v;
};
const oneOf = (v, list, name) => {
    if (!list.includes(v)) throw new UserError(`Paramètre invalide : ${name}`);
    return v;
};

async function userData(uid) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) throw new UserError("Compte introuvable.");
    return { uid, ...snap.data() };
}

/** Quêtes : chaque action peut en faire avancer plusieurs ; elles sont enregistrées ensemble à la fin
 *  (une seule transaction) et celles qui viennent d'être terminées sont renvoyées au jeu */
function questTracker(uid) {
    const events = [];
    return {
        add(actionType, value = 1, extra = {}) {
            if (value) events.push({ actionType, value, extra });
        },
        async flush() {
            if (!events.length) return { quests: [], levelUp: null };
            const r = await updateQuestsProgress(uid, events);
            return { quests: r.completed, levelUp: r.levelAfter > r.levelBefore ? r.levelAfter : null };
        }
    };
}

/** Nouveau jour (heure de Paris) : les boosters gratuits repartent à zéro */
async function resetDailyIfNewDay(uid) {
    const u = await userData(uid);
    const last = u.dailyLastReset?.toMillis ? getDayKey(new Date(u.dailyLastReset.toMillis())) : null;
    if (last !== getDayKey()) await resetDailyCounters(uid);
}

const BOOSTER_KINDS = ['daily', 'daily_v2', 'classic', 'legendary', 'v2', 'v3', 'v3_legendary'];

// ---------- Les actions ----------

export const ACTIONS = {
    /** Connexion du jour (quête « connecte-toi X jours ») */
    async login(uid, _p, q) {
        q.add('daily_login_streak');
    },

    // Boutique
    async buyCard(uid, p, q) {
        const cardId = str(p.cardId, 'cardId');
        const offer = getDailyShop(getDayKey()).find(o => o.card.id === cardId);
        if (!offer) throw new UserError("La boutique vient de changer !");
        await buyCard(uid, offer);
        await updateUserStats(uid, { bestPurchase: { cardId, price: offer.price } });
        q.add('shop_buy');
        q.add('obtain_10_diff_cards_24h', 1, { cardId });
        return { price: offer.price };
    },
    async buyBooster(uid, p, q) {
        const r = await buyBooster(uid, str(p.type, 'type'));
        q.add('shop_buy');
        return r;
    },
    async buyDisplay(uid, p, q) {
        await buyDisplay(uid, str(p.type, 'type'));
        q.add('shop_buy');
    },
    async buyPack(uid, p, q) {
        const r = await buyPack(uid, str(p.packId, 'packId'));
        q.add('shop_buy');
        return r;
    },
    claimGift: (uid) => claimGift(uid),

    // Boosters
    async resetDaily(uid) {
        await resetDailyIfNewDay(uid);
    },
    async openBooster(uid, p, q) {
        const boosterType = oneOf(p.boosterType, BOOSTER_KINDS, 'boosterType');
        if (boosterType === 'daily' || boosterType === 'daily_v2') await resetDailyIfNewDay(uid);
        const cards = drawBooster(boosterType);
        await saveOpenedBooster(uid, boosterType, cards);
        await updateUserStats(uid, { boostersOpened: 1 });
        // Type réel du booster (le gratuit principal est V1, puis V3) : mêmes quêtes que l'ouverture classique
        const drawn = { daily: mainDailyBoosterType(), daily_v2: 'v2' }[boosterType] || boosterType;
        q.add('obtain_10_diff_cards_24h', 1, { cardIds: cards.map(c => c.id) });
        q.add('open_booster');
        if (drawn === 'legendary') q.add('open_legendary_booster');
        if (drawn === 'v2') q.add('open_v2_booster');
        if (drawn === 'v3' || drawn === 'v3_legendary') q.add('open_v3_booster');
        q.add('pull_v3_rare_plus', cards.filter(c => c.version === 'v3' && c.rarity !== 'Commune').length);
        q.add('pull_v3_epic_plus', cards.filter(c => c.version === 'v3' && (c.rarity === 'epique' || c.rarity === 'Légendaire')).length);
        return { cards: cards.map(c => c.id) };
    },
    async keepDailyBooster(uid, p) {
        await resetDailyIfNewDay(uid);
        return { boosterType: await keepDailyBooster(uid, oneOf(p.kind, ['main', 'v1', 'v2'], 'kind')) };
    },
    openDisplay: (uid, p) => openDisplay(uid, str(p.type, 'type')),

    // Récompenses
    async claimAchievement(uid, p) {
        const a = await claimAchievement(uid, str(p.id, 'id'));
        return { id: a.id };
    },
    async claimPass(uid, p) {
        if (!Array.isArray(p.steps) || p.steps.length > 30) throw new UserError('Paramètre invalide : steps');
        const { rewards, drawnCards } = await claimPassRewards(uid, p.steps.map(s => int(s, 'steps', 1, 30)));
        return { steps: rewards.map(r => r.step), cards: Object.fromEntries(Object.entries(drawnCards).map(([s, c]) => [s, c.id])) };
    },

    // Console
    async sellConsole(uid, p, q) {
        const quantity = int(p.quantity, 'quantity', 1, 10000);
        const r = await sellToConsole(uid, str(p.cardId, 'cardId'), quantity);
        await updateUserStats(uid, { cardsSoldConsole: quantity });
        q.add('sell_console', quantity);
        if (r.rarity === 'epique') q.add('sell_epic_console', quantity);
        if (r.rarity === 'Légendaire') q.add('sell_legendary_console', quantity);
        return { coins: r.coins };
    },

    // Hôtel des Ventes
    async createListing(uid, p, q) {
        const me = await userData(uid);
        const id = await createListing({ uid, pseudo: me.pseudo }, {
            mode: p.mode, item: p.item, startPrice: p.startPrice, buyNowPrice: p.buyNowPrice ?? null,
            fixedPrice: p.fixedPrice === true, wantedCardIds: p.wantedCardIds, wantMode: p.wantMode, durationHours: p.durationHours
        });
        q.add('create_auction');
        return { id };
    },
    async placeBid(uid, p, q) {
        const amount = await placeBid({ uid }, str(p.listingId, 'listingId'), int(p.amount, 'amount'));
        q.add('place_bid');
        return { amount };
    },
    async buyNow(uid, p, q) {
        const r = await buyNow({ uid }, str(p.listingId, 'listingId'));
        q.add('win_bid');
        if (r.item.type === 'card') q.add('obtain_10_diff_cards_24h', 1, { cardId: r.item.cardId });
        return { price: r.price };
    },
    async acceptTradeListing(uid, p, q) {
        const r = await acceptTradeListing({ uid }, str(p.listingId, 'listingId'), p.cardId == null ? null : str(p.cardId, 'cardId'));
        if (r.item.type === 'card') q.add('obtain_10_diff_cards_24h', 1, { cardId: r.item.cardId });
    },
    cancelListing: (uid, p) => cancelListing({ uid }, str(p.listingId, 'listingId')),
    async finalizeExpired(uid, _p, q) {
        // 6 annonces au plus par appel (limite d'appels à la base de Cloudflare) ; GitHub Actions clôture le reste
        const results = await finalizeExpiredListings(uid, 6);
        for (const { listing, outcome } of results) {
            if (outcome === 'sold' && listing.highestBidderId === uid) q.add('win_bid');
        }
        return {
            results: results.map(({ listing, outcome }) => ({
                outcome, item: getListingItem(listing), sellerId: listing.sellerId,
                highestBidderId: listing.highestBidderId || null, currentPrice: listing.currentPrice
            }))
        };
    },

    // Échange entre amis (les deux joueurs avancent leur quête)
    async validateTrade(uid, p, q) {
        const tradeId = str(p.tradeId, 'tradeId');
        const trade = (await getDoc(doc(db, 'tradeRequests', tradeId))).data();
        if (!trade || (trade.from !== uid && trade.to !== uid)) throw new UserError("Échange introuvable.");
        await validateTrade(tradeId);
        q.add('friend_trade');
        const other = trade.from === uid ? trade.to : trade.from;
        await updateQuestProgress(other, 'friend_trade').catch(() => {});
    },

    // Clans
    async createClan(uid, p) {
        const input = p.input || {};
        return { id: await createClan(uid, { name: input.name, tag: input.tag, description: input.description, emblem: input.emblem }) };
    },
    async createCardRequest(uid, p) {
        return { id: await createCardRequest(uid, str(p.clanId, 'clanId'), str(p.cardId, 'cardId')) };
    },
    async donateCard(uid, p) {
        return { coins: await donateCard(uid, str(p.clanId, 'clanId'), str(p.requestId, 'requestId')) };
    }
};

/** Exécute une action pour le joueur uid. Les erreurs « normales » (pas assez de pièces…) sont renvoyées au jeu. */
export async function runAction(uid, action, params = {}) {
    const fn = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
    if (!fn) throw new UserError('Action inconnue.');
    const q = questTracker(uid);
    const result = await fn(uid, params && typeof params === 'object' ? params : {}, q);
    return { result: result ?? null, ...(await q.flush()) };
}

