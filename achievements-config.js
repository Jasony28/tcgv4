// Fichier: achievements-config.js — succès d'album (compléter une rareté ou un album entier)
// Modifie les récompenses ici. Une récompense = { coins, classic, v2, legendary } (boosters).
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';

const SETS = {
    v1: { label: 'V1', cards: allCards },
    v2: { label: 'V2', cards: allCardsV2 }
};

const RARITIES = [
    { rarity: 'Commune', slug: 'commune', label: 'communes', icon: '⚪' },
    { rarity: 'Rare', slug: 'rare', label: 'rares', icon: '🔷' },
    { rarity: 'epique', slug: 'epique', label: 'épiques', icon: '💜' },
    { rarity: 'Légendaire', slug: 'legendaire', label: 'légendaires', icon: '👑' }
];

const TITLES = {
    commune: 'Collectionneur du dimanche',
    rare: 'Chasseur de rares',
    epique: 'Épique en puissance',
    legendaire: 'Panthéon',
    album: 'Album complet'
};

const REWARDS = {
    v1: {
        commune: { coins: 30 },
        rare: { coins: 50, classic: 1 },
        epique: { coins: 40, legendary: 1 },
        legendaire: { coins: 150, legendary: 1 },
        album: { coins: 300, legendary: 2 }
    },
    v2: {
        commune: { coins: 20 },
        rare: { coins: 30, v2: 1 },
        epique: { coins: 30, v2: 1 },
        legendaire: { coins: 150, legendary: 1 },
        album: { coins: 300, v2: 2, legendary: 1 }
    }
};

export const ACHIEVEMENTS = [];

for (const [setKey, set] of Object.entries(SETS)) {
    for (const r of RARITIES) {
        const cardIds = set.cards.filter(c => c.rarity === r.rarity).map(c => c.id);
        if (cardIds.length === 0) continue;
        ACHIEVEMENTS.push({
            id: `${setKey}_${r.slug}`,
            tier: r.slug,
            icon: r.icon,
            title: `${TITLES[r.slug]} ${set.label}`,
            description: `Posséder toutes les cartes ${r.label} de l'album ${set.label}`,
            cardIds,
            reward: REWARDS[setKey][r.slug]
        });
    }
    ACHIEVEMENTS.push({
        id: `${setKey}_album`,
        tier: 'album',
        icon: setKey === 'v1' ? '📘' : '📗',
        title: `${TITLES.album} ${set.label}`,
        description: `Posséder les ${set.cards.length} cartes de l'album ${set.label}`,
        cardIds: set.cards.map(c => c.id),
        reward: REWARDS[setKey].album
    });
}

ACHIEVEMENTS.push({
    id: 'all_albums',
    tier: 'ultime',
    icon: '🏆',
    title: 'Légende vivante',
    description: 'Compléter les albums V1 et V2',
    cardIds: [...allCards, ...allCardsV2].map(c => c.id),
    reward: { coins: 500, legendary: 3 }
});

/** "+150 pièces · 1 Booster Légendaire" */
export function rewardText(reward) {
    const parts = [];
    if (reward.coins) parts.push(`+${reward.coins} pièces`);
    if (reward.classic) parts.push(`${reward.classic} Booster Classique`);
    if (reward.v2) parts.push(`${reward.v2} Booster V2`);
    if (reward.legendary) parts.push(`${reward.legendary} Booster${reward.legendary > 1 ? 's' : ''} Légendaire${reward.legendary > 1 ? 's' : ''}`);
    return parts.join(' · ');
}

/**
 * État de chaque succès pour un joueur.
 * unlocked = toutes les cartes possédées actuellement ; claimed = récompense déjà prise (badge définitif).
 */
export function getAchievementsStatus(userData) {
    const collection = userData?.collection || {};
    const claimedMap = userData?.achievements || {};
    return ACHIEVEMENTS.map(a => {
        const owned = a.cardIds.filter(id => collection[id]?.quantity > 0).length;
        const claimed = !!claimedMap[a.id]?.claimed;
        return { ...a, owned, total: a.cardIds.length, unlocked: owned === a.cardIds.length, claimed };
    });
}

export function countClaimedAchievements(userData) {
    return Object.values(userData?.achievements || {}).filter(a => a?.claimed).length;
}
