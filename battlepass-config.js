function getRewardForStep(step) {
    const patternKey = (step - 1) % 10 + 1;
    let reward = { step: step };

    switch (patternKey) {
        case 3:
        case 6:
            reward.type = 'classic_booster';
            reward.value = 1;
            reward.description = 'Booster Classique';
            break;
        case 10:
            reward.type = 'legendary_booster';
            reward.value = 1;
            reward.description = 'Booster Légendaire';
            break;
        default:
            reward.type = 'coins';
            reward.value = 5;
            reward.description = '+5 Pièces';
            break;
    }
    return reward;
}

export const fullRewardsList = Array.from({ length: 30 }, (_, i) => getRewardForStep(i + 1));

// === TES 7 QUÊTES 100% PRÊTES ===
export const questsConfig = {
    q8: { description: "Effectuer 2 échanges avec un ami", target: 2, actionType: 'friend_trade' },
    q9: { description: "Gagner une enchère sur le marché", target: 1, actionType: 'win_bid' },
    q10: { description: "Vendre 2 cartes épiques à la console", target: 2, actionType: 'sell_epic_console' },
    q11: { description: "Vendre 1 carte légendaire à la console", target: 1, actionType: 'sell_legendary_console' },
    q12: { description: "Ouvrir 1 booster légendaire", target: 1, actionType: 'open_legendary_booster' },
    q13: { description: "Obtenir 10 cartes différentes en 24h", target: 10, actionType: 'obtain_10_diff_cards_24h' },
    q14: { description: "Connecte-toi 5 jours consécutifs", target: 5, actionType: 'daily_login_streak' }
};
