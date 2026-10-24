// Fichier: battlepass-config.js — réglages du Passe de la semaine (change le lundi à 00h)
import { createSeededRandom } from './daily-utils.js';

export const XP_PER_LEVEL = 100;
export const MAX_LEVEL = 30;

// Cycle de 10 niveaux, répété 3 fois ; les pièces augmentent à chaque cycle.
function getRewardForStep(step) {
    const patternKey = (step - 1) % 10 + 1;
    const tier = Math.floor((step - 1) / 10); // 0, 1, 2
    const reward = { step };

    switch (patternKey) {
        case 3:
            reward.type = 'v3_booster';
            reward.value = 1;
            reward.description = 'Booster V3';
            break;
        case 7:
            reward.type = 'v2_booster';
            reward.value = 1;
            reward.description = 'Booster V2';
            break;
        case 5:
            reward.type = 'random_card';
            reward.rarity = 'Rare';
            reward.value = 1;
            reward.description = 'Carte Rare';
            break;
        case 9:
            reward.type = 'random_card';
            reward.rarity = 'epique';
            reward.value = 1;
            reward.description = 'Carte Épique';
            break;
        case 10:
            reward.type = 'v3_booster';
            reward.value = 3;
            reward.description = '3 Boosters V3';
            break;
        default:
            reward.type = 'coins';
            reward.value = 5 + tier * 5;
            reward.description = `+${reward.value} Pièces`;
            break;
    }
    return reward;
}

export const fullRewardsList = Array.from({ length: MAX_LEVEL }, (_, i) => getRewardForStep(i + 1));

export const REWARD_ICONS = {
    coins: '🪙',
    classic_booster: '🎴',
    v2_booster: '💠',
    legendary_booster: '🌟',
    v3_booster: '✨',
    random_card: '🃏'
};

// === QUÊTES DE LA SEMAINE (remises à zéro le lundi) ===
// xp : fait monter le Pass · coins : pièces gagnées en terminant la quête
// xp : fait monter le Pass · coins : pièces gagnées en terminant la quête
export const questsConfig = {
    q8: { description: "Effectuer 2 échanges avec un ami", target: 2, actionType: 'friend_trade', xp: 250, coins: 50 },
    q9: { description: "Gagner une enchère sur le marché", target: 1, actionType: 'win_bid', xp: 200, coins: 40 },
    q10: { description: "Vendre 2 cartes épiques à la console", target: 2, actionType: 'sell_epic_console', xp: 150, coins: 30 },
    q11: { description: "Vendre 1 carte légendaire à la console", target: 1, actionType: 'sell_legendary_console', xp: 200, coins: 40 },
    q12: { description: "Ouvrir 3 boosters V3", target: 3, actionType: 'open_v3_booster', xp: 150, coins: 30 },
    q13: { description: "Obtenir 10 cartes différentes en 24h", target: 10, actionType: 'obtain_10_diff_cards_24h', xp: 200, coins: 40 },
    q14: { description: "Se connecter 5 jours d'affilée", target: 5, actionType: 'daily_login_streak', xp: 300, coins: 60 },
    q15: { description: "Ouvrir 15 boosters", target: 15, actionType: 'open_booster', xp: 200, coins: 40 },
    q16: { description: "Acheter 5 articles à la boutique", target: 5, actionType: 'shop_buy', xp: 200, coins: 40 }
};

// === QUÊTES DU JOUR (changent tous les jours à 00h) ===
// La connexion est toujours proposée, + 2 quêtes tirées au hasard dans la liste.
export const DAILY_LOGIN_QUEST_ID = 'd_login';
export const dailyQuestPool = {
    d_login: { description: "Se connecter aujourd'hui", target: 1, actionType: 'daily_login_streak', xp: 50, coins: 5 },
    d_open3: { description: "Ouvrir 3 boosters", target: 3, actionType: 'open_booster', xp: 80, coins: 10 },
    d_open5: { description: "Ouvrir 4 boosters", target: 4, actionType: 'open_booster', xp: 110, coins: 15 },
    d_v3: { description: "Ouvrir 1 booster V3", target: 1, actionType: 'open_v3_booster', xp: 70, coins: 10 },
    d_shop: { description: "Acheter 1 article à la boutique", target: 1, actionType: 'shop_buy', xp: 70, coins: 10 },
    d_sell: { description: "Vendre 2 cartes à la console", target: 2, actionType: 'sell_console', xp: 70, coins: 10 },
    d_bid: { description: "Placer 1 enchère au marché", target: 1, actionType: 'place_bid', xp: 90, coins: 20 },
    d_auction: { description: "Mettre 1 carte aux enchères", target: 1, actionType: 'create_auction', xp: 80, coins: 15 }
};

/** Les 3 quêtes du jour (identiques pour tous les joueurs ce jour-là). */
export function getDailyQuestIds(dayKey) {
    const rand = createSeededRandom(`quests-${dayKey}`);
    const pool = Object.keys(dailyQuestPool).filter(id => id !== DAILY_LOGIN_QUEST_ID);
    const picked = [];
    while (picked.length < 2 && pool.length) {
        const id = pool.splice(Math.floor(rand() * pool.length), 1)[0];
        // Pas deux quêtes "ouvrir des boosters" le même jour
        if (picked.some(p => dailyQuestPool[p].actionType === dailyQuestPool[id].actionType)) continue;
        picked.push(id);
    }
    return [DAILY_LOGIN_QUEST_ID, ...picked];
}

export function getLevel(xp) {
    return Math.min(MAX_LEVEL, Math.floor((xp || 0) / XP_PER_LEVEL));
}
