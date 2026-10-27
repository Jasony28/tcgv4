// Tests des règles Firestore : le vrai code du jeu (services) contre l'émulateur, puis des tentatives de triche.
// Lancement : cd tests && npm install && npm test
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    doc, getDoc, setDoc, updateDoc, runTransaction, writeBatch, increment, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { useDb } from './stubs/firebase-config.mjs';
import { setTestUser } from './stubs/auth.mjs';

import { buyBooster, buyCard, buyDisplay, buyPack, claimGift } from '../shop-service.js';
import { openDisplay, keepDailyBooster, saveOpenedBooster, resetDailyCounters } from '../inventory-service.js';
import { claimAchievement } from '../achievements.js';
import { updateQuestProgress, claimPassRewards } from '../quest-manager.js';
import { createListing, placeBid, buyNow, acceptTradeListing, cancelListing, finalizeExpiredListings, sellToConsole } from '../market-service.js';
import { createTradeRequest, validateTrade, EMPTY_OFFER } from '../trade-service.js';
import { createCardRequest, donateCard } from '../clan-service.js';
import { allCardsV3 } from '../cards-v3.js';
import { getDailyShop } from '../shop-config.js';
import { getDayKey, getWeekKey } from '../daily-utils.js';
import { econDay, DAILY_GAIN_LIMIT } from '../econ-config.js';

let env;
const PROJECT = 'demo-tcg';

before(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
    });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

/** Connecte un joueur : le code du jeu utilise désormais sa base */
function as(uid) {
    const db = env.authenticatedContext(uid).firestore();
    useDb(db);
    setTestUser(uid);
    return db;
}
const admin = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
async function read(path) {
    let data;
    await admin(async (db) => { data = (await getDoc(doc(db, path))).data(); });
    return data;
}
const V3 = (rarity) => allCardsV3.filter(c => c.rarity === rarity && !c.upcoming);
const LEG = V3('Légendaire')[0].id, LEG2 = V3('Légendaire')[1].id, COM = V3('Commune')[0].id, COM2 = V3('Commune')[1].id, RARE = V3('Rare')[0].id;

/** Compte de joueur comme auth.js le crée, avec des valeurs de départ */
async function seedUser(uid, data = {}) {
    await admin((db) => setDoc(doc(db, 'users', uid), {
        pseudo: uid, email: `${uid}@test`, collection: {}, coins: 50,
        dailyBoosterOpenedCount: 0, dailyV2BoosterOpenedCount: 0, dailyLastReset: null,
        battlePass: { seasonId: null, xp: 0, questProgress: {}, claimedRewards: {} },
        boosterInventory: { classic: 0, legendary: 0, v2: 0, v3: 0 },
        ...data
    }));
}
const cards = (obj) => Object.fromEntries(Object.entries(obj).map(([id, q]) => [id, { quantity: q }]));

// ---------- Création de compte ----------

test('création de compte : normal accepté, compte gonflé refusé', async () => {
    const db = as('alice');
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), {
        pseudo: 'Alice', email: 'a@test', collection: {}, coins: 50,
        dailyBoosterOpenedCount: 0, dailyV2BoosterOpenedCount: 0, dailyLastReset: null,
        lastLoginQuestUpdate: null, lastBoosterOpenQuestUpdate: null,
        battlePass: { seasonId: null, xp: 0, questProgress: {}, claimedRewards: {} },
        boosterInventory: { classic: 0, legendary: 0, v2: 0, v3: 0 }
    }));
    const db2 = as('bob');
    await assertFails(setDoc(doc(db2, 'users', 'bob'), { pseudo: 'Bob', collection: {}, coins: 99999, boosterInventory: {} }));
    await assertFails(setDoc(doc(db2, 'users', 'bob'), { pseudo: 'Bob', collection: cards({ [LEG]: 5 }), coins: 50 }));
    await assertFails(setDoc(doc(db2, 'users', 'bob'), { pseudo: 'Bob', collection: {}, coins: 50, boosterInventory: { v3: 50 } }));
});

// ---------- Parcours normaux ----------

test('boutique : booster, carte du jour, display, pack, cadeau', async () => {
    await seedUser('alice', { coins: 1000 });
    as('alice');
    await buyBooster('alice', 'v3');
    const offer = getDailyShop(getDayKey())[0];
    await buyCard('alice', offer);
    await buyDisplay('alice', 'v3');
    await buyPack('alice', 'mystery', () => 0.99); // jackpot : 6 boosters pour 50 pièces
    await claimGift('alice');
    const u = await read('users/alice');
    assert.equal(u.boosterInventory.v3, 1 + 6);
    assert.equal(u.displayInventory.v3, 1);
    assert.equal(u.collection[offer.card.id].quantity, 1);
});

test('boosters : ouverture, display, boosters gratuits et remise à zéro', async () => {
    await seedUser('alice', { boosterInventory: { v3: 2, v3_legendary: 1 }, displayInventory: { v3: 1 } });
    as('alice');
    const ids = (...l) => l.map(id => ({ id }));
    const five = ids(COM, COM, COM2, RARE, LEG);
    await saveOpenedBooster('alice', 'v3', five);
    await saveOpenedBooster('alice', 'v3_legendary', ids(COM, COM2, RARE, RARE, LEG2));
    await openDisplay('alice', 'v3');
    await resetDailyCounters('alice');
    await saveOpenedBooster('alice', 'daily', ids(COM, COM, COM2, RARE, RARE));
    await keepDailyBooster('alice', 'main');
    const u = await read('users/alice');
    assert.equal(u.boosterInventory.v3, 1 + 10 + 1);
    assert.equal(u.collection[COM].quantity, 5);
    assert.equal(u.dailyBoosterOpenedCount, 2);
    // Une 2e remise à zéro le même jour (pour avoir plus de boosters gratuits) est refusée
    await assert.rejects(resetDailyCounters('alice'));
});

test('succès : réclamé avec les cartes, refusé sans, une seule fois', async () => {
    const commons = V3('Commune').map(c => c.id);
    await seedUser('alice', { collection: cards(Object.fromEntries(commons.map(id => [id, 1]))) });
    as('alice');
    await claimAchievement('alice', 'v3_commune');
    const u = await read('users/alice');
    assert.equal(u.coins, 50 + 50);
    assert.equal(u.boosterInventory.v3, 1);
    // Re-réclamer en effaçant le succès : refusé
    const db = as('alice');
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { 'achievements.v3_commune': { claimed: false } }));
    // Réclamer un succès sans les cartes, en écrivant directement : refusé (au-delà du plafond)
    await assertFails(updateDoc(doc(db, 'users', 'alice'), {
        'achievements.v3_album': { claimed: true }, coins: increment(5000)
    }));
});

test('quêtes et Pass : pièces et récompenses', async () => {
    await seedUser('alice', {
        battlePass: { seasonId: getWeekKey(), xp: 1000, questProgress: {}, claimedRewards: {} }
    });
    as('alice');
    await updateQuestProgress('daily_login_streak');
    await claimPassRewards('alice', [
        { step: 1, type: 'coins', value: 5 }, { step: 3, type: 'v3_booster', value: 1 },
        { step: 5, type: 'random_card', rarity: 'Rare', version: 'v3', value: 1 }
    ], { 5: { id: RARE } });
    const u = await read('users/alice');
    assert.ok(u.coins >= 55);
    assert.equal(u.boosterInventory.v3, 1);
    assert.equal(u.collection[RARE].quantity, 1);
    assert.ok(u.econ.used > 0);
});

test('vente à la console : prix normal accepté, prix inventé refusé', async () => {
    await seedUser('alice', { collection: cards({ [LEG]: 3, [COM]: 3 }) });
    as('alice');
    await sellToConsole('alice', LEG, 1, 20);
    await sellToConsole('alice', COM, 2, 1);
    assert.equal((await read('users/alice')).coins, 50 + 20 + 2);
    await assert.rejects(sellToConsole('alice', COM, 1, 5000));
});

test('clan : don de carte à un membre', async () => {
    await seedUser('alice', { collection: cards({ [RARE]: 3 }) });
    await seedUser('bob');
    await admin(async (db) => {
        await setDoc(doc(db, 'clans', 'c1'), { name: 'Clan', tag: 'AB', description: '', emblem: '', ownerId: 'alice', members: ['alice', 'bob'], createdAt: Timestamp.now() });
        await updateDoc(doc(db, 'users', 'alice'), { clanId: 'c1' });
        await updateDoc(doc(db, 'users', 'bob'), { clanId: 'c1' });
    });
    as('bob');
    const reqId = await createCardRequest('bob', 'c1', RARE);
    as('alice');
    const reward = await donateCard('alice', 'c1', reqId);
    assert.equal((await read('users/bob')).collection[RARE].quantity, 1);
    assert.equal((await read('users/alice')).coins, 50 + reward);
});

// ---------- Triches sur son propre compte ----------

test('triche : se donner des pièces, cartes ou boosters est limité au plafond du jour', async () => {
    await seedUser('mallory', { collection: cards({ [COM]: 1 }) });
    const db = as('mallory');
    const ref = doc(db, 'users', 'mallory');
    const day = econDay();
    // Sans tenir le compte des gains : refusé
    await assertFails(updateDoc(ref, { coins: increment(100) }));
    // Plus que le plafond : refusé
    await assertFails(updateDoc(ref, { coins: increment(DAILY_GAIN_LIMIT + 1), 'econ.day': day, 'econ.used': DAILY_GAIN_LIMIT + 1 }));
    // 20 légendaires d'un coup : refusé, avec ou sans reçu juste (valeur 2000 > plafond)
    const withReceipt = (userUpdates, receipt) => {
        const batch = writeBatch(db);
        batch.update(ref, userUpdates);
        if (receipt) batch.set(doc(db, 'econ', 'mallory'), { at: serverTimestamp(), ...receipt });
        return batch.commit();
    };
    await assertFails(updateDoc(ref, { [`collection.${LEG}.quantity`]: increment(20), 'econ.day': day, 'econ.used': 0 }));
    await assertFails(withReceipt({ [`collection.${LEG}.quantity`]: increment(20), 'econ.day': day, 'econ.used': 0 },
        { cards: { c: [], r: [], e: [], l: [LEG] }, gain: 0 }));
    await assertFails(withReceipt({ [`collection.${LEG}.quantity`]: increment(20), 'econ.day': day, 'econ.used': 2000 },
        { cards: { c: [], r: [], e: [], l: [LEG] }, gain: 2000 }));
    // Une légendaire déclarée comme commune : refusé
    await assertFails(withReceipt({ [`collection.${LEG}.quantity`]: increment(1), 'econ.day': day, 'econ.used': 1 },
        { cards: { c: [LEG], r: [], e: [], l: [] }, gain: 1 }));
    // Vendre 50 fois la même carte (pour « payer » des pièces en trop) : refusé
    await assertFails(withReceipt({ [`collection.${COM}.quantity`]: increment(-1), coins: increment(40), 'econ.day': day, 'econ.used': 0 },
        { cards: { c: Array(50).fill(COM), r: [], e: [], l: [] }, gain: -50 }));
    // Une vraie légendaire avec le bon reçu : accepté (dans le plafond)
    await assertSucceeds(withReceipt({ [`collection.${LEG}.quantity`]: increment(1), 'econ.day': day, 'econ.used': 100 },
        { cards: { c: [], r: [], e: [], l: [LEG] }, gain: 100 }));
    // 100 boosters légendaires : refusé
    await assertFails(updateDoc(ref, { 'boosterInventory.v3_legendary': increment(100), 'econ.day': day, 'econ.used': 10000 }));
    // Jusqu'au plafond : accepté, puis plus rien
    await assertSucceeds(updateDoc(ref, { coins: increment(DAILY_GAIN_LIMIT - 100), 'econ.day': day, 'econ.used': DAILY_GAIN_LIMIT }));
    await assertFails(updateDoc(ref, { coins: increment(1), 'econ.day': day, 'econ.used': DAILY_GAIN_LIMIT + 1 }));
    // Remettre le compteur à zéro : refusé
    await assertFails(updateDoc(ref, { 'econ.used': 0 }));
    await assertFails(updateDoc(ref, { 'econ.day': day - 1 }));
    // Pièces négatives ou faux type de booster : refusé
    await assertFails(updateDoc(ref, { coins: -5 }));
    await assertFails(updateDoc(ref, { 'boosterInventory.v99': 3 }));
    // Se faire passer pour une affaire du marché : refusé
    await assertFails(updateDoc(ref, { coins: increment(500), lastDeal: { kind: 'auction', id: 'nope', at: serverTimestamp() } }));
    // Remettre à zéro le Pack Débutant déjà acheté : refusé
    await admin((a) => updateDoc(doc(a, 'users', 'mallory'), { 'packsBought.starter': true }));
    await assertFails(updateDoc(ref, { 'packsBought.starter': false }));
});

// ---------- Hôtel des Ventes ----------

async function seedMarket() {
    await seedUser('seller', { collection: cards({ [LEG]: 3, [COM]: 4, [COM2]: 2 }), boosterInventory: { v3: 3 } });
    await seedUser('bob', { coins: 1000, collection: cards({ [RARE]: 2 }) });
    await seedUser('carol', { coins: 1000 });
}
const expire = (id) => admin((db) => updateDoc(doc(db, 'auctions', id), { endTime: Timestamp.fromMillis(Date.now() - 1000) }));

test('marché : mise, surenchère, clôture', async () => {
    await seedMarket();
    as('seller');
    const id = await createListing({ uid: 'seller', pseudo: 'seller' }, { mode: 'auction', item: { type: 'card', cardId: LEG, quantity: 1 }, startPrice: 150, durationHours: 6 });
    assert.equal((await read('users/seller')).collection[LEG].quantity, 2);
    as('bob'); await placeBid({ uid: 'bob' }, id, 200);
    as('carol'); await placeBid({ uid: 'carol' }, id, 250);
    assert.equal((await read('users/bob')).coins, 1000);
    as('carol'); await placeBid({ uid: 'carol' }, id, 260);
    assert.equal((await read('users/carol')).coins, 740);
    await expire(id);
    as('carol');
    const res = await finalizeExpiredListings('carol');
    assert.equal(res.length, 1);
    assert.equal((await read('users/carol')).collection[LEG].quantity, 1);
    assert.equal((await read('users/seller')).coins, 50 + 260 - 26);
});

test('marché : achat immédiat, échange, annulation, invendu', async () => {
    await seedMarket();
    as('seller');
    const seller = { uid: 'seller', pseudo: 'seller' };
    const fixed = await createListing(seller, { mode: 'auction', item: { type: 'booster', boosterType: 'v3', quantity: 2 }, startPrice: 40, fixedPrice: true, durationHours: 6 });
    const swap = await createListing(seller, { mode: 'trade', item: { type: 'bundle', cards: { [COM]: 2, [COM2]: 1 } }, wantedCardIds: [RARE], durationHours: 6 });
    const cancel = await createListing(seller, { mode: 'auction', item: { type: 'card', cardId: LEG, quantity: 1 }, startPrice: 100, buyNowPrice: 500, durationHours: 6 });
    const unsold = await createListing(seller, { mode: 'auction', item: { type: 'card', cardId: LEG, quantity: 1 }, startPrice: 100, durationHours: 6 });
    as('bob');
    await buyNow({ uid: 'bob' }, fixed);
    await acceptTradeListing({ uid: 'bob' }, swap, RARE);
    await placeBid({ uid: 'bob' }, cancel, 120);
    let b = await read('users/bob');
    assert.equal(b.boosterInventory.v3, 2);
    assert.equal(b.collection[COM].quantity, 2);
    assert.equal(b.coins, 1000 - 40 - 120);
    as('seller');
    await cancelListing(seller, cancel);
    assert.equal((await read('users/bob')).coins, 1000 - 40);
    await expire(unsold);
    await finalizeExpiredListings('seller');
    const s = await read('users/seller');
    assert.equal(s.collection[LEG].quantity, 3);
    assert.equal(s.collection[RARE].quantity, 1);
    assert.equal(s.coins, 50 + 36);
});

test('triche au marché : vol, mise sans payer, annonce sans dépôt', async () => {
    await seedMarket();
    as('seller');
    const id = await createListing({ uid: 'seller', pseudo: 'seller' }, { mode: 'auction', item: { type: 'card', cardId: LEG, quantity: 1 }, startPrice: 150, durationHours: 6 });
    const db = as('bob');
    const lref = doc(db, 'auctions', id);
    const deal = { kind: 'auction', id, at: serverTimestamp() };
    // Miser sans payer
    await assertFails(runTransaction(db, async (t) => {
        await t.get(lref);
        t.update(lref, { currentPrice: 200, highestBidderId: 'bob', highestBidderPseudo: 'bob' });
        t.update(doc(db, 'users', 'bob'), { lastDeal: deal });
    }));
    // Miser en vidant les pièces du vendeur
    await assertFails(runTransaction(db, async (t) => {
        await t.get(lref);
        t.update(lref, { currentPrice: 200, highestBidderId: 'bob', highestBidderPseudo: 'bob' });
        t.update(doc(db, 'users', 'bob'), { coins: increment(-200), lastDeal: deal });
        t.update(doc(db, 'users', 'seller'), { coins: 0, lastDeal: deal });
    }));
    // Changer le prix ou le vendeur de l'annonce
    await assertFails(updateDoc(lref, { sellerId: 'bob' }));
    await assertFails(updateDoc(lref, { status: 'cancelled' }));
    // Mettre en vente une carte sans la retirer de son compte (pour la dupliquer)
    await assertFails(setDoc(doc(db, 'auctions', 'fake'), {
        type: 'auction', item: { type: 'card', cardId: RARE, quantity: 1 }, cardId: RARE, quantity: 1,
        sellerId: 'bob', sellerPseudo: 'bob', startPrice: 10, currentPrice: 10, allowBids: true, buyNowPrice: null,
        highestBidderId: null, highestBidderPseudo: null, wantedCardIds: [], wantMode: null,
        createdAt: Timestamp.now(), endTime: Timestamp.fromMillis(Date.now() + 3600e3), status: 'active'
    }));
    // Clôturer avant la fin
    as('seller');
    await finalizeExpiredListings('seller');
    assert.equal((await read(`auctions/${id}`)).status, 'active');
});

// ---------- Échanges entre amis ----------

test('échange entre amis : normal, puis triche sur les offres', async () => {
    await seedUser('alice', { coins: 100, friends: ['bob'], collection: cards({ [LEG]: 2 }) });
    await seedUser('bob', { coins: 300, friends: ['alice'], collection: cards({ [COM]: 3 }) });
    let db = as('alice');
    const tid = await createTradeRequest('alice', 'bob');
    const tref = (d) => doc(d, 'tradeRequests', tid);
    db = as('bob');
    await assertSucceeds(updateDoc(tref(db), { status: 'accepted' }));
    db = as('alice');
    await assertSucceeds(updateDoc(tref(db), { offerA: { ...EMPTY_OFFER(), cards: { [LEG]: 1 } }, readyA: false, readyB: false }));
    db = as('bob');
    await assertSucceeds(updateDoc(tref(db), { offerB: { ...EMPTY_OFFER(), coins: 200 }, readyA: false, readyB: false }));
    await assertSucceeds(updateDoc(tref(db), { readyB: true }));
    db = as('alice');
    await assertSucceeds(updateDoc(tref(db), { readyA: true }));
    // Alice change son offre après que Bob soit prêt, sans remettre les « prêt » à zéro : refusé
    await assertFails(updateDoc(tref(db), { offerA: EMPTY_OFFER() }));
    // Valider en se donnant plus que l'offre : refusé
    await assertFails(runTransaction(db, async (t) => {
        await t.get(tref(db));
        const deal = { kind: 'trade', id: tid, at: serverTimestamp() };
        t.update(doc(db, 'users', 'alice'), { coins: increment(300), [`collection.${LEG}.quantity`]: increment(-1), lastDeal: deal });
        t.update(doc(db, 'users', 'bob'), { coins: increment(-300), [`collection.${LEG}.quantity`]: increment(1), lastDeal: deal });
        t.update(tref(db), { status: 'completed', completedAt: serverTimestamp(), newCardsFrom: [], newCardsTo: [] });
    }));
    await validateTrade(tid);
    const a = await read('users/alice'), b = await read('users/bob');
    assert.equal(a.coins, 300);
    assert.equal(b.coins, 100);
    assert.equal(b.collection[LEG].quantity, 1);
});

// ---------- Cas les plus lourds (limite de 1000 opérations par requête dans les règles) ----------

import { ECON_CARDS } from '../econ-config.js';
import { ACHIEVEMENTS } from '../achievements-config.js';
const fullCollection = (n = 3) => cards(Object.fromEntries(ECON_CARDS.filter(c => !c.upcoming).map(c => [c.id, n])));
const bigPass = () => ({ seasonId: getWeekKey(), xp: 3000, claimedRewards: {}, questProgress: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i + 8}`, { progress: 3, completed: false }])) });

const step = async (label, fn) => { try { return await fn(); } catch (e) { throw new Error(`${label} : ${e.message}`); } };

test('cas lourds : album complet, Pass entier, lot de 6, échange 6 contre 6', async () => {
    const all = ECON_CARDS.filter(c => !c.upcoming).map(c => c.id);
    await seedUser('alice', { coins: 500, friends: ['bob'], collection: fullCollection(), battlePass: bigPass(), boosterInventory: { classic: 2, v2: 2, v3: 2, legendary: 2, v3_legendary: 2 }, displayInventory: { v3: 1 } });
    await seedUser('bob', { coins: 500, friends: ['alice'], collection: fullCollection(), boosterInventory: { v3: 3 } });
    as('alice');
    for (const a of ACHIEVEMENTS) await step(`succès ${a.id}`, () => claimAchievement('alice', a.id));
    // Tout le Pass d'un coup (6 cartes aléatoires)
    const { fullRewardsList } = await import('../battlepass-config.js');
    const drawn = Object.fromEntries(fullRewardsList.filter(r => r.type === 'random_card').map((r, i) => [r.step, { id: V3(r.rarity)[i % 3].id }]));
    await step('Pass entier', () => claimPassRewards('alice', fullRewardsList, drawn));
    // Booster avec 5 cartes différentes
    await step('booster', () => saveOpenedBooster('alice', 'v3', V3('Commune').slice(0, 3).concat(V3('Rare').slice(0, 1), V3('epique').slice(0, 1))));
    // Lot de 6 cartes différentes à l'échange contre 5 cartes
    const bundle = Object.fromEntries(all.slice(0, 6).map(id => [id, 2]));
    const lid = await step('lot', () => createListing({ uid: 'alice', pseudo: 'alice' }, { mode: 'trade', item: { type: 'bundle', cards: bundle }, wantedCardIds: all.slice(20, 25), wantMode: 'all', durationHours: 6 }));
    as('bob');
    await step('accepter le lot', () => acceptTradeListing({ uid: 'bob' }, lid));
    // Échange entre amis : 6 cartes + boosters + pièces de chaque côté
    let db = as('alice');
    const tid = await createTradeRequest('alice', 'bob');
    const offer = (ids) => ({ cards: Object.fromEntries(ids.map(id => [id, 1])), coins: 10, boosters: { classic: 0, v2: 0, v3: 1, legendary: 0, v3_legendary: 0 } });
    db = as('bob'); await updateDoc(doc(db, 'tradeRequests', tid), { status: 'accepted' });
    db = as('alice'); await updateDoc(doc(db, 'tradeRequests', tid), { offerA: offer(all.slice(30, 36)), readyA: false, readyB: false });
    db = as('bob'); await updateDoc(doc(db, 'tradeRequests', tid), { offerB: offer(all.slice(40, 46)), readyA: false, readyB: false });
    await updateDoc(doc(db, 'tradeRequests', tid), { readyB: true });
    db = as('alice'); await updateDoc(doc(db, 'tradeRequests', tid), { readyA: true });
    const before = await read('users/alice');
    await step('échange 6 contre 6', () => validateTrade(tid));
    const a = await read('users/alice');
    assert.equal(Object.keys(a.achievements).length, ACHIEVEMENTS.length);
    assert.equal(a.collection[all[45]].quantity, before.collection[all[45]].quantity + 1);
    assert.equal(a.collection[all[30]].quantity, before.collection[all[30]].quantity - 1);
    assert.equal(a.collection[all[20]].quantity, 4); // carte reçue avec le lot
});

// ---------- Le reste du jeu continue de marcher ----------

import { sendFriendRequest, acceptFriendRequest } from '../trade-service.js';
import { createClan, joinClan, leaveClan } from '../clan-service.js';
import { updateUserStats } from '../stats-manager.js';

test('divers : amis, clan, statistiques, pseudo, achat immédiat après une enchère', async () => {
    await seedUser('alice', { coins: 300 });
    await seedUser('bob', { coins: 300 });
    await seedUser('carol', { coins: 500, collection: cards({ [LEG]: 2 }) });
    as('alice');
    await sendFriendRequest({ uid: 'alice' }, 'bob');
    as('bob');
    await acceptFriendRequest('bob', 'alice');
    assert.deepEqual((await read('users/alice')).friends, ['bob']);
    as('alice');
    const clanId = await createClan('alice', { name: 'Les Fées', tag: 'FEE', description: 'Salut' });
    assert.equal((await read('users/alice')).coins, 200);
    as('bob');
    await joinClan('bob', clanId);
    await leaveClan('bob');
    await updateUserStats('bob', { boostersOpened: 2, bestSale: { price: 10, name: 'x' } });
    const db = as('bob');
    await assertSucceeds(updateDoc(doc(db, 'users', 'bob'), { pseudo: 'Bobby', pseudoChanged: true, lastOnline: serverTimestamp() }));
    // Enchère puis achat immédiat par un autre joueur : le premier enchérisseur est remboursé
    as('carol');
    const id = await createListing({ uid: 'carol', pseudo: 'carol' }, { mode: 'auction', item: { type: 'card', cardId: LEG, quantity: 1 }, startPrice: 100, buyNowPrice: 250, durationHours: 6 });
    as('alice'); await placeBid({ uid: 'alice' }, id, 150);
    as('bob'); await buyNow({ uid: 'bob' }, id);
    assert.equal((await read('users/alice')).coins, 200);
    assert.equal((await read('users/bob')).coins, 50);
    assert.equal((await read('users/carol')).coins, 500 + 250 - 25);
    assert.equal((await read('users/bob')).collection[LEG].quantity, 1);
});
