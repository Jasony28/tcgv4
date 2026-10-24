import { doc, getDoc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import {
    fullRewardsList, questsConfig, dailyQuestPool, getDailyQuestIds, getLevel,
    XP_PER_LEVEL, MAX_LEVEL, REWARD_ICONS
} from './battlepass-config.js';
import { showToast } from './toast.js';
import { computeMaxStreak, normalizeBattlePass } from './quest-manager.js';
import { getDayKey, getWeekKey, msUntilNextDay, msUntilNextWeek, formatDuration } from './daily-utils.js';
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { allCardsV3Released } from './cards-v3.js';
import { isBoosterProduced, isCardProduced, BOOSTER_COIN_VALUE } from './series-config.js';

const BOOSTER_REWARDS = { classic_booster: 'classic', legendary_booster: 'legendary', v2_booster: 'v2' };
const CARD_POOL = [...allCards, ...allCardsV2, ...allCardsV3Released];

const trackContainer = document.querySelector('.pass-track');
const trackScroll = document.querySelector('.pass-track-scroll');
const levelNumberEl = document.getElementById('pass-level');
const xpFillEl = document.getElementById('pass-xp-fill');
const xpTextEl = document.getElementById('pass-xp-text');
const seasonTimerEl = document.getElementById('season-timer');
const dailyTimerEl = document.getElementById('daily-timer');
const claimAllButton = document.getElementById('claim-all-button');
const dailyList = document.getElementById('daily-quests');
const weeklyList = document.getElementById('weekly-quests');

let userData;
let bp;
let claiming = false;
const loadedDay = getDayKey();
const loadedWeek = getWeekKey();

function claimableRewards() {
    const level = getLevel(bp.xp);
    return fullRewardsList.filter(r => r.step <= level && !bp.claimedRewards[r.step]);
}

// ==== En-tête : niveau + XP ====
function displayHeader() {
    const level = getLevel(bp.xp);
    levelNumberEl.textContent = level;
    if (level >= MAX_LEVEL) {
        xpFillEl.style.width = '100%';
        xpTextEl.textContent = 'Niveau max atteint !';
    } else {
        const inLevel = bp.xp % XP_PER_LEVEL;
        xpFillEl.style.width = `${(inLevel / XP_PER_LEVEL) * 100}%`;
        xpTextEl.textContent = `${inLevel} / ${XP_PER_LEVEL} XP vers le niveau ${level + 1}`;
    }
    const claimable = claimableRewards().length;
    claimAllButton.hidden = claimable === 0;
    claimAllButton.textContent = `Tout réclamer (${claimable})`;
}

// ==== Piste des récompenses ====
function displayRewardTrack() {
    trackContainer.innerHTML = '';
    const level = getLevel(bp.xp);
    let focusEl = null;

    fullRewardsList.forEach(reward => {
        const isClaimed = !!bp.claimedRewards[reward.step];
        const isUnlocked = reward.step <= level;
        const state = isClaimed ? 'claimed' : (isUnlocked ? 'unlocked' : 'locked');

        const cardElement = document.createElement('div');
        cardElement.className = `pass-level-card ${state} reward-${reward.type}${reward.step % 10 === 0 ? ' milestone' : ''}`;
        cardElement.id = `reward-card-${reward.step}`;
        cardElement.innerHTML = `
            <span class="level-number">Niveau ${reward.step}</span>
            <div class="reward-icon">${REWARD_ICONS[reward.type] || ''}</div>
            <p class="reward-text">${reward.description}</p>
            <div class="action-area">${state === 'unlocked' ? '<button class="claim-button">Réclamer</button>' : ''}</div>
        `;
        trackContainer.appendChild(cardElement);

        if (state === 'unlocked') {
            cardElement.querySelector('.claim-button').addEventListener('click', () => claimRewards([reward]));
            if (!focusEl) focusEl = cardElement;
        }
        if (!focusEl && reward.step === Math.min(level + 1, MAX_LEVEL)) focusEl = cardElement;
    });

    // On centre la piste sur la prochaine récompense intéressante
    if (focusEl) {
        trackScroll.scrollLeft = focusEl.offsetLeft - trackScroll.clientWidth / 2 + focusEl.clientWidth / 2;
    }
}

// ==== Quêtes ====
function questItemHTML(questDef, current, completed) {
    const pct = Math.min(100, (current / questDef.target) * 100);
    return `
        <div class="quest-main">
            <span class="quest-description">${questDef.description}</span>
            <span class="quest-xp">+${questDef.xp} XP${questDef.coins ? ` · +${questDef.coins} 🪙` : ""}</span>
        </div>
        <div class="quest-bar"><div class="quest-bar-fill" style="width:${completed ? 100 : pct}%"></div></div>
        <span class="quest-progress">${completed ? 'Terminée ✓' : `${current} / ${questDef.target}`}</span>
    `;
}

function displayQuests() {
    // Quêtes du jour
    dailyList.innerHTML = '';
    for (const questId of getDailyQuestIds(bp.daily.date)) {
        const questDef = dailyQuestPool[questId];
        const prog = bp.daily.progress[questId] || {};
        const li = document.createElement('li');
        li.className = `quest-item ${prog.completed ? 'completed' : ''}`;
        li.innerHTML = questItemHTML(questDef, prog.progress || 0, !!prog.completed);
        dailyList.appendChild(li);
    }

    // Quêtes de la semaine (les terminées passent en bas)
    weeklyList.innerHTML = '';
    const entries = Object.entries(questsConfig).sort(([a], [b]) =>
        (bp.questProgress[a]?.completed ? 1 : 0) - (bp.questProgress[b]?.completed ? 1 : 0));
    for (const [questId, questDef] of entries) {
        const questProg = bp.questProgress[questId] || {};
        let current;
        switch (questId) {
            case 'q14': current = computeMaxStreak(questProg.progress); break;   // série de jours consécutifs
            case 'q13': current = questProg.progress?.length || 0; break;
            default: current = questProg.progress || 0;
        }
        const li = document.createElement('li');
        li.className = `quest-item ${questProg.completed ? 'completed' : ''}`;
        li.innerHTML = questItemHTML(questDef, Math.min(current, questDef.target), !!questProg.completed);
        weeklyList.appendChild(li);
    }
}

function renderAll() {
    displayHeader();
    displayRewardTrack();
    displayQuests();
}

function tick() {
    seasonTimerEl.textContent = formatDuration(msUntilNextWeek());
    dailyTimerEl.textContent = formatDuration(msUntilNextDay());
    // Nouveau jour / nouvelle saison : on recharge pour repartir sur des données propres
    if (getDayKey() !== loadedDay || getWeekKey() !== loadedWeek) location.reload();
}

// ==== Réclamation (une ou plusieurs récompenses en une seule transaction) ====
async function claimRewards(rewards) {
    if (claiming || rewards.length === 0) return;
    claiming = true;
    claimAllButton.disabled = true;
    document.querySelectorAll('.claim-button').forEach(b => { b.disabled = true; });

    // Cartes aléatoires tirées avant la transaction
    const drawnCards = {};
    for (const r of rewards) {
        if (r.type === 'random_card') {
            // Seulement des cartes de séries encore en cours
            const candidates = CARD_POOL.filter(c => c.rarity === r.rarity && isCardProduced(c));
            drawnCards[r.step] = candidates[Math.floor(Math.random() * candidates.length)];
        }
    }

    const userRef = doc(db, "users", userData.uid);
    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
            const pass = userDoc.data().battlePass || {};
            if (pass.seasonId !== getWeekKey()) throw new Error("Nouvelle saison ! Recharge la page.");
            const level = getLevel(pass.xp);

            const updates = {};
            const totals = {}; // cumul par champ (ex: 2 récompenses pièces => une seule écriture)
            const add = (field, n) => { totals[field] = (totals[field] || 0) + n; };
            for (const reward of rewards) {
                if (reward.step > level) throw new Error(`Niveau ${reward.step} pas encore atteint.`);
                if (pass.claimedRewards?.[reward.step]) throw new Error(`Récompense ${reward.step} déjà réclamée.`);
                if (reward.type === 'coins') add('coins', reward.value);
                else if (BOOSTER_REWARDS[reward.type]) {
                    // Booster d'une série terminée : remplacé par sa valeur en pièces
                    const type = BOOSTER_REWARDS[reward.type];
                    if (isBoosterProduced(type)) add(`boosterInventory.${type}`, reward.value);
                    else add('coins', reward.value * BOOSTER_COIN_VALUE[type]);
                }
                else if (reward.type === 'random_card') add(`collection.${drawnCards[reward.step].id}.quantity`, 1);
                updates[`battlePass.claimedRewards.${reward.step}`] = true;
            }
            for (const [field, n] of Object.entries(totals)) updates[field] = increment(n);
            transaction.update(userRef, updates);
        });

        const names = rewards.map(r => r.type === 'random_card' ? `${drawnCards[r.step].name} (${r.description})` : r.description);
        showToast('success', `Récupéré : ${names.join(', ')}`, 4500);
    } catch (error) {
        showToast('error', error.message);
    } finally {
        claiming = false;
        claimAllButton.disabled = false;
        await refresh();
    }
}

async function refresh() {
    const snap = await getDoc(doc(db, "users", userData.uid));
    userData = { uid: userData.uid, ...snap.data() };
    bp = normalizeBattlePass(userData.battlePass);
    renderAll();
}

// ==== Fonction principale de lancement de la page ====
async function initializePage() {
    // protectPage met déjà à jour la quête de connexion (et remet le pass à zéro si nouvelle semaine)
    userData = await protectPage();
    if (!userData) return;

    bp = normalizeBattlePass(userData.battlePass);
    claimAllButton.addEventListener('click', () => claimRewards(claimableRewards()));
    renderAll();
    tick();
    setInterval(tick, 1000);
}

initializePage();
