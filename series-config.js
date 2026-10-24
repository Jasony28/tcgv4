// Fichier: series-config.js — vie des séries (comme les extensions Pokémon)
//
// Chaque série a une date de sortie et une date de fin (heure de Paris, 'AAAA-MM-JJ', ou null = pas de date).
//  - Avant la sortie : la série n'existe pas encore en jeu.
//  - Pendant : boosters en boutique, boosters gratuits du jour, récompenses, cartes du jour…
//  - Après la fin : PLUS AUCUN booster de la série n'est produit (ni boutique, ni gratuits, ni récompenses).
//    Les boosters et displays déjà possédés restent ouvrables… ou à garder fermés et à revendre au marché :
//    comme il n'en sort plus, ils deviennent rares.
//
// Exemple pour arrêter la V1 le 31 décembre 2026 : v1: { ..., end: '2026-12-31' }
import { getDayKey } from './daily-utils.js';
import { V3_RELEASED } from './cards-v3.js';

export const SERIES = {
    v1: { name: 'Série V1', boosterTypes: ['classic', 'legendary'], release: '2025-06-21', end: '2026-10-23' },
    v2: { name: 'Série V2', boosterTypes: ['v2'], release: '2025-06-21', end: '2026-10-31' },
    v3: { name: 'Série V3', boosterTypes: ['v3', 'v3_legendary'], release: '2026-10-24', end: null }
};

// Valeur en pièces d'un booster quand une récompense prévoit un booster d'une série terminée
export const BOOSTER_COIN_VALUE = { classic: 20, v2: 30, v3: 35, legendary: 90, v3_legendary: 120 };

/** Série d'un type de booster ('classic' → 'v1') */
export function seriesOfBooster(boosterType) {
    return Object.keys(SERIES).find(k => SERIES[k].boosterTypes.includes(boosterType)) || 'v1';
}
/** Série d'une carte (les cartes V1 n'ont pas de champ version) */
export const seriesOfCard = (card) => card?.version || 'v1';

/** 'upcoming' (pas encore sortie), 'active' (en cours) ou 'ended' (terminée) */
export function seriesStatus(key, day = getDayKey()) {
    const s = SERIES[key];
    if (!s) return 'ended';
    if (key === 'v3' && !V3_RELEASED) return 'upcoming';
    if (s.release && day < s.release) return 'upcoming';
    if (s.end && day > s.end) return 'ended';
    return 'active';
}

/** Ce booster est-il encore produit (vendu, offert, donné en récompense) ? */
export const isBoosterProduced = (boosterType, day) => seriesStatus(seriesOfBooster(boosterType), day) === 'active';
/** Cette carte peut-elle encore apparaître dans la boutique du jour ? */
export const isCardProduced = (card, day) => seriesStatus(seriesOfCard(card), day) === 'active';

/** Nombre de jours avant la fin de la série (null si pas de date de fin ou déjà finie) */
export function daysUntilEnd(key, day = getDayKey()) {
    const end = SERIES[key]?.end;
    if (!end || day > end) return null;
    const toUTC = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
    return Math.round((toUTC(end) - toUTC(day)) / 86400000);
}

/**
 * Récompense en boosters : les boosters d'une série terminée sont remplacés par leur valeur en pièces.
 * @returns {{boosters: object, coins: number}}
 */
export function convertEndedBoosters(boosters, day) {
    const kept = {};
    let coins = 0;
    for (const [type, n] of Object.entries(boosters || {})) {
        if (!n) continue;
        if (isBoosterProduced(type, day)) kept[type] = n;
        else coins += n * (BOOSTER_COIN_VALUE[type] || 20);
    }
    return { boosters: kept, coins };
}

/**
 * Booster gratuit « principal » du jour (3 par jour, compteur dailyBoosterOpenedCount) :
 * celui de la V1 tant qu'elle est en cours, puis celui de la V3. null s'il n'y en a plus.
 */
export function mainDailyBoosterType(day = getDayKey()) {
    if (isBoosterProduced('classic', day)) return 'classic';
    if (isBoosterProduced('v3', day)) return 'v3';
    return null;
}

const toUTC = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** '2026-11-01' → '1er novembre' */
export function frenchDate(dayKey) {
    const [, m, d] = dayKey.split('-').map(Number);
    return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]}`;
}
/** Lendemain d'une date 'AAAA-MM-JJ' (premier jour sans production après une fin de série) */
const nextDay = (dayKey) => new Date(toUTC(dayKey) + 86400000).toISOString().slice(0, 10);

/**
 * Annonces de séries à afficher aux joueurs (page Booster, boutique) :
 * nouvelle série (7 jours), série qui se termine bientôt, série terminée depuis peu (7 jours).
 * @returns {Array<{kind:'new'|'ending'|'ended', series:string, text:string}>}
 */
export function seriesAnnouncements(day = getDayKey()) {
    const out = [];
    const since = (d) => Math.round((toUTC(day) - toUTC(d)) / 86400000);
    for (const [key, s] of Object.entries(SERIES)) {
        const status = seriesStatus(key, day);
        if (status === 'active' && s.release && since(s.release) < 7) {
            out.push({ kind: 'new', series: key, text: `✨ La <strong>${s.name}</strong> est sortie ! Nouvelles cartes, nouveaux boosters et boosters gratuits chaque jour.` });
        }
        if (status === 'active' && s.end) {
            const days = daysUntilEnd(key, day);
            out.push({ kind: 'ending', series: key, text: `⏳ Fin de la <strong>${s.name}</strong> le ${frenchDate(nextDay(s.end))}${days === 0 ? " (dernier jour aujourd'hui)" : ` (dans ${days + 1} jour${days ? 's' : ''})`} : ses boosters et displays ne seront plus vendus ni donnés. Ceux que tu as déjà restent à toi : garde-les fermés, ils deviendront rares !` });
        }
        if (status === 'ended' && s.end && since(s.end) <= 7) {
            out.push({ kind: 'ended', series: key, text: `💎 La <strong>${s.name}</strong> est terminée : plus aucun booster n'est produit. Les boosters et displays fermés deviennent des objets de collection, à ouvrir ou à vendre au marché.` });
        }
    }
    const order = { new: 0, ending: 1, ended: 2 };
    return out.sort((x, y) => order[x.kind] - order[y.kind]);
}
