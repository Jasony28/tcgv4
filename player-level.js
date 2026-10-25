// Fichier: player-level.js — niveau global du joueur (différent du Pass, qui repart à zéro chaque semaine)
// Calculé à partir de ce que le joueur a déjà fait : rien de plus à enregistrer, rien à tricher.
import { countClaimedAchievements } from './achievements-config.js';

// XP gagnée par action
export const XP_RULES = [
    { key: 'boosters', label: 'Booster ouvert', xp: 10 },
    { key: 'cards', label: 'Carte différente possédée', xp: 5 },
    { key: 'market', label: 'Vente à l\'Hôtel des Ventes', xp: 25 },
    { key: 'console', label: 'Carte vendue à la console', xp: 2 },
    { key: 'trades', label: 'Échange avec un ami', xp: 40 },
    { key: 'achievements', label: 'Succès obtenu', xp: 100 }
];
export const MAX_PLAYER_LEVEL = 99;

/** Compteurs du joueur pour chaque source d'XP */
export function xpCounters(userData) {
    const s = userData?.stats || {};
    return {
        boosters: s.boostersOpened || 0,
        cards: Object.values(userData?.collection || {}).filter(c => c?.quantity > 0).length,
        market: s.cardsSoldMarket || 0,
        console: s.cardsSoldConsole || 0,
        trades: s.friendTrades || 0,
        achievements: countClaimedAchievements(userData)
    };
}

export function playerXp(userData) {
    const c = xpCounters(userData);
    return XP_RULES.reduce((sum, r) => sum + c[r.key] * r.xp, 0);
}

/** XP totale nécessaire pour atteindre un niveau : 0, 50, 200, 450, 800… (chaque niveau un peu plus long) */
export const xpForLevel = (level) => 50 * (level - 1) ** 2;

/** { level, xp, current, needed, pct } — current/needed : progression dans le niveau en cours */
export function playerLevel(userData) {
    const xp = playerXp(userData);
    const level = Math.min(MAX_PLAYER_LEVEL, Math.floor(Math.sqrt(xp / 50)) + 1);
    const base = xpForLevel(level), next = xpForLevel(level + 1);
    const current = xp - base, needed = next - base;
    return { level, xp, current, needed, pct: level >= MAX_PLAYER_LEVEL ? 100 : Math.round(current / needed * 100) };
}
