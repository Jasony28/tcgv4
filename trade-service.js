// Fichier: trade-service.js — amis et échanges entre amis (sans interface, testable)
import {
    collection, query, where, getDocs, doc, getDoc, updateDoc, addDoc,
    runTransaction, increment, arrayUnion, arrayRemove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';

export const BOOSTER_TYPES = ['classic', 'v2', 'v3', 'legendary', 'v3_legendary'];
export const EMPTY_OFFER = () => ({ cards: {}, coins: 0, boosters: { classic: 0, v2: 0, v3: 0, legendary: 0, v3_legendary: 0 } });

// ---------------- AMIS ----------------

/**
 * Envoie une demande d'ami par pseudo. Si l'autre joueur m'avait déjà envoyé une demande,
 * on devient amis directement.
 * @returns {Promise<{status:'sent'|'accepted', friendUid:string, pseudo:string}>}
 */
export async function sendFriendRequest(me, rawPseudo) {
    const typed = (rawPseudo || '').trim();
    if (!typed) throw new Error("Entre un pseudo.");
    const friendDoc = await findPlayerByPseudo(typed);
    const friendUid = friendDoc.id;
    const pseudo = friendDoc.data().pseudo || typed;
    if (friendUid === me.uid) throw new Error("Impossible de s'ajouter soi-même !");

    const meSnap = await getDoc(doc(db, "users", me.uid));
    const myData = meSnap.data() || {};
    if ((myData.friends || []).includes(friendUid)) throw new Error("Ce joueur est déjà ton ami !");

    // Il m'a déjà demandé : on accepte directement
    if ((myData.friendRequests || []).includes(friendUid)) {
        await acceptFriendRequest(me.uid, friendUid);
        return { status: 'accepted', friendUid, pseudo };
    }
    if ((friendDoc.data().friendRequests || []).includes(me.uid)) throw new Error("Demande déjà envoyée, en attente d'acceptation.");

    await updateDoc(doc(db, "users", friendUid), { friendRequests: arrayUnion(me.uid) });
    return { status: 'sent', friendUid, pseudo };
}

/** « Benjamin » = « benjamin » = « Bénjamin  » : sans majuscules, accents ni espaces en trop */
export const normalizePseudo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

/** Numéro à 4 chiffres tiré de l'identifiant du compte (toujours le même, rien à stocker) */
export function friendTag(uid) {
    let h = 7;
    for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return String(h % 10000).padStart(4, '0');
}
/** Code ami affiché et partagé : « Jason#4821 » */
export const friendCode = (pseudo, uid) => `${pseudo}#${friendTag(uid)}`;

/**
 * Trouve un joueur par code ami (« Jason#4821 ») ou par pseudo : d'abord le pseudo exact, sinon sans
 * tenir compte des majuscules, accents et espaces. Si rien ne correspond, propose les pseudos proches.
 */
async function findPlayerByPseudo(typed) {
    const code = typed.match(/^(.+?)\s*#\s*(\d{4})$/);
    if (code) {
        const all = (await getDocs(collection(db, "users"))).docs;
        const found = all.find(d => normalizePseudo(d.data().pseudo) === normalizePseudo(code[1]) && friendTag(d.id) === code[2]);
        if (!found) throw new Error(`Aucun joueur avec le code « ${typed} ». Vérifie le pseudo et les 4 chiffres.`);
        return found;
    }
    const exact = await getDocs(query(collection(db, "users"), where("pseudo", "==", typed)));
    if (!exact.empty) return exact.docs[0];

    const wanted = normalizePseudo(typed);
    const all = (await getDocs(collection(db, "users"))).docs.filter(d => d.data().pseudo);
    const matches = all.filter(d => normalizePseudo(d.data().pseudo) === wanted);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
        throw new Error(`Plusieurs joueurs s'appellent comme ça : utilise leur code ami (${matches.map(d => friendCode(d.data().pseudo, d.id)).join(', ')}).`);
    }
    const close = all.map(d => d.data().pseudo)
        .filter(p => normalizePseudo(p).includes(wanted) || wanted.includes(normalizePseudo(p)))
        .slice(0, 3);
    throw new Error(close.length
        ? `Aucun joueur « ${typed} ». Tu voulais dire : ${close.join(', ')} ?`
        : `Aucun joueur trouvé avec le pseudo « ${typed} ». Vérifie l'orthographe (son pseudo est affiché en haut de son écran).`);
}

/**
 * Suggestions d'amis : d'abord les amis de mes amis, puis les joueurs vus le plus récemment.
 * Exclut moi, mes amis, les demandes en cours (dans les deux sens).
 * @returns {Promise<Array<{uid, pseudo, code, mutual:number}>>}
 */
export async function getFriendSuggestions(me, limit = 5) {
    const all = (await getDocs(collection(db, "users"))).docs;
    const mine = all.find(d => d.id === me.uid)?.data() || me;
    const myFriends = new Set(mine.friends || []);
    const asked = new Set(mine.friendRequests || []);
    const seen = (u) => u.lastOnline?.toMillis?.() || 0;
    return all
        .filter(d => d.id !== me.uid && d.data().pseudo && !myFriends.has(d.id) && !asked.has(d.id)
            && !(d.data().friendRequests || []).includes(me.uid))
        .map(d => ({ uid: d.id, pseudo: d.data().pseudo, code: friendCode(d.data().pseudo, d.id),
            mutual: (d.data().friends || []).filter(f => myFriends.has(f)).length, seen: seen(d.data()) }))
        .sort((a, b) => b.mutual - a.mutual || b.seen - a.seen)
        .slice(0, limit);
}

export async function acceptFriendRequest(myUid, requesterUid) {
    await updateDoc(doc(db, "users", myUid), { friends: arrayUnion(requesterUid), friendRequests: arrayRemove(requesterUid) });
    // On nettoie aussi une éventuelle demande croisée de l'autre côté
    await updateDoc(doc(db, "users", requesterUid), { friends: arrayUnion(myUid), friendRequests: arrayRemove(myUid) });
}

export async function refuseFriendRequest(myUid, requesterUid) {
    await updateDoc(doc(db, "users", myUid), { friendRequests: arrayRemove(requesterUid) });
}

export async function removeFriend(myUid, friendUid) {
    await updateDoc(doc(db, "users", myUid), { friends: arrayRemove(friendUid) });
    await updateDoc(doc(db, "users", friendUid), { friends: arrayRemove(myUid) });
}

// ---------------- ÉCHANGES ENTRE AMIS ----------------

export async function createTradeRequest(myUid, friendUid) {
    const meSnap = await getDoc(doc(db, "users", myUid));
    if (!(meSnap.data()?.friends || []).includes(friendUid)) throw new Error("Tu ne peux échanger qu'avec tes amis.");
    const ref = await addDoc(collection(db, "tradeRequests"), {
        from: myUid,
        to: friendUid,
        status: "pending",
        createdAt: serverTimestamp(),
        offerA: EMPTY_OFFER(),
        offerB: EMPTY_OFFER(),
        readyA: false,
        readyB: false
    });
    return ref.id;
}

/** Offre propre (valeurs entières >= 0, champs manquants complétés). */
export function normalizeOffer(offer) {
    const out = EMPTY_OFFER();
    for (const [id, n] of Object.entries(offer?.cards || {})) {
        const q = Math.floor(n);
        if (q > 0) out.cards[id] = q;
    }
    out.coins = Math.max(0, Math.floor(offer?.coins || 0));
    for (const t of BOOSTER_TYPES) out.boosters[t] = Math.max(0, Math.floor(offer?.boosters?.[t] || 0));
    return out;
}

/** Vérifie qu'un joueur possède ce qu'il propose. Pour les cartes, il doit en garder une. Renvoie un message ou null. */
export function checkOfferAffordable(userData, offer, label = 'Tu') {
    const o = normalizeOffer(offer);
    for (const [id, q] of Object.entries(o.cards)) {
        if ((userData.collection?.[id]?.quantity || 0) - 1 < q) return `${label} n'a plus assez de doubles pour une carte.`;
    }
    for (const t of BOOSTER_TYPES) {
        if ((userData.boosterInventory?.[t] || 0) < o.boosters[t]) return `${label} n'a plus assez de boosters.`;
    }
    if ((userData.coins || 0) < o.coins) return `${label} n'a plus assez de pièces.`;
    return null;
}

/**
 * Valide l'échange : les deux offres sont transférées en une seule transaction.
 * Protégé contre la double validation (les deux joueurs qui cliquent en même temps).
 */
export async function validateTrade(tradeId) {
    const tradeRef = doc(db, "tradeRequests", tradeId);
    await runTransaction(db, async (transaction) => {
        const tradeSnap = await transaction.get(tradeRef);
        if (!tradeSnap.exists()) throw new Error("Échange introuvable.");
        const trade = tradeSnap.data();
        if (trade.status !== 'accepted') throw new Error(trade.status === 'completed' ? "Échange déjà effectué." : "Cet échange n'est plus actif.");
        if (!trade.readyA || !trade.readyB) throw new Error("Les deux joueurs doivent être prêts.");

        const userARef = doc(db, "users", trade.from);
        const userBRef = doc(db, "users", trade.to);
        const userASnap = await transaction.get(userARef);
        const userBSnap = await transaction.get(userBRef);
        if (!userASnap.exists() || !userBSnap.exists()) throw new Error("Un des joueurs n'existe plus.");

        const offerA = normalizeOffer(trade.offerA);
        const offerB = normalizeOffer(trade.offerB);
        const errA = checkOfferAffordable(userASnap.data(), offerA, userASnap.data().pseudo || 'Le joueur A');
        const errB = checkOfferAffordable(userBSnap.data(), offerB, userBSnap.data().pseudo || 'Le joueur B');
        if (errA || errB) throw new Error(errA || errB);

        // Variation nette pour A (B reçoit l'inverse) : évite les écritures qui s'écrasent
        const delta = {};
        const add = (field, n) => { delta[field] = (delta[field] || 0) + n; };
        for (const [id, q] of Object.entries(offerA.cards)) add(`collection.${id}.quantity`, -q);
        for (const [id, q] of Object.entries(offerB.cards)) add(`collection.${id}.quantity`, q);
        for (const t of BOOSTER_TYPES) add(`boosterInventory.${t}`, offerB.boosters[t] - offerA.boosters[t]);
        add('coins', offerB.coins - offerA.coins);

        const updatesA = {}, updatesB = {};
        for (const [field, d] of Object.entries(delta)) {
            if (d === 0) continue;
            updatesA[field] = increment(d);
            updatesB[field] = increment(-d);
        }
        // lastDeal : les règles Firestore vérifient que l'échange passe à « completed » dans la même transaction
        const lastDeal = { kind: 'trade', id: tradeId };
        if (Object.keys(updatesA).length) transaction.update(userARef, { ...updatesA, lastDeal });
        if (Object.keys(updatesB).length) transaction.update(userBRef, { ...updatesB, lastDeal });
        transaction.update(tradeRef, { status: "completed" });
    });
}
