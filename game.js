import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { allCardsV2 } from './cards1.js';
import { allCardsV3Released, V3_RELEASED } from './cards-v3.js';
import { updateQuestProgress } from './quest-manager.js';
import { updateUserStats } from './stats-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { getDayKey } from './daily-utils.js';
import { playBoosterOpening } from './booster-animation.js';
import { SHOP_DISPLAYS } from './shop-config.js';
import { openDisplay, keepDailyBooster, saveOpenedBooster, resetDailyCounters } from './inventory-service.js';
import { seriesOfBooster, seriesStatus, isBoosterProduced, daysUntilEnd, mainDailyBoosterType, seriesAnnouncements } from './series-config.js';
import { DAILY_BOOSTER_LIMIT, DAILY_V2_BOOSTER_LIMIT, LEGENDARY_CHANCE, drawClassicBoosterCards, drawLegendaryBoosterCards } from './booster-draws.js';

// --- Éléments du DOM ---
const boosterStatusEl = document.getElementById('booster-status');
const cardRevealArea = document.getElementById('card-reveal-area');
const boosterSelectionContainer = document.getElementById('booster-selection-container');
const dailyBoosterArea = document.getElementById('daily-booster-area');
const dailyBoosterImage = document.getElementById('booster-pack-image');
const classicBoosterArea = document.getElementById('classic-booster-area');
const classicBoosterCountEl = document.getElementById('classic-booster-count');
const classicBoosterOpener = document.getElementById('classic-booster-opener');
const legendaryBoosterArea = document.getElementById('legendary-booster-area');
const legendaryBoosterCountEl = document.getElementById('legendary-booster-count');
const legendaryBoosterOpener = document.getElementById('legendary-booster-opener');
// Message affiché pendant la révélation (booster-status est caché avec la sélection de boosters)
const revealStatusEl = document.getElementById('reveal-status');
// Nombre de boosters gratuits et contenu des boosters : voir booster-draws.js

let userData;

// --- Verrou pour anti-spam transaction ---
let transactionInProgress = false;

// Fonction wrapper avec verrou et passage du type de booster
async function handleOpenBooster(type) {
  if (transactionInProgress) {
    showToast("warning", "Ouverture déjà en cours, patiente une seconde.");
    return;
  }
  transactionInProgress = true;
  try {
    await openBooster(type); // la vraie fonction qui ouvre le booster
    // ... le reste de la logique (affichage, animation, etc.)
  } catch (error) {
    if (error.code === 'failed-precondition') {
      showToast("error", "Profil modifié ailleurs. Recharge la page ou réessaie.");
    } else {
      showToast("error", error.message || "Erreur lors de l’ouverture.");
    }
    // On réaffiche la sélection (et on remet les écouteurs "once" consommés par le clic)
    cardRevealArea.style.display = 'none';
    revealStatusEl.style.display = 'none';
    boosterSelectionContainer.style.display = 'flex';
    displayAvailableBoosters();
  } finally {
    transactionInProgress = false;
  }
}

// --- Affichage des boosters et listeners ---
// Libellé du booster gratuit principal selon la série en cours
const MAIN_DAILY_LABEL = { classic: 'V1', v3: 'V3' };

function displayAvailableBoosters() {
    const boostersOpened = userData.dailyBoosterOpenedCount || 0;
    const mainType = mainDailyBoosterType();
    const mainLabel = MAIN_DAILY_LABEL[mainType] || '';
    dailyBoosterArea.style.display = 'block';
    document.getElementById('daily-main-tag').hidden = mainType !== 'v3';

    // --- DAILY ---
    // On clone pour reset les listeners (évite le double-clic)
    const oldDaily = document.getElementById('booster-pack-image');
    const newDaily = oldDaily.cloneNode(true);
    oldDaily.parentNode.replaceChild(newDaily, oldDaily);

    if (boostersOpened < DAILY_BOOSTER_LIMIT) {
        const remaining = DAILY_BOOSTER_LIMIT - boostersOpened;
        boosterStatusEl.textContent = `Boosters ${mainLabel} du jour : ${remaining}/${DAILY_BOOSTER_LIMIT}`;
        newDaily.style.opacity = 1;
        newDaily.style.cursor = 'pointer';
        newDaily.addEventListener('click', () => handleOpenBooster('daily'), { once: true });
    } else {
        boosterStatusEl.textContent = `Boosters ${mainLabel} du jour épuisés. Revenez demain !`;
        newDaily.style.opacity = 0.5;
        newDaily.style.cursor = 'not-allowed';
    }

    // --- DAILY V2 (compteur séparé) ---
    const v2Opened = userData.dailyV2BoosterOpenedCount || 0;
    document.getElementById('daily-v2-booster-area').style.display = 'block';
    const v2StatusEl = document.getElementById('booster-v2-status');
    const oldDailyV2 = document.getElementById('booster-v2-pack-image');
    const newDailyV2 = oldDailyV2.cloneNode(true);
    oldDailyV2.parentNode.replaceChild(newDailyV2, oldDailyV2);

    if (v2Opened < DAILY_V2_BOOSTER_LIMIT) {
        v2StatusEl.textContent = `Boosters V2 du jour : ${DAILY_V2_BOOSTER_LIMIT - v2Opened}/${DAILY_V2_BOOSTER_LIMIT}`;
        newDailyV2.style.opacity = 1;
        newDailyV2.style.cursor = 'pointer';
        newDailyV2.addEventListener('click', () => handleOpenBooster('daily_v2'), { once: true });
    } else {
        v2StatusEl.textContent = "Boosters V2 du jour épuisés. Revenez demain !";
        newDailyV2.style.opacity = 0.5;
        newDailyV2.style.cursor = 'not-allowed';
    }

    // --- CLASSIC ---
    const classicBoosters = userData.boosterInventory?.classic || 0;
    const oldClassic = document.getElementById('classic-booster-opener');
    const newClassic = oldClassic.cloneNode(true);
    oldClassic.parentNode.replaceChild(newClassic, oldClassic);
    const classicCountEl = newClassic.querySelector('#classic-booster-count');

    if (classicBoosters > 0) {
        classicBoosterArea.style.display = 'block';
        if (classicCountEl) classicCountEl.textContent = `x${classicBoosters}`;
        newClassic.addEventListener('click', () => handleOpenBooster('classic'), { once: true });
    } else {
        classicBoosterArea.style.display = 'none';
    }

    // --- LEGENDARY ---
    const legendaryBoosters = userData.boosterInventory?.legendary || 0;
    const oldLegendary = document.getElementById('legendary-booster-opener');
    const newLegendary = oldLegendary.cloneNode(true);
    oldLegendary.parentNode.replaceChild(newLegendary, oldLegendary);
    const legendaryCountEl = newLegendary.querySelector('#legendary-booster-count');

    if (legendaryBoosters > 0) {
        legendaryBoosterArea.style.display = 'block';
        if (legendaryCountEl) legendaryCountEl.textContent = `x${legendaryBoosters}`;
        newLegendary.addEventListener('click', () => handleOpenBooster('legendary'), { once: true });
    } else {
        legendaryBoosterArea.style.display = 'none';
    }

    // --- V2 ---
    const v2Boosters = userData.boosterInventory?.v2 || 0;
    const v2Area = document.getElementById('v2-booster-area');
    const oldV2 = document.getElementById('v2-booster-opener');
    const newV2 = oldV2.cloneNode(true);
    oldV2.parentNode.replaceChild(newV2, oldV2);

    if (v2Boosters > 0) {
        v2Area.style.display = 'block';
        newV2.querySelector('#v2-booster-count').textContent = `x${v2Boosters}`;
        newV2.addEventListener('click', () => handleOpenBooster('v2'), { once: true });
    } else {
        v2Area.style.display = 'none';
    }

    // --- V3 (seulement une fois la collection sortie) ---
    const v3Boosters = V3_RELEASED ? (userData.boosterInventory?.v3 || 0) : 0;
    const v3Area = document.getElementById('v3-booster-area');
    const oldV3 = document.getElementById('v3-booster-opener');
    const newV3 = oldV3.cloneNode(true);
    oldV3.parentNode.replaceChild(newV3, oldV3);

    if (v3Boosters > 0) {
        v3Area.style.display = 'block';
        newV3.querySelector('#v3-booster-count').textContent = `x${v3Boosters}`;
        newV3.addEventListener('click', () => handleOpenBooster('v3'), { once: true });
    } else {
        v3Area.style.display = 'none';
    }

    // --- LÉGENDAIRE V3 (récompense du Pass) ---
    const v3LegBoosters = userData.boosterInventory?.v3_legendary || 0;
    const v3LegArea = document.getElementById('v3_legendary-booster-area');
    const oldV3Leg = document.getElementById('v3_legendary-booster-opener');
    const newV3Leg = oldV3Leg.cloneNode(true);
    oldV3Leg.parentNode.replaceChild(newV3Leg, oldV3Leg);
    v3LegArea.style.display = v3LegBoosters > 0 ? 'block' : 'none';
    if (v3LegBoosters > 0) {
        newV3Leg.querySelector('#v3_legendary-booster-count').textContent = `x${v3LegBoosters}`;
        newV3Leg.addEventListener('click', () => handleOpenBooster('v3_legendary'), { once: true });
    }

    // --- Séries : plus de boosters gratuits pour une série terminée ---
    const v2Active = isBoosterProduced('v2');
    if (!mainType) dailyBoosterArea.style.display = 'none';
    if (!v2Active) document.getElementById('daily-v2-booster-area').style.display = 'none';

    // --- Garder les boosters gratuits pour plus tard ---
    const keepV1 = document.getElementById('keep-v1-button');
    keepV1.disabled = boostersOpened >= DAILY_BOOSTER_LIMIT;
    keepV1.onclick = () => handleKeepDaily('main');
    const keepV2 = document.getElementById('keep-v2-button');
    keepV2.disabled = v2Opened >= DAILY_V2_BOOSTER_LIMIT;
    keepV2.onclick = () => handleKeepDaily('v2');

    // --- Badges de série sur l'inventaire (série terminée = objet de collection) ---
    for (const [type, areaId] of [['classic', 'classic-booster-area'], ['legendary', 'legendary-booster-area'], ['v2', 'v2-booster-area'], ['v3', 'v3-booster-area'], ['v3_legendary', 'v3_legendary-booster-area']]) {
        const area = document.getElementById(areaId);
        area.querySelector('.series-badge')?.remove();
        const badge = seriesBadgeHTML(seriesOfBooster(type));
        if (badge) area.insertAdjacentHTML('beforeend', badge);
    }

    // --- Displays : boîtes de boosters à ouvrir ---
    const displays = Object.entries(SHOP_DISPLAYS).filter(([t]) => (userData.displayInventory?.[t] || 0) > 0);
    const displayBox = document.getElementById('display-inventory');
    displayBox.innerHTML = displays.map(([t, d]) => `
        <div class="display-card ${d.boosterType}">
            <div class="display-visual ${d.boosterType}">
                <img src="assets/booster/booster.webp" alt=""><img src="assets/booster/booster.webp" alt=""><img src="assets/booster/booster.webp" alt="">
            </div>
            <div class="display-card-info">
                <strong>${d.name} <span class="inventory-count-inline">x${userData.displayInventory[t]}</span></strong>
                <span>${d.boosters + d.bonus} boosters à l'intérieur</span>
                ${seriesBadgeHTML(seriesOfBooster(d.boosterType))}
            </div>
            <button class="open-display-button" data-display="${t}">Ouvrir</button>
        </div>`).join('');
    displayBox.querySelectorAll('[data-display]').forEach(btn => { btn.onclick = () => handleOpenDisplay(btn.dataset.display); });

    // --- Inventaire vide ? ---
    const boosterTotal = ['classic', 'legendary', 'v2', ...(V3_RELEASED ? ['v3', 'v3_legendary'] : [])]
        .reduce((sum, t) => sum + (userData.boosterInventory?.[t] || 0), 0);
    document.getElementById('inventory-empty').hidden = boosterTotal + displays.length > 0;
    const pill = document.getElementById('inventory-count-pill');
    pill.hidden = boosterTotal + displays.length === 0;
    pill.textContent = boosterTotal + displays.length;

    // --- Bandeau « fin de série » ---
    const banner = document.getElementById('series-banner');
    const news = seriesAnnouncements();
    banner.hidden = news.length === 0;
    banner.innerHTML = news.map(n => `<span class="series-news ${n.kind}">${n.text}</span>`).join('');
}

/** Petit badge « Fin dans X j » ou « Série terminée » */
function seriesBadgeHTML(seriesKey) {
    const status = seriesStatus(seriesKey);
    if (status === 'ended') return `<span class="series-badge ended">💎 Série terminée · collector</span>`;
    const days = daysUntilEnd(seriesKey);
    if (days !== null) return `<span class="series-badge ending">⏳ Fin de série dans ${days} j</span>`;
    return '';
}

// Garde un booster gratuit dans l'inventaire au lieu de l'ouvrir
async function handleKeepDaily(kind) {
    if (transactionInProgress) return;
    transactionInProgress = true;
    try {
        await keepDailyBooster(userData.uid, kind);
        const label = kind === 'v2' ? 'V2' : MAIN_DAILY_LABEL[mainDailyBoosterType()];
        showToast('success', `📦 Booster ${label} rangé dans ton inventaire !`);
        await refreshUserData();
    } catch (e) {
        showToast('error', e.message || "Impossible de garder ce booster.");
    } finally {
        transactionInProgress = false;
    }
}

// Ouvre une display : ses boosters arrivent dans l'inventaire
async function handleOpenDisplay(type) {
    if (transactionInProgress) return;
    const d = SHOP_DISPLAYS[type];
    const ended = !isBoosterProduced(d.boosterType);
    const ok = await showConfirmDialog({
        title: `Ouvrir la ${d.name} ?`,
        message: `Ses ${d.boosters + d.bonus} boosters iront dans ton inventaire.` + (ended ? " Attention : cette série est terminée, une display fermée vaut plus cher au marché !" : ''),
        confirmText: 'Ouvrir',
        cancelText: 'Garder fermée'
    });
    if (!ok) return;
    transactionInProgress = true;
    try {
        const res = await openDisplay(userData.uid, type);
        showToast('success', `🗃️ ${d.name} ouverte : +${res.count} boosters dans ton inventaire !`);
        await refreshUserData();
    } catch (e) {
        showToast('error', e.message || "Impossible d'ouvrir la display.");
    } finally {
        transactionInProgress = false;
    }
}

async function refreshUserData() {
    const snap = await getDoc(doc(db, "users", userData.uid));
    userData = { uid: userData.uid, ...snap.data() };
    displayAvailableBoosters();
}


async function openBooster(boosterType) {
    if (!userData) return;

    let drawnCards;
    // Boosters gratuits du jour : V1 (contenu classique) et V2 (contenu V2), chacun son compteur
    const drawBoosterType = { daily: mainDailyBoosterType(), daily_v2: 'v2' }[boosterType] || boosterType;

    if (drawBoosterType === 'legendary') {
        drawnCards = drawLegendaryBoosterCards();
    } else if (drawBoosterType === 'v3_legendary') {
        drawnCards = drawLegendaryBoosterCards(allCardsV3Released);
    } else if (drawBoosterType === 'v3') {
        drawnCards = drawClassicBoosterCards(allCardsV3Released, LEGENDARY_CHANCE.v3);
    } else if (drawBoosterType === 'v2') {
        drawnCards = drawClassicBoosterCards(allCardsV2, LEGENDARY_CHANCE.v2);
    } else {
        drawnCards = drawClassicBoosterCards();
    }

    // Cartes jamais obtenues avant ce booster (badge "Nouvelle !")
    const seen = new Set(Object.keys(userData.collection || {}).filter(id => userData.collection[id]?.quantity > 0));
    const isNew = drawnCards.map(card => {
        if (seen.has(card.id)) return false;
        seen.add(card.id); // un doublon dans le même booster n'est "nouveau" qu'une fois
        return true;
    });

    // Si l'enregistrement échoue, l'erreur remonte à handleOpenBooster : on n'affiche
    // pas des cartes qui n'ont pas été ajoutées à la collection.
    await saveOpenedBooster(userData.uid, boosterType, drawnCards);

    // Quêtes et stats en arrière-plan : l'animation n'attend pas
    updateQuestsAfterBoosterOpen(drawBoosterType, drawnCards);
    updateUserStats(userData.uid, { boostersOpened: 1 });

    // Mise en scène de l'ouverture (booster-animation.js), puis retour à la sélection
    await playBoosterOpening({ cards: drawnCards, isNew, boosterType });
    const updatedUserDoc = await getDoc(doc(db, "users", userData.uid));
    userData = { uid: userData.uid, ...updatedUserDoc.data() };
    displayAvailableBoosters();
}

async function updateQuestsAfterBoosterOpen(boosterType, drawnCards) {
    await updateQuestProgress('obtain_10_diff_cards_24h', 1, { cardIds: drawnCards.map(c => c.id) });
    await updateQuestProgress('open_booster');
    if (boosterType === 'legendary') {
        await updateQuestProgress('open_legendary_booster');
    }
    if (boosterType === 'v2') {
        await updateQuestProgress('open_v2_booster');
    }
    if (boosterType === 'v3' || boosterType === 'v3_legendary') {
        await updateQuestProgress('open_v3_booster');
    }
    // Cartes V3 rares ou mieux (quêtes V3)
    const v3Good = drawnCards.filter(c => c.version === 'v3' && c.rarity !== 'Commune').length;
    if (v3Good) await updateQuestProgress('pull_v3_rare_plus', v3Good);
    const v3Top = drawnCards.filter(c => c.version === 'v3' && (c.rarity === 'epique' || c.rarity === 'Légendaire')).length;
    if (v3Top) await updateQuestProgress('pull_v3_epic_plus', v3Top);
}

async function checkAndResetDailyCounter() {
    // Même minuit que la boutique et les quêtes du jour (heure de Paris)
    const today = getDayKey();
    const lastReset = userData.dailyLastReset ? getDayKey(new Date(userData.dailyLastReset.seconds * 1000)) : null;
    if (today !== lastReset) {
        try {
            await resetDailyCounters(userData.uid);
            userData.dailyBoosterOpenedCount = 0;
            userData.dailyV2BoosterOpenedCount = 0;
        } catch (e) {
            console.error("Remise à zéro des boosters du jour :", e);
        }
    }
}

/**
 * Fonction principale qui lance la page.
 */
async function initializePage() {
    userData = await protectPage();
    if (!userData) return;

    if (!userData.boosterInventory) userData.boosterInventory = { classic: 0, legendary: 0 };
    if (!userData.battlePass) userData.battlePass = { rewardsUnlocked: 0, questProgress: {}, claimedRewards: {} };

    await checkAndResetDailyCounter();
    displayAvailableBoosters();
}

// Lancement de l'initialisation de la page
initializePage();
