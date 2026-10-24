// Fichier: scripts/give-logic.mjs
// Cadeau à TOUS les joueurs (même déconnectés), lancé à la main depuis GitHub Actions
// (onglet Actions → « Cadeau à tous les joueurs » → Run workflow).
// Les objets sont ajoutés directement dans chaque compte ; le joueur voit un message
// « 🎁 Cadeau reçu » à sa prochaine connexion (champ giftInbox, lu par auth-manager.js).

// [singulier, pluriel]
export const BOOSTER_NAMES = {
    classic: ['Booster Classique', 'Boosters Classiques'], legendary: ['Booster Légendaire', 'Boosters Légendaires'],
    v2: ['Booster V2', 'Boosters V2'], v3: ['Booster V3', 'Boosters V3'],
    v3_legendary: ['Booster Légendaire V3', 'Boosters Légendaires V3']
};
export const DISPLAY_NAMES = {
    classic: ['Display Classique', 'Displays Classiques'], v2: ['Display V2', 'Displays V2'],
    v3: ['Display V3', 'Displays V3'], legendary: ['Coffret Légendaire', 'Coffrets Légendaires']
};
const MAX_PER_ITEM = 1000;

/**
 * Identifiants de cartes qu'on peut donner, lus dans le texte des fichiers de cartes du jeu
 * (cards.js, cards1.js, cards-v3.js). Les cartes « à venir » (upcoming: true) sont exclues.
 */
export function readCardIds(sources) {
    const ids = new Set();
    for (const src of sources) {
        for (const line of src.split('\n')) {
            for (const m of line.matchAll(/id:\s*'([^']+)'/g)) if (!/upcoming:\s*true/.test(line)) ids.add(m[1]);
        }
    }
    return ids;
}

/** « v3:2, v2:1 » → { v3: 2, v2: 1 } (vide → {}) */
function parseList(text, allowed, label) {
    const out = {};
    for (const part of String(text || '').split(',').map(s => s.trim()).filter(Boolean)) {
        const m = part.match(/^([A-Za-z0-9_]+)\s*(?::\s*(\d+))?$/);
        if (!m) throw new Error(`${label} : « ${part} » n'est pas au bon format (exemple : v3:2).`);
        const [, key, n = '1'] = m;
        if (!allowed(key)) throw new Error(`${label} : « ${key} » n'existe pas.`);
        const qty = Number(n);
        if (qty < 1 || qty > MAX_PER_ITEM) throw new Error(`${label} : quantité invalide pour ${key} (1 à ${MAX_PER_ITEM}).`);
        out[key] = (out[key] || 0) + qty;
    }
    return out;
}

/**
 * Lit les champs du formulaire GitHub et vérifie tout avant de toucher à la base.
 * @param {{coins?, boosters?, displays?, cards?, message?}} input
 * @param {Set<string>} knownCardIds - identifiants de cartes existants
 */
export function parseGift(input, knownCardIds) {
    const coins = Number(String(input.coins || '0').trim() || 0);
    if (!Number.isInteger(coins) || coins < 0 || coins > 100000) throw new Error('Pièces : mets un nombre entier entre 0 et 100000.');
    const gift = {
        coins,
        boosters: parseList(input.boosters, k => k in BOOSTER_NAMES, 'Boosters'),
        displays: parseList(input.displays, k => k in DISPLAY_NAMES, 'Displays'),
        cards: parseList(input.cards, k => knownCardIds.has(k), 'Cartes'),
        message: String(input.message || '').trim().slice(0, 200) || "Cadeau de l'équipe JWBnDr !"
    };
    if (!gift.coins && !Object.keys(gift.boosters).length && !Object.keys(gift.displays).length && !Object.keys(gift.cards).length) {
        throw new Error('Le cadeau est vide : indique au moins des pièces, des boosters, des displays ou des cartes.');
    }
    return gift;
}

/** Texte lisible du contenu : « 100 pièces, 2 Boosters V3, 1 carte (V3_010) » */
export function describeGift(gift) {
    const named = (n, [one, many]) => `${n} ${n > 1 ? many : one}`;
    const parts = [];
    if (gift.coins) parts.push(`${gift.coins} pièce${gift.coins > 1 ? 's' : ''}`);
    for (const [k, n] of Object.entries(gift.boosters)) parts.push(named(n, BOOSTER_NAMES[k]));
    for (const [k, n] of Object.entries(gift.displays)) parts.push(named(n, DISPLAY_NAMES[k]));
    for (const [k, n] of Object.entries(gift.cards)) parts.push(`${n} carte${n > 1 ? 's' : ''} ${k}`);
    return parts.join(', ');
}

/** Champs à mettre à jour sur chaque compte */
export function giftUpdates(gift, FieldValue, entry) {
    const inc = (n) => FieldValue.increment(n);
    const updates = {};
    if (gift.coins) updates.coins = inc(gift.coins);
    for (const [k, n] of Object.entries(gift.boosters)) updates[`boosterInventory.${k}`] = inc(n);
    for (const [k, n] of Object.entries(gift.displays)) updates[`displayInventory.${k}`] = inc(n);
    for (const [k, n] of Object.entries(gift.cards)) updates[`collection.${k}.quantity`] = inc(n);
    updates.giftInbox = FieldValue.arrayUnion(entry);
    return updates;
}

/**
 * Donne le cadeau à tous les comptes de la collection users.
 * @param {{db, FieldValue, gift, dryRun?: boolean, log?}} deps
 * @returns {Promise<number>} nombre de joueurs servis (ou qui le seraient, en mode test)
 */
export async function giveToAllPlayers({ db, FieldValue, gift, dryRun = false, log = console.log }) {
    const users = await db.collection('users').get();
    const text = describeGift(gift);
    log(`Cadeau : ${text} — « ${gift.message} »`);
    if (dryRun) {
        log(`Mode test : rien n'a été donné. ${users.docs.length} joueur(s) l'auraient reçu.`);
        return users.docs.length;
    }
    const entry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, message: gift.message, text, at: Date.now() };
    const updates = giftUpdates(gift, FieldValue, entry);
    // Firestore limite un lot à 500 écritures
    for (let i = 0; i < users.docs.length; i += 400) {
        const batch = db.batch();
        for (const d of users.docs.slice(i, i + 400)) batch.update(d.ref, updates);
        await batch.commit();
    }
    log(`Terminé : ${users.docs.length} joueur(s) ont reçu le cadeau.`);
    return users.docs.length;
}
