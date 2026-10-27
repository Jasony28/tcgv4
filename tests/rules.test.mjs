// Tests de l'anti-triche, dans l'émulateur Firebase :
//  1) le serveur du jeu (server/dist/worker.js, assemblé comme pour Cloudflare) fait toutes les actions de l'économie ;
//  2) les règles Firestore empêchent un joueur de modifier lui-même ses pièces, cartes, boosters, quêtes…
// Lancement : cd tests && npm install && npm test
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp, Timestamp, deleteField, arrayUnion } from 'firebase/firestore';
import worker from '../server/dist/worker.js';
import { allCardsV3 } from '../cards-v3.js';
import { getDailyShop } from '../shop-config.js';
import { getDayKey, getWeekKey } from '../daily-utils.js';

const PROJECT = 'demo-tcg';
let env;

before(async () => {
    env = await initializeTestEnvironment({
        projectId: PROJECT,
        firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 }
    });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { earned = {}; await env.clearFirestore(); });

// ---------- Outils ----------

const serverEnv = { FIREBASE_PROJECT_ID: PROJECT, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', TEST_AUTH: 'yes' };
/** Le jeu appelle le serveur au nom du joueur uid */
// Pièces gagnées avec les quêtes, par joueur (remis à zéro avant chaque test)
let earned = {};
const questCoins = (res) => (res.quests || []).reduce((n, q) => n + q.coins, 0);
async function call(uid, action, params = {}) {
    const res = await worker.fetch(new Request('https://serveur.test/api', {
        method: 'POST',
        headers: { Authorization: `Bearer test:${uid}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params })
    }), serverEnv);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    earned[uid] = (earned[uid] || 0) + questCoins(data);
    return data;
}
const admin = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
async function read(path) {
    let data;
    await admin(async (db) => { data = (await getDoc(doc(db, path))).data(); });
    return data;
}
const client = (uid) => env.authenticatedContext(uid).firestore();
const cards = (obj) => Object.fromEntries(Object.entries(obj).map(([id, q]) => [id, { quantity: q }]));
const V3 = (rarity) => allCardsV3.filter(c => c.rarity === rarity && !c.upcoming);
const LEG = V3('Légendaire')[0].id, COM = V3('Commune')[0].id, COM2 = V3('Commune')[1].id, RARE = V3('Rare')[0].id;

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

// ---------- Le joueur ne peut plus tricher ----------

test('règles : impossible de modifier soi-même son économie', async () => {
    await seedUser('mallory', { collection: cards({ [COM]: 1 }) });
    const db = client('mallory');
    const me = doc(db, 'users', 'mallory');
    await assertFails(updateDoc(me, { coins: increment(1) }));
    await assertFails(updateDoc(me, { [`collection.${LEG}.quantity`]: 5 }));
    await assertFails(updateDoc(me, { 'boosterInventory.v3': 10 }));
    await assertFails(updateDoc(me, { 'battlePass.xp': 3000 }));
    await assertFails(updateDoc(me, { dailyBoosterOpenedCount: 0, dailyLastReset: serverTimestamp() }));
    await assertFails(updateDoc(me, { 'stats.boostersOpened': 999 }));
    await assertFails(updateDoc(me, { 'achievements.v3_album': { claimed: true } }));
    await assertFails(updateDoc(me, { giftInbox: arrayUnion({ id: 'x', message: 'faux cadeau' }) }));
    // Annonces, clans, demandes de clan : seulement par le serveur
    await assertFails(setDoc(doc(db, 'auctions', 'a1'), { sellerId: 'mallory', status: 'active' }));
    await assertFails(setDoc(doc(db, 'clans', 'c1'), { name: 'Clan', tag: 'AB', description: '', ownerId: 'mallory', members: ['mallory'], createdAt: serverTimestamp() }));
    // Création de compte gonflée
    const db2 = client('eve');
    await assertFails(setDoc(doc(db2, 'users', 'eve'), { pseudo: 'Eve', collection: {}, coins: 99999 }));
    await assertFails(setDoc(doc(db2, 'users', 'eve'), { pseudo: 'Eve', collection: cards({ [LEG]: 3 }), coins: 50 }));
    await assertFails(setDoc(doc(db2, 'users', 'eve'), { pseudo: 'Eve', collection: {}, coins: 50, battlePass: { xp: 5000 } }));
});

test('règles : ce que le joueur peut encore faire lui-même', async () => {
    const db = client('alice');
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), {
        pseudo: 'Alice', email: 'a@test', collection: {}, coins: 50,
        dailyBoosterOpenedCount: 0, dailyV2BoosterOpenedCount: 0, dailyLastReset: null,
        lastLoginQuestUpdate: null, lastBoosterOpenQuestUpdate: null,
        battlePass: { seasonId: null, xp: 0, questProgress: {}, claimedRewards: {} },
        boosterInventory: { classic: 0, legendary: 0, v2: 0, v3: 0 }
    }));
    const me = doc(db, 'users', 'alice');
    await assertSucceeds(updateDoc(me, { lastOnline: serverTimestamp() }));
    await assertSucceeds(updateDoc(me, { pseudo: 'Alicia', pseudoChanged: true }));
    await assertFails(updateDoc(me, { pseudo: 'Encore', pseudoChanged: true })); // une seule fois
    await seedUser('bob');
    await assertSucceeds(updateDoc(doc(db, 'users', 'bob'), { friendRequests: arrayUnion('alice') }));
    await admin((a) => updateDoc(doc(a, 'users', 'alice'), { giftInbox: [{ id: 'g1', message: 'Cadeau' }] }));
    await assertSucceeds(updateDoc(me, { giftInbox: [] }));
    await assertSucceeds(updateDoc(me, { clanId: 'c9' }));
    await assertSucceeds(updateDoc(me, { clanId: deleteField() }));
});

// ---------- Le serveur fait l'économie ----------

test('serveur : refuse un joueur sans jeton valide', async () => {
    const res = await worker.fetch(new Request('https://serveur.test/api', {
        method: 'POST', headers: { Authorization: 'Bearer faux', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claimGift' })
    }), { ...serverEnv, TEST_AUTH: 'no' });
    assert.equal(res.status, 401);
});

test('serveur : boutique, cadeau, boosters tirés par le serveur', async () => {
    await seedUser('alice', { coins: 1000 });
    let bonus = 0;
    const offer = getDailyShop(getDayKey())[0];
    const booster = await call('alice', 'buyBooster', { type: 'v3' });
    bonus += questCoins(booster);
    bonus += questCoins(await call('alice', 'buyCard', { cardId: offer.card.id, price: 0 })); // le prix envoyé est ignoré
    bonus += questCoins(await call('alice', 'buyDisplay', { type: 'v3' }));
    bonus += questCoins(await call('alice', 'buyPack', { packId: 'mystery' }));
    bonus += questCoins(await call('alice', 'claimGift'));
    let u = await read('users/alice');
    assert.ok(u.boosterInventory.v3 >= 3);
    assert.equal(u.collection[offer.card.id].quantity, 1);
    assert.equal(u.coins, 1000 - booster.result.price - offer.price - 250 - 50 + 5 + bonus);
    // Une carte qui n'est pas dans la boutique du jour : refusé
    const notInShop = allCardsV3.find(c => !getDailyShop(getDayKey()).some(o => o.card.id === c.id));
    await assert.rejects(call('alice', 'buyCard', { cardId: notInShop.id }), /boutique/);
    // Ouvrir un booster : 5 cartes tirées par le serveur
    const before = u.boosterInventory.v3;
    const { result } = await call('alice', 'openBooster', { boosterType: 'v3' });
    assert.equal(result.cards.length, 5);
    u = await read('users/alice');
    assert.equal(u.boosterInventory.v3, before - 1);
    assert.equal(u.stats.boostersOpened, 1);
    // Boosters gratuits du jour : 3 maximum, une seule remise à zéro par jour
    await call('alice', 'resetDaily');
    for (let i = 0; i < 3; i++) await call('alice', 'openBooster', { boosterType: 'daily' });
    await assert.rejects(call('alice', 'openBooster', { boosterType: 'daily' }), /épuisés/);
    await call('alice', 'resetDaily');
    await assert.rejects(call('alice', 'openBooster', { boosterType: 'daily' }), /épuisés/);
    await call('alice', 'openDisplay', { type: 'v3' });
    assert.ok((await read('users/alice')).boosterInventory.v3 >= 10);
});

test('serveur : succès, quêtes et Pass', async () => {
    const commons = V3('Commune').map(c => c.id);
    await seedUser('alice', {
        collection: cards(Object.fromEntries(commons.map(id => [id, 1]))),
        battlePass: { seasonId: getWeekKey(), xp: 1000, questProgress: {}, claimedRewards: {} }
    });
    await call('alice', 'claimAchievement', { id: 'v3_commune' });
    await assert.rejects(call('alice', 'claimAchievement', { id: 'v3_commune' }), /déjà/);
    await assert.rejects(call('alice', 'claimAchievement', { id: 'v3_album' }), /manque/);
    const login = await call('alice', 'login');
    assert.ok(login.quests.length >= 1);
    const pass = await call('alice', 'claimPass', { steps: [1, 3, 5] });
    assert.equal(Object.keys(pass.result.cards).length, 1);
    await assert.rejects(call('alice', 'claimPass', { steps: [1] }), /déjà/);
    await assert.rejects(call('alice', 'claimPass', { steps: [25] }), /pas encore/);
    const u = await read('users/alice');
    assert.ok(u.achievements.v3_commune.claimed);
    assert.ok(u.battlePass.claimedRewards['5']);
});

test('serveur : vente à la console au prix fixe', async () => {
    await seedUser('alice', { collection: cards({ [LEG]: 3, [COM]: 3 }) });
    const r = await call('alice', 'sellConsole', { cardId: LEG, quantity: 2, pricePerCard: 9999 });
    assert.equal(r.result.coins, 40);
    assert.equal((await read('users/alice')).coins, 50 + 40 + questCoins(r));
    await assert.rejects(call('alice', 'sellConsole', { cardId: COM, quantity: 10 }), /Pas assez/);
    await assert.rejects(call('alice', 'sellConsole', { cardId: COM, quantity: 'beaucoup' }), /invalide/);
});

test('serveur : marché complet (mise, surenchère, achat immédiat, échange, annulation, clôture)', async () => {
    await seedUser('seller', { collection: cards({ [LEG]: 4, [COM]: 4, [COM2]: 2 }), boosterInventory: { v3: 3 } });
    await seedUser('bob', { coins: 1000, collection: cards({ [RARE]: 2 }) });
    await seedUser('carol', { coins: 1000 });
    const { result: { id: auction } } = await call('seller', 'createListing', { mode: 'auction', item: { type: 'card', cardId: LEG, quantity: 1 }, startPrice: 150, durationHours: 6 });
    assert.equal((await read('users/seller')).collection[LEG].quantity, 3);
    await call('bob', 'placeBid', { listingId: auction, amount: 200 });
    await call('carol', 'placeBid', { listingId: auction, amount: 250 });
    assert.equal((await read('users/bob')).coins, 1000);
    await assert.rejects(call('seller', 'placeBid', { listingId: auction, amount: 400 }), /propre/);
    const { result: { id: fixed } } = await call('seller', 'createListing', { mode: 'auction', item: { type: 'booster', boosterType: 'v3', quantity: 2 }, startPrice: 40, fixedPrice: true, durationHours: 6 });
    await call('bob', 'buyNow', { listingId: fixed });
    const { result: { id: swap } } = await call('seller', 'createListing', { mode: 'trade', item: { type: 'bundle', cards: { [COM]: 2, [COM2]: 1 } }, wantedCardIds: [RARE], durationHours: 6 });
    await call('bob', 'acceptTradeListing', { listingId: swap, cardId: RARE });
    const { result: { id: cancel } } = await call('seller', 'createListing', { mode: 'auction', item: { type: 'card', cardId: LEG, quantity: 1 }, startPrice: 100, durationHours: 6 });
    await call('bob', 'placeBid', { listingId: cancel, amount: 120 });
    await call('seller', 'cancelListing', { listingId: cancel });
    await assert.rejects(call('bob', 'cancelListing', { listingId: auction }), /pas ton annonce/);
    // Fin de l'enchère : carol gagne
    await admin((db) => updateDoc(doc(db, 'auctions', auction), { endTime: Timestamp.fromMillis(Date.now() - 1000) }));
    const fin = await call('carol', 'finalizeExpired');
    assert.equal(fin.result.results.length, 1);
    const s = await read('users/seller'), b = await read('users/bob'), c = await read('users/carol');
    assert.equal(c.collection[LEG].quantity, 1);
    assert.equal(c.coins, 750 + earned.carol);
    assert.equal(b.coins, 1000 - 40 + earned.bob);
    assert.equal(b.boosterInventory.v3, 2);
    assert.equal(b.collection[COM].quantity, 2);
    assert.equal(s.collection[LEG].quantity, 3);
    assert.equal(s.collection[RARE].quantity, 1);
    assert.equal(s.coins, 50 + (40 - 4) + (250 - 25) + earned.seller);
});

test('serveur : échange entre amis', async () => {
    await seedUser('alice', { coins: 100, friends: ['bob'], collection: cards({ [LEG]: 2 }) });
    await seedUser('bob', { coins: 300, friends: ['alice'], collection: cards({ [COM]: 3 }) });
    await seedUser('eve', { coins: 0 });
    const EMPTY_OFFER = () => ({ cards: {}, coins: 0, boosters: { classic: 0, v2: 0, v3: 0, legendary: 0, v3_legendary: 0 } });
    const tid = 't1';
    await admin((db) => setDoc(doc(db, 'tradeRequests', tid), { from: 'alice', to: 'bob', status: 'pending', createdAt: Timestamp.now(), offerA: EMPTY_OFFER(), offerB: EMPTY_OFFER(), readyA: false, readyB: false }));
    const tref = (uid) => doc(client(uid), 'tradeRequests', tid);
    await assertSucceeds(updateDoc(tref('bob'), { status: 'accepted' }));
    await assertSucceeds(updateDoc(tref('alice'), { offerA: { ...EMPTY_OFFER(), cards: { [LEG]: 1 } }, readyA: false, readyB: false }));
    await assertSucceeds(updateDoc(tref('bob'), { offerB: { ...EMPTY_OFFER(), coins: 200 }, readyA: false, readyB: false }));
    await assertSucceeds(updateDoc(tref('bob'), { readyB: true }));
    await assertSucceeds(updateDoc(tref('alice'), { readyA: true }));
    // Changer son offre après que l'autre soit prêt, sans revalider : refusé
    await assertFails(updateDoc(tref('alice'), { offerA: EMPTY_OFFER() }));
    // Valider soi-même dans Firestore : refusé (seul le serveur valide)
    await assertFails(updateDoc(tref('alice'), { status: 'completed' }));
    await assert.rejects(call('eve', 'validateTrade', { tradeId: tid }), /introuvable/);
    await call('alice', 'validateTrade', { tradeId: tid });
    assert.equal((await read('users/alice')).coins, 300 + (earned.alice || 0));
    assert.equal((await read('users/bob')).collection[LEG].quantity, 1);
});

test('serveur : clan (création payante, demande et don de carte)', async () => {
    await seedUser('alice', { coins: 300, collection: cards({ [RARE]: 3 }) });
    await seedUser('bob');
    const { result: { id: clanId } } = await call('alice', 'createClan', { input: { name: 'Les Fées', tag: 'FEE', description: 'Salut' } });
    assert.equal((await read('users/alice')).coins, 200);
    await admin(async (db) => {
        await updateDoc(doc(db, 'clans', clanId), { members: ['alice', 'bob'] });
        await updateDoc(doc(db, 'users', 'bob'), { clanId });
    });
    const { result: { id: reqId } } = await call('bob', 'createCardRequest', { clanId, cardId: RARE });
    const r = await call('alice', 'donateCard', { clanId, requestId: reqId });
    assert.equal((await read('users/bob')).collection[RARE].quantity, 1);
    assert.equal((await read('users/alice')).coins, 200 + r.result.coins + (earned.alice || 0));
});

test('serveur : paramètres invalides et actions inconnues', async () => {
    await seedUser('alice');
    await assert.rejects(call('alice', 'giveMeCoins', { coins: 1e9 }), /inconnue/);
    await assert.rejects(call('alice', 'openBooster', { boosterType: 'gratuit' }), /invalide/);
    await assert.rejects(call('alice', 'openBooster', { boosterType: 'v3' }), /Pas de booster/);
    await assert.rejects(call('alice', 'claimPass', { steps: 'tout' }), /invalide/);
    await assert.rejects(call('alice', 'placeBid', { listingId: 'x', amount: -5 }), /invalide/);
    assert.equal((await read('users/alice')).coins, 50);
});
