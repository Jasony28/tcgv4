// Fichier: clan-service.js — clans (sans interface, testable)
// clans/{id} : { name, tag, description, ownerId, members: [uid], createdAt }
// Le compte du joueur garde clanId. La liste members du clan fait foi : un clanId qui ne
// correspond plus (exclu par le chef) est simplement ignoré puis nettoyé.
// Chaque action écrit le clan ET le compte en un seul lot (writeBatch) : les règles Firestore
// vérifient que les deux restent cohérents.
import { collection, doc, getDoc, getDocs, writeBatch, arrayUnion, arrayRemove, increment, serverTimestamp, deleteField, query, orderBy, limit, runTransaction } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { playerLevel } from './player-level.js';
import { findCard } from './market-service.js';
import { getDayKey } from './daily-utils.js';

export const CLAN_COST = 100;
export const MAX_MEMBERS = 20;
export const EMBLEMS = ['🛡️', '🐺', '🐉', '🦅', '⚡', '🔥', '🌊', '🌙', '💀', '👑', '🦁', '🍀'];

// Demandes de cartes : 1 par jour et par joueur ; les autres donnent leurs doubles
export const REQUEST_NEEDED = { 'Commune': 4, 'Rare': 2, 'epique': 1 };   // exemplaires demandés (pas de légendaire)
export const DONATION_REWARD = { 'Commune': 5, 'Rare': 15, 'epique': 40 }; // pièces pour le donateur
export const REQUEST_DURATION_MS = 24 * 3600 * 1000;

/** Vérifie et nettoie nom / tag / description */
export function validateClan({ name, tag, description = '', emblem = EMBLEMS[0] }) {
    const clean = {
        name: String(name || '').trim().replace(/\s+/g, ' '),
        tag: String(tag || '').trim().toUpperCase(),
        description: String(description || '').trim().slice(0, 120),
        emblem: EMBLEMS.includes(emblem) ? emblem : EMBLEMS[0]
    };
    if (clean.name.length < 3 || clean.name.length > 24) throw new Error("Le nom du clan doit faire entre 3 et 24 caractères.");
    if (!/^[A-Z0-9]{2,4}$/.test(clean.tag)) throw new Error("Le tag doit faire 2 à 4 lettres ou chiffres (ex : JWB).");
    return clean;
}

/** Le clan du joueur (null s'il n'en a pas, ou s'il en a été exclu) */
export async function getMyClan(user) {
    if (!user?.clanId) return null;
    const snap = await getDoc(doc(db, 'clans', user.clanId));
    if (!snap.exists() || !(snap.data().members || []).includes(user.uid)) return null;
    return { id: snap.id, ...snap.data() };
}

export async function listClans() {
    const snap = await getDocs(collection(db, 'clans'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0));
}

export async function createClan(uid, input) {
    const clan = validateClan(input);
    const userRef = doc(db, 'users', uid);
    const user = (await getDoc(userRef)).data() || {};
    if (await getMyClan({ uid, ...user })) throw new Error("Tu es déjà dans un clan : quitte-le d'abord.");
    if ((user.coins || 0) < CLAN_COST) throw new Error(`Créer un clan coûte ${CLAN_COST} pièces.`);
    const taken = (await listClans()).some(c => c.tag === clan.tag || c.name.toLowerCase() === clan.name.toLowerCase());
    if (taken) throw new Error("Ce nom ou ce tag est déjà pris.");
    const ref = doc(collection(db, 'clans'));
    const batch = writeBatch(db);
    batch.set(ref, { ...clan, ownerId: uid, members: [uid], createdAt: serverTimestamp() });
    batch.update(userRef, { clanId: ref.id, coins: increment(-CLAN_COST) });
    await batch.commit();
    return ref.id;
}

export async function joinClan(uid, clanId) {
    const userRef = doc(db, 'users', uid);
    const user = (await getDoc(userRef)).data() || {};
    if (await getMyClan({ uid, ...user })) throw new Error("Tu es déjà dans un clan : quitte-le d'abord.");
    const snap = await getDoc(doc(db, 'clans', clanId));
    if (!snap.exists()) throw new Error("Ce clan n'existe plus.");
    if ((snap.data().members || []).length >= MAX_MEMBERS) throw new Error(`Ce clan est complet (${MAX_MEMBERS} membres).`);
    const batch = writeBatch(db);
    batch.update(doc(db, 'clans', clanId), { members: arrayUnion(uid) });
    batch.update(userRef, { clanId });
    await batch.commit();
}

/** Quitter : le chef passe la main au plus ancien membre ; dernier membre = clan supprimé */
export async function leaveClan(uid) {
    const userRef = doc(db, 'users', uid);
    const user = (await getDoc(userRef)).data() || {};
    const clan = await getMyClan({ uid, ...user });
    const batch = writeBatch(db);
    if (clan) {
        const ref = doc(db, 'clans', clan.id);
        const others = clan.members.filter(m => m !== uid);
        if (!others.length) batch.delete(ref);
        else if (clan.ownerId === uid) batch.update(ref, { members: arrayRemove(uid), ownerId: others[0] });
        else batch.update(ref, { members: arrayRemove(uid) });
    }
    batch.update(userRef, { clanId: deleteField() });
    await batch.commit();
}

/** Chef : exclure un membre */
export async function kickMember(ownerUid, clanId, memberUid) {
    const snap = await getDoc(doc(db, 'clans', clanId));
    if (snap.data()?.ownerId !== ownerUid) throw new Error("Seul le chef peut exclure un membre.");
    if (memberUid === ownerUid) throw new Error("Le chef ne peut pas s'exclure : quitte le clan.");
    const batch = writeBatch(db);
    batch.update(doc(db, 'clans', clanId), { members: arrayRemove(memberUid) });
    await batch.commit();
}

/** Chef : modifier la description */
export async function updateClanDescription(ownerUid, clanId, description) {
    const snap = await getDoc(doc(db, 'clans', clanId));
    if (snap.data()?.ownerId !== ownerUid) throw new Error("Seul le chef peut modifier le clan.");
    const batch = writeBatch(db);
    batch.update(doc(db, 'clans', clanId), { description: String(description || '').trim().slice(0, 120) });
    await batch.commit();
}

/** Membres avec leur niveau ; niveau du clan = somme des XP des membres */
export async function clanDetails(clan) {
    const snaps = await Promise.all(clan.members.map(m => getDoc(doc(db, 'users', m)).catch(() => null)));
    const members = snaps.filter(s => s?.exists()).map(s => {
        const u = s.data();
        const lv = playerLevel(u);
        return { uid: s.id, pseudo: u.pseudo || 'Joueur', level: lv.level, xp: lv.xp, lastOnline: u.lastOnline || null, owner: s.id === clan.ownerId, donations: u.stats?.clanDonations || 0 };
    }).sort((a, b) => (b.owner - a.owner) || b.xp - a.xp);
    const xp = members.reduce((n, m) => n + m.xp, 0);
    return { members, xp, level: Math.floor(Math.sqrt(xp / 200)) + 1 };
}

/** Classement des clans par XP totale de leurs membres */
export async function rankClans(clans) {
    const details = await Promise.all(clans.map(c => clanDetails(c).then(d => ({ ...c, xp: d.xp, level: d.level }))));
    return details.sort((a, b) => b.xp - a.xp);
}

/** Demander une carte au clan (1 par jour, pas de légendaire) */
export async function createCardRequest(uid, clanId, cardId) {
    const card = findCard(cardId);
    if (!card || card.upcoming) throw new Error("Carte inconnue.");
    if (!REQUEST_NEEDED[card.rarity]) throw new Error("Les légendaires ne peuvent pas être demandées.");
    const userRef = doc(db, 'users', uid);
    const user = (await getDoc(userRef)).data() || {};
    if (user.lastClanRequestDay === getDayKey()) throw new Error("Tu as déjà fait ta demande aujourd'hui. Reviens demain !");
    const clan = await getMyClan({ uid, ...user });
    if (!clan || clan.id !== clanId) throw new Error("Tu n'es pas dans ce clan.");
    const ref = doc(collection(db, 'clans', clanId, 'requests'));
    const batch = writeBatch(db);
    batch.set(ref, { uid, pseudo: user.pseudo || 'Joueur', cardId, needed: REQUEST_NEEDED[card.rarity], received: 0, donors: {}, createdAt: serverTimestamp() });
    batch.update(userRef, { lastClanRequestDay: getDayKey(), lastClanRequestAt: serverTimestamp() });
    await batch.commit();
    return ref.id;
}

/** Demandes des dernières 24 h (les plus récentes d'abord) */
export async function listCardRequests(clanId) {
    const snap = await getDocs(query(collection(db, 'clans', clanId, 'requests'), orderBy('createdAt', 'desc'), limit(40)));
    const now = Date.now();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(r => now - (r.createdAt?.toMillis?.() || now) < REQUEST_DURATION_MS);
}

/**
 * Donner un exemplaire (le donateur garde toujours au moins 1 exemplaire).
 * La carte va au demandeur, le donateur gagne des pièces et une statistique de dons.
 * @returns {Promise<number>} pièces gagnées
 */
export async function donateCard(donorUid, clanId, requestId) {
    const reqRef = doc(db, 'clans', clanId, 'requests', requestId);
    const donorRef = doc(db, 'users', donorUid);
    let reward = 0;
    await runTransaction(db, async (t) => {
        const reqSnap = await t.get(reqRef);
        if (!reqSnap.exists()) throw new Error("Demande introuvable.");
        const req = reqSnap.data();
        const clanSnap = await t.get(doc(db, 'clans', clanId));
        const donor = (await t.get(donorRef)).data() || {};
        const requesterRef = doc(db, 'users', req.uid);
        const requester = await t.get(requesterRef);
        if (req.uid === donorUid) throw new Error("Tu ne peux pas donner à ta propre demande.");
        if (!(clanSnap.data()?.members || []).includes(donorUid) || !(clanSnap.data()?.members || []).includes(req.uid)) throw new Error("Vous n'êtes plus dans le même clan.");
        if (Date.now() - (req.createdAt?.toMillis?.() || 0) > REQUEST_DURATION_MS) throw new Error("Cette demande a expiré.");
        if (req.received >= req.needed) throw new Error("Cette demande est déjà complète.");
        if ((donor.collection?.[req.cardId]?.quantity || 0) < 2) throw new Error("Il te faut au moins un double de cette carte pour la donner.");
        if (!requester.exists()) throw new Error("Ce joueur n'existe plus.");
        reward = DONATION_REWARD[findCard(req.cardId)?.rarity] || 5;
        t.update(reqRef, { received: increment(1), [`donors.${donorUid}`]: increment(1) });
        t.update(donorRef, { [`collection.${req.cardId}.quantity`]: increment(-1), coins: increment(reward), 'stats.clanDonations': increment(1) });
        t.update(requesterRef, { [`collection.${req.cardId}.quantity`]: increment(1), lastDeal: { kind: 'clanRequest', clan: clanId, id: requestId } });
    });
    return reward;
}
