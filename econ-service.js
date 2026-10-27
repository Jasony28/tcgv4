// Fichier: econ-service.js — écritures de l'économie conformes au garde-fou anti-triche (voir econ-config.js)
import { doc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { DAILY_GAIN_LIMIT, MAX_ECON_CARDS, econGain, econDay, cardRarityKey } from './econ-config.js';

/**
 * Écrit sur le compte du joueur (dans une transaction) des mouvements de l'économie, avec les champs
 * qu'attendent les règles : econ.day / econ.used (gains du jour) et, si des cartes bougent, un « reçu »
 * econ/{uid} qui liste ces cartes par rareté (les règles le vérifient à part, carte par carte).
 * @param {object} t - la transaction (ou un lot writeBatch)
 * @param {object} userRef - le compte
 * @param {object} userData - le compte lu dans la même transaction
 * @param {object} deltas - { 'coins': n, 'collection.ID.quantity': n, 'boosterInventory.T': n, 'displayInventory.T': n }
 * @param {object} [extra] - autres champs à écrire tels quels
 * @param {number} [bonus] - valeur déjà vérifiée par les règles (récompense de succès)
 */
export function econWrite(t, userRef, userData, deltas, extra = {}, bonus = 0) {
    const updates = { ...extra };
    for (const [field, n] of Object.entries(deltas)) if (n) updates[field] = increment(n);
    const { gain, cardsGain, cards } = econGain(deltas);
    if (cards.length > MAX_ECON_CARDS) throw new Error("Trop de cartes différentes en une seule fois.");
    const net = gain - bonus;
    if (net > 0) {
        const day = econDay();
        const e = userData?.econ || {};
        const used = (e.day === day ? (e.used || 0) : 0) + net;
        if (used > DAILY_GAIN_LIMIT) throw new Error("Limite de gains du jour atteinte : reviens demain !");
        updates['econ.day'] = day;
        updates['econ.used'] = used;
    }
    t.update(userRef, updates);
    if (cards.length) {
        const byRarity = { c: [], r: [], e: [], l: [] };
        for (const id of cards) byRarity[cardRarityKey(id)].push(id);
        t.set(doc(db, 'econ', userRef.id), { at: serverTimestamp(), cards: byRarity, gain: cardsGain });
    }
}

/**
 * Écriture faite dans le cadre d'une affaire entre joueurs (enchère, échange, don de clan) :
 * les règles vérifient alors, au chiffre près, ce que chaque joueur donne et reçoit.
 */
export const dealStamp = (kind, id, extra = {}) => ({ kind, id, ...extra, at: serverTimestamp() });
