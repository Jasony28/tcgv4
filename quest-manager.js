import { doc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { questsConfig } from './battlepass-config.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";

export async function updateQuestProgress(actionType, value = 1, extra = {}) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    console.warn("Utilisateur non connecté");
    return;
  }
  const userId = user.uid;
  const userRef = doc(db, "users", userId);

  try {
    await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists()) throw "User document not found";

      const userData = userDoc.data();
      const bpData = userData.battlePass || { questProgress: {}, rewardsUnlocked: 0, claimedRewards: {} };
      bpData.questProgress = bpData.questProgress || {};
      bpData.claimedRewards = bpData.claimedRewards || {};
      let questsCompletedThisAction = 0;

      for (const questId in questsConfig) {
        const questDef = questsConfig[questId];
        if (questDef.actionType !== actionType) continue;

        // INIT progress selon le type de quête
        if (!bpData.questProgress[questId]) {
          if (questId === 'q14') bpData.questProgress[questId] = { progress: [], completed: false };
          else if (questId === 'q13') bpData.questProgress[questId] = { progress: [], completed: false };
          else bpData.questProgress[questId] = { progress: 0, completed: false };
        }
        
        const questProg = bpData.questProgress[questId];
        if (questProg.completed) continue;

        let newProgress = questProg.progress;
        let maxStreak = 1;

        switch (questId) {
          case 'q8':
          case 'q9':
          case 'q10':
          case 'q11':
          case 'q12':
            newProgress += value;
            break;
          case 'q13': {
            const now = Date.now();
            let arr = Array.isArray(newProgress) ? newProgress : [];
            arr = arr.filter(e => (now - e.time) < (24 * 3600 * 1000));
            if (extra.cardId && !arr.some(e => e.cardId === extra.cardId)) {
              arr.push({ cardId: extra.cardId, time: now });
            }
            newProgress = arr;
            break;
          }
          case 'q14': {
            const todayStr = new Date().toDateString();
            const progressSet = new Set(newProgress);
            progressSet.add(todayStr);
            let datesArray = Array.from(progressSet).sort((a, b) => new Date(a) - new Date(b));
            maxStreak = 1;
            let currentStreak = 1;
            for (let i = 1; i < datesArray.length; i++) {
              const prevDate = new Date(datesArray[i - 1]);
              const currDate = new Date(datesArray[i]);
              const diffDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);
              if (diffDays === 1) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
              } else if (diffDays > 1) {
                currentStreak = 1;
              }
            }
            newProgress = datesArray;
            break;
          }
          default:
            newProgress += value;
        }

        questProg.progress = newProgress;

        let isNowCompleted = false;
        switch (questId) {
          case 'q13':
            isNowCompleted = Array.isArray(questProg.progress) && questProg.progress.length >= questDef.target;
            break;
          case 'q14':
            isNowCompleted = maxStreak >= questDef.target;
            break;
          default:
            isNowCompleted = questProg.progress >= questDef.target;
        }

        if (isNowCompleted) {
          questProg.completed = true;
          questsCompletedThisAction++;
        }
      }

      const updates = { 'battlePass.questProgress': bpData.questProgress };
      if (questsCompletedThisAction > 0) {
        updates['battlePass.rewardsUnlocked'] = increment(questsCompletedThisAction);
        // Pas d'attribution automatique de récompense ici !
      }
      transaction.update(userRef, updates);
    });
  } catch (e) {
    console.error("La transaction de mise à jour de quête a échoué : ", e);
  }
}
