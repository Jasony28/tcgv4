import { doc, getDoc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { fullRewardsList, questsConfig } from './battlepass-config.js';
import { showToast } from './toast.js';
import { updateQuestProgress } from './quest-manager.js';

let userData;

// === Initialisation connexion + mise à jour quest login streak ===
window.addEventListener('load', async () => {
  await protectPage();
  await updateQuestProgress('daily_login_streak');

});

// ==== Affiche la piste des récompenses et bloque la réclamation hors ordre ====
function displayRewardTrack() {
    const trackContainer = document.querySelector('.pass-track');
    if (!trackContainer) return;
    trackContainer.innerHTML = '';

    const rewardsUnlockedCount = userData.battlePass?.rewardsUnlocked || 0;
    const claimedRewardsMap = userData.battlePass?.claimedRewards || {};

    // Détermine la première récompense réclamable non prise
    const firstUnclaimed = fullRewardsList.find(r =>
        rewardsUnlockedCount >= r.step &&
        !claimedRewardsMap?.[r.step]
    )?.step;

    fullRewardsList.forEach(reward => {
        const isUnlocked = reward.step <= rewardsUnlockedCount;
        const isClaimed = claimedRewardsMap[reward.step] === true;
        let canClaim = false;
        let cardStateClass = 'locked';

        if (isUnlocked && !isClaimed) {
            canClaim = (reward.step === firstUnclaimed); // On peut réclamer que la première non prise
            cardStateClass = canClaim ? 'unlocked' : 'locked';
        } else if (isClaimed) {
            cardStateClass = 'claimed';
            
        }

        const cardElement = document.createElement('div');
        cardElement.className = `pass-level-card ${cardStateClass}`;
        cardElement.id = `reward-card-${reward.step}`;

        let actionAreaHTML = '';
        if (canClaim) {
            actionAreaHTML = `<button class="claim-button">RÉCLAMER</button>`;
        }
        cardElement.innerHTML = `
            <span class="level-number">Récompense ${reward.step}</span>
            <div class="reward-icon">${reward.type === 'coins' ? '🪙' : (reward.type === 'classic_booster' ? '🎴' : reward.type === 'legendary_booster' ? '🌟' : '')}</div>
            <p class="reward-text">${reward.description}</p>
            <div class="action-area">${actionAreaHTML}</div>
        `;
        trackContainer.appendChild(cardElement);

        if (canClaim) {
            cardElement.querySelector('.claim-button').addEventListener('click', () => handleClaimReward(reward));
        }
    });
}

// ==== Affiche les quêtes et progression, compatible avec quêtes avancées ====
function displayQuests() {
    const questsContainer = document.querySelector('.quests-list');
    if (!questsContainer) return;
    questsContainer.innerHTML = '';

    const userQuestProgress = userData?.battlePass?.questProgress || {};

    for (const questId in questsConfig) {
        const questDef = questsConfig[questId];
        const questProg = userQuestProgress[questId] || {};
        const isCompleted = questProg.completed || false;
        let progressText = isCompleted ? 'Terminée ✓' : '';

        if (!isCompleted) {
            switch (questId) {
                case 'q6':
                case 'q14':
                    progressText = `${(questProg.progress?.length || 0)} / ${questDef.target}`;
                    break;
                case 'q13':
                    progressText = `${(questProg.progress?.length || 0)} / ${questDef.target}`;
                    break;
                default:
                    progressText = `${(questProg.progress || 0)} / ${questDef.target}`;
            }
        }

        const questElement = document.createElement('li');
        questElement.className = `quest-item ${isCompleted ? 'completed' : ''}`;
        questElement.innerHTML = `
            <span class="quest-description">${questDef.description}</span>
            <span class="quest-progress">${progressText}</span>
        `;
        questsContainer.appendChild(questElement);
    }
}

// ==== Gestion du clic sur "RÉCLAMER" ====
async function handleClaimReward(reward) {
    const button = document.querySelector(`#reward-card-${reward.step} .claim-button`);
    if(button) {
        button.disabled = true;
        button.textContent = '...';
    }

    const userRef = doc(db, "users", userData.uid);
    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");

            const bpData = userDoc.data().battlePass || {};
            if (reward.step > (bpData.rewardsUnlocked || 0)) throw new Error("Récompense non encore débloquée.");
            if (bpData.claimedRewards?.[reward.step]) throw new Error("Récompense déjà réclamée.");

            const updates = {};
            if (reward.type === 'coins') updates.coins = increment(reward.value);
            else if (reward.type === 'classic_booster') updates['boosterInventory.classic'] = increment(reward.value);
            else if (reward.type === 'legendary_booster') updates['boosterInventory.legendary'] = increment(reward.value);

            updates[`battlePass.claimedRewards.${reward.step}`] = true;
            transaction.update(userRef, updates);
        });

        showToast(`Récompense réclamée : ${reward.description}`, 'success');
        setTimeout(() => {
          location.reload();
        }, 500); // recharge la page après 0.5s pour tout mettre à jour

    } catch (error) {
        showToast(error.message, 'error');
        if(button){
            button.disabled = false;
            button.textContent = 'RÉCLAMER';
        }
    }
}



// ==== Fonction principale de lancement de la page ====
async function initializePage() {
    userData = await protectPage();
    if (!userData) return;

    if (!userData.boosterInventory) userData.boosterInventory = { classic: 0, legendary: 0 };
    if (!userData.battlePass) userData.battlePass = { rewardsUnlocked: 0, questProgress: {}, claimedRewards: {} };

    displayRewardTrack();
    displayQuests();
}

initializePage();
