// Fichier: daily-utils.js
// Le jeu vit à l'heure de Paris : la boutique et les quêtes du jour changent à 00h,
// le Battle Pass change le lundi à 00h, pour tous les joueurs en même temps.

const TIME_ZONE = 'Europe/Paris';

const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
});

function parisParts(date = new Date()) {
    const parts = {};
    for (const p of formatter.formatToParts(date)) parts[p.type] = p.value;
    return {
        year: +parts.year, month: +parts.month, day: +parts.day,
        hour: +parts.hour, minute: +parts.minute, second: +parts.second
    };
}

/** Clé du jour à Paris, ex: "2026-10-23". */
export function getDayKey(date = new Date()) {
    const p = parisParts(date);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Clé de la semaine ISO à Paris, ex: "2026-W43" (change le lundi à 00h). */
export function getWeekKey(date = new Date()) {
    const p = parisParts(date);
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    const dayNum = d.getUTCDay() || 7; // lundi = 1 ... dimanche = 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Millisecondes avant le prochain minuit (heure de Paris). */
export function msUntilNextDay(date = new Date()) {
    const p = parisParts(date);
    const elapsed = (p.hour * 3600 + p.minute * 60 + p.second) * 1000 + date.getMilliseconds();
    return Math.max(0, 86400000 - elapsed);
}

/** Millisecondes avant lundi 00h (heure de Paris). */
export function msUntilNextWeek(date = new Date()) {
    const p = parisParts(date);
    const dayNum = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() || 7;
    return msUntilNextDay(date) + (7 - dayNum) * 86400000;
}

/** "5h 12m", "3j 4h", "12m 08s" */
export function formatDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return `${d}j ${h}h`;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/**
 * Générateur aléatoire déterministe : la même graine donne toujours la même suite.
 * Sert à ce que tout le monde voie la même boutique / les mêmes quêtes le même jour.
 */
export function createSeededRandom(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
