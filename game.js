import { updateDoc, doc, getDoc, Timestamp, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { allCardsV2 } from './cards1.js';
import { allCardsV3, V3_RELEASED } from './cards-v3.js';
import { updateQuestProgress } from './quest-manager.js';
import { updateUserStats } from './stats-manager.js';
import { showToast } from './toast.js';
import { getDayKey } from './daily-utils.js';
import { playBoosterOpening } from './booster-animation.js';
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
function displayAvailableBoosters() {
    const boostersOpened = userData.dailyBoosterOpenedCount || 0;
    dailyBoosterArea.style.display = 'block';

    // --- DAILY ---
    // On clone pour reset les listeners (évite le double-clic)
    const oldDaily = document.getElementById('booster-pack-image');
    const newDaily = oldDaily.cloneNode(true);
    oldDaily.parentNode.replaceChild(newDaily, oldDaily);

    if (boostersOpened < DAILY_BOOSTER_LIMIT) {
        const remaining = DAILY_BOOSTER_LIMIT - boostersOpened;
        boosterStatusEl.textContent = `Boosters V1 du jour : ${remaining}/${DAILY_BOOSTER_LIMIT}`;
        newDaily.style.opacity = 1;
        newDaily.style.cursor = 'pointer';
        newDaily.addEventListener('click', () => handleOpenBooster('daily'), { once: true });
    } else {
        boosterStatusEl.textContent = "Boosters V1 du jour épuisés. Revenez demain !";
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
}


async function openBooster(boosterType) {
    if (!userData) return;

    let drawnCards;
    // Boosters gratuits du jour : V1 (contenu classique) et V2 (contenu V2), chacun son compteur
    const drawBoosterType = { daily: 'classic', daily_v2: 'v2' }[boosterType] || boosterType;

    if (drawBoosterType === 'legendary') {
        drawnCards = drawLegendaryBoosterCards();
    } else if (drawBoosterType === 'v3') {
        drawnCards = drawClassicBoosterCards(allCardsV3, LEGENDARY_CHANCE.v3);
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
    await updateUserAfterBoosterOpen(boosterType, drawnCards);

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
}

async function checkAndResetDailyCounter() {
    // Même minuit que la boutique et les quêtes du jour (heure de Paris)
    const today = getDayKey();
    const lastReset = userData.dailyLastReset ? getDayKey(new Date(userData.dailyLastReset.seconds * 1000)) : null;
    if (today !== lastReset) {
        const userDocRef = doc(db, "users", userData.uid);
        await updateDoc(userDocRef, {
            dailyBoosterOpenedCount: 0,
            dailyV2BoosterOpenedCount: 0,
            dailyLastReset: Timestamp.now()
        });
        userData.dailyBoosterOpenedCount = 0;
        userData.dailyV2BoosterOpenedCount = 0;
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
async function updateUserAfterBoosterOpen(boosterType, drawnCards) {
    const userDocRef = doc(db, "users", userData.uid);
    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userDocRef);
            if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
            const currentData = userDoc.data();

            const updates = {};

            // Incrémente chaque carte obtenue. On compte les doublons : avant, deux fois la même
            // carte dans un booster n'en ajoutait qu'une (la 2e écriture écrasait la 1re).
            const counts = {};
            for (const card of drawnCards) {
                if (!card || !card.id) {
                    console.error("Carte tirée invalide ou introuvable :", card);
                    continue;
                }
                counts[card.id] = (counts[card.id] || 0) + 1;
            }
            for (const [cardId, n] of Object.entries(counts)) {
                updates[`collection.${cardId}.quantity`] = increment(n);
            }

            if (boosterType === 'daily') {
                // Vérification côté transaction : empêche de dépasser la limite (autre onglet, double clic...)
                if ((currentData.dailyBoosterOpenedCount || 0) >= DAILY_BOOSTER_LIMIT) throw new Error("Boosters quotidiens épuisés. Revenez demain !");
                updates.dailyBoosterOpenedCount = increment(1);
            } else if (boosterType === 'daily_v2') {
                if ((currentData.dailyV2BoosterOpenedCount || 0) >= DAILY_V2_BOOSTER_LIMIT) throw new Error("Boosters V2 du jour épuisés. Revenez demain !");
                updates.dailyV2BoosterOpenedCount = increment(1);
            } else if (boosterType === 'classic') {
                if ((currentData.boosterInventory?.classic || 0) < 1) throw new Error("Pas de booster classique à ouvrir.");
                updates['boosterInventory.classic'] = increment(-1);
            } else if (boosterType === 'legendary') {
                if ((currentData.boosterInventory?.legendary || 0) < 1) throw new Error("Pas de booster légendaire à ouvrir.");
                updates['boosterInventory.legendary'] = increment(-1);
            } else if (boosterType === 'v3') {
                if (!V3_RELEASED) throw new Error("La collection V3 n'est pas encore sortie.");
                if ((currentData.boosterInventory?.v3 || 0) < 1) throw new Error("Pas de booster V3 à ouvrir.");
                updates['boosterInventory.v3'] = increment(-1);
            } else if (boosterType === 'v2') {
                if ((currentData.boosterInventory?.v2 || 0) < 1) throw new Error("Pas de booster V2 à ouvrir.");
                updates['boosterInventory.v2'] = increment(-1);
            }

            transaction.update(userDocRef, updates);
        });
        // Les quêtes (Q12, Q13, Q15, quêtes du jour) sont mises à jour par updateQuestsAfterBoosterOpen
    } catch (error) {
        console.error("Erreur - mise à jour après ouverture booster:", error);
        throw error;
    }
}
