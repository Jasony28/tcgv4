import { doc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { questsConfig, dailyQuestPool, getDailyQuestIds, getLevel } from './battlepass-config.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getDayKey, getWeekKey } from './daily-utils.js';
import { showToast } from './toast.js';

/**
 * Plus longue série de jours consécutifs dans une liste de dates (format toDateString).
 * Math.round : lors d'un changement d'heure (été/hiver) l'écart entre deux jours vaut 23h ou 25h,
 * l'ancien test "=== 1" cassait alors la série.
 */
/**
 * Jour au format « AAAA-MM-JJ ». Les anciennes dates (« Mon Oct 26 2026 », illisibles sur certains
 * téléphones comme Safari/iPhone, ce qui bloquait la série à 1) sont converties.
 */
export function toDayKey(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = new Date(d);
  if (isNaN(t)) return null;
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
const dayNumber = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

/** Plus longue série de jours consécutifs */
export function computeMaxStreak(dates) {
  const days = [...new Set((Array.isArray(dates) ? dates : []).map(toDayKey).filter(Boolean))].map(dayNumber).sort((a, b) => a - b);
  if (!days.length) return 0;
  let maxStreak = 1, currentStreak = 1;
  for (let i = 1; i < days.length; i++) {
    currentStreak = days[i] - days[i - 1] === 1 ? currentStreak + 1 : 1;
    maxStreak = Math.max(maxStreak, currentStreak);
  }
  return maxStreak;
}

/**
 * Battle Pass à jour : nouvelle semaine => tout repart à zéro, nouveau jour => nouvelles quêtes du jour.
 * Structure : { seasonId, xp, questProgress, claimedRewards, daily: { date, progress } }
 */
export function normalizeBattlePass(bp, week = getWeekKey(), day = getDayKey()) {
  const pass = (bp && bp.seasonId === week)
    ? { ...bp }
    : { seasonId: week, xp: 0, questProgress: {}, claimedRewards: {} };
  pass.xp = pass.xp || 0;
  pass.questProgress = pass.questProgress || {};
  pass.claimedRewards = pass.claimedRewards || {};
  if (!pass.daily || pass.daily.date !== day) pass.daily = { date: day, progress: {} };
  delete pass.rewardsUnlocked; // ancien système (1 quête = 1 récompense), remplacé par l'XP
  return pass;
}

// Avance une quête de la semaine. Renvoie true si elle vient d'être terminée.
function advanceWeeklyQuest(questId, questDef, bp, value, extra) {
  if (!bp.questProgress[questId]) {
    const isList = questId === 'q13' || questId === 'q14';
    bp.questProgress[questId] = { progress: isList ? [] : 0, completed: false };
  }
  const questProg = bp.questProgress[questId];
  if (questProg.completed) return false;

  let completed;
  switch (questId) {
    case 'q13': {
      const now = Date.now();
      let arr = Array.isArray(questProg.progress) ? questProg.progress : [];
      arr = arr.filter(e => (now - e.time) < (24 * 3600 * 1000));
      // extra.cardId (une carte) ou extra.cardIds (plusieurs, ex: un booster entier en un appel)
      const ids = extra.cardIds || (extra.cardId ? [extra.cardId] : []);
      for (const id of ids) {
        if (!arr.some(e => e.cardId === id)) arr.push({ cardId: id, time: now });
      }
      questProg.progress = arr;
      completed = arr.length >= questDef.target;
      break;
    }
    case 'q14': {
      const progressSet = new Set((Array.isArray(questProg.progress) ? questProg.progress : []).map(toDayKey).filter(Boolean));
      progressSet.add(getDayKey());
      const datesArray = Array.from(progressSet).sort();
      questProg.progress = datesArray;
      completed = computeMaxStreak(datesArray) >= questDef.target;
      break;
    }
    default:
      questProg.progress = (questProg.progress || 0) + value;
      completed = questProg.progress >= questDef.target;
  }
  if (completed) questProg.completed = true;
  return completed;
}

export async function updateQuestProgress(actionType, value = 1, extra = {}) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    console.warn("Utilisateur non connecté");
    return;
  }
  const userRef = doc(db, "users", user.uid);
  let completedQuests = [];
  let levelBefore = 0, levelAfter = 0;

  try {
    await runTransaction(db, async (transaction) => {
      completedQuests = []; // la transaction peut être rejouée
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists()) throw "User document not found";

      const bp = normalizeBattlePass(userDoc.data().battlePass);
      levelBefore = getLevel(bp.xp);

      // Quêtes de la semaine
      for (const questId in questsConfig) {
        const questDef = questsConfig[questId];
        if (questDef.actionType !== actionType) continue;
        if (advanceWeeklyQuest(questId, questDef, bp, value, extra)) completedQuests.push(questDef);
      }

      // Quêtes du jour
      for (const questId of getDailyQuestIds(bp.daily.date)) {
        const questDef = dailyQuestPool[questId];
        if (questDef.actionType !== actionType) continue;
        const prog = bp.daily.progress[questId] || { progress: 0, completed: false };
        if (prog.completed) continue;
        prog.progress = Math.min(questDef.target, (prog.progress || 0) + value);
        if (prog.progress >= questDef.target) {
          prog.completed = true;
          completedQuests.push(questDef);
        }
        bp.daily.progress[questId] = prog;
      }

      bp.xp += completedQuests.reduce((sum, q) => sum + (q.xp || 0), 0);
      levelAfter = getLevel(bp.xp);
      // Les quêtes rapportent aussi des pièces
      const coinsEarned = completedQuests.reduce((sum, q) => sum + (q.coins || 0), 0);
      transaction.update(userRef, coinsEarned > 0 ? { battlePass: bp, coins: increment(coinsEarned) } : { battlePass: bp });
    });

    for (const q of completedQuests) {
      showToast('success', `Quête terminée : ${q.description} (+${q.xp} XP${q.coins ? `, +${q.coins} pièces` : ''})`, 4000);
    }
    if (levelAfter > levelBefore) {
      showToast('info', `Niveau ${levelAfter} atteint ! Récupère ta récompense dans le Pass.`, 4500);
    }
  } catch (e) {
    console.error("La transaction de mise à jour de quête a échoué : ", e);
  }
}
