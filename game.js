import { updateDoc, doc, getDoc, Timestamp, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { allCards } from './cards.js';
import { updateQuestProgress } from './quest-manager.js';
import { updateUserStats } from './stats-manager.js';
import { showToast } from './toast.js';

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
  } finally {
    transactionInProgress = false;
  }
}

// --- Affichage des boosters et listeners ---
function displayAvailableBoosters() {
    const boostersOpened = userData.dailyBoosterOpenedCount || 0;
    const DAILY_BOOSTER_LIMIT = 5;
    dailyBoosterArea.style.display = 'block';

    // --- DAILY ---
    // On clone pour reset les listeners (évite le double-clic)
    const oldDaily = document.getElementById('booster-pack-image');
    const newDaily = oldDaily.cloneNode(true);
    oldDaily.parentNode.replaceChild(newDaily, oldDaily);

    if (boostersOpened < DAILY_BOOSTER_LIMIT) {
        const remaining = DAILY_BOOSTER_LIMIT - boostersOpened;
        boosterStatusEl.textContent = `Boosters quotidiens restants : ${remaining}/${DAILY_BOOSTER_LIMIT}`;
        newDaily.style.opacity = 1;
        newDaily.style.cursor = 'pointer';
        newDaily.addEventListener('click', () => handleOpenBooster('daily'), { once: true });
    } else {
        boosterStatusEl.textContent = "Boosters quotidiens épuisés. Revenez demain !";
        newDaily.style.opacity = 0.5;
        newDaily.style.cursor = 'not-allowed';
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
}


async function openBooster(boosterType) {
    if (!userData) return;
    boosterSelectionContainer.style.display = 'none';
    cardRevealArea.style.display = 'grid';
    
    let drawnCards;
    const drawBoosterType = (boosterType === 'daily') ? 'classic' : boosterType;

    if (drawBoosterType === 'legendary') {
        drawnCards = drawLegendaryBoosterCards();
    } else {
        drawnCards = drawClassicBoosterCards();
    }
    
    await updateUserAfterBoosterOpen(boosterType, drawnCards);

   

console.log("Mise à jour quête open_booster...");
await updateQuestProgress(userData.uid, 'open_booster', 1).then(() => {
  console.log("Quête open_booster mise à jour !");
}).catch(console.error);

const hasLegendary = drawnCards.some(card => card.rarity === 'Légendaire');
if (hasLegendary) {
    console.log("Mise à jour quête obtain_legendary...");
    await updateQuestProgress(userData.uid, 'obtain_legendary', 1).then(() => {
      console.log("Quête obtain_legendary mise à jour !");
    }).catch(console.error);
}

startProgressiveReveal(drawnCards);

console.log("Mise à jour stats boostersOpened...");
await updateUserStats(userData.uid, { boostersOpened: 1 });

}

function startProgressiveReveal(cards) {
    let currentCardIndex = 0;
    let isClickable = true;

    boosterStatusEl.textContent = 'Cliquez sur la carte pour révéler la suivante.';
    cardRevealArea.innerHTML = '<div id="reveal-slot" class="card" style="cursor: pointer;"></div>';
    const revealSlot = document.getElementById('reveal-slot');
    
    const displayCard = (card) => {
        revealSlot.innerHTML = `<img src="${card.image}" alt="${card.name}" class="card-image">`;
        revealSlot.className = `card rarity-${card.rarity.replace('é', 'e')}`;
    };

    const returnToBoosterSelection = async () => {
        boosterStatusEl.textContent = 'Booster terminé !';
        revealSlot.innerHTML = '';
        revealSlot.style.cursor = 'default';
        revealSlot.className = 'card';
        revealSlot.removeEventListener('click', revealNextCardHandler);

        setTimeout(async () => {
            cardRevealArea.style.display = 'none';
            boosterSelectionContainer.style.display = 'flex';
            
            const userDocRef = doc(db, "users", userData.uid);
            const updatedUserDoc = await getDoc(userDocRef);
            userData = { uid: userData.uid, ...updatedUserDoc.data() };
            
            displayAvailableBoosters();
        }, 500);
    };

    const revealNextCardHandler = () => {
        if (!isClickable) return;
        isClickable = false;
        currentCardIndex++;

        if (currentCardIndex < cards.length) {
            displayCard(cards[currentCardIndex]);
            if (currentCardIndex === cards.length - 1) {
                boosterStatusEl.textContent = 'Voici la dernière carte. Cliquez à nouveau pour terminer.';
            }
        } else {
            returnToBoosterSelection();
        }

        setTimeout(() => { isClickable = true; }, 250);
    };

    displayCard(cards[currentCardIndex]);
    revealSlot.addEventListener('click', revealNextCardHandler);
}

function drawClassicBoosterCards() {
    const commons = allCards.filter(c => c.rarity === 'Commune');
    const rares = allCards.filter(c => c.rarity === 'Rare');
    const epics = allCards.filter(c => c.rarity === 'epique');
    const legendaries = allCards.filter(c => c.rarity === 'Légendaire');
    const drawn = [];
    for (let i = 0; i < 3; i++) { drawn.push(commons[Math.floor(Math.random() * commons.length)]); }
    drawn.push(rares[Math.floor(Math.random() * rares.length)]);
    const fifthCardRoll = Math.random();
    if (fifthCardRoll < 0.10) {
        drawn.push(legendaries[Math.floor(Math.random() * legendaries.length)]);
    } else if (fifthCardRoll < 0.55) {
        drawn.push(epics[Math.floor(Math.random() * epics.length)]);
    } else {
        drawn.push(rares[Math.floor(Math.random() * rares.length)]);
    }
    return drawn;
}

function drawLegendaryBoosterCards() {
    const commons = allCards.filter(c => c.rarity === 'Commune');
    const rares = allCards.filter(c => c.rarity === 'Rare');
    const legendaries = allCards.filter(c => c.rarity === 'Légendaire');
    const commonAndRares = [...commons, ...rares];
    const drawn = [];
    for (let i = 0; i < 4; i++) { drawn.push(commonAndRares[Math.floor(Math.random() * commonAndRares.length)]); }
    drawn.push(legendaries[Math.floor(Math.random() * legendaries.length)]);
    return drawn.sort(() => Math.random() - 0.5);
}

async function checkAndResetDailyCounter() {
    const today = new Date().toDateString();
    const lastReset = userData.dailyLastReset ? new Date(userData.dailyLastReset.seconds * 1000).toDateString() : null;
    if (today !== lastReset) {
        const userDocRef = doc(db, "users", userData.uid);
        await updateDoc(userDocRef, {
            dailyBoosterOpenedCount: 0,
            dailyLastReset: Timestamp.now()
        });
        userData.dailyBoosterOpenedCount = 0;
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

            // Incrémente chaque carte obtenue
            for (const card of drawnCards) {
                if (!card || !card.id) {
                    console.error("Carte tirée invalide ou introuvable :", card);
                    continue;
                }
                const cardField = `collection.${card.id}.quantity`;
                updates[cardField] = increment(1);
            }

            if (boosterType === 'daily') {
                updates.dailyBoosterOpenedCount = increment(1);
            } else if (boosterType === 'classic') {
                if ((currentData.boosterInventory.classic || 0) < 1) throw new Error("Pas de booster classique à ouvrir.");
                updates['boosterInventory.classic'] = increment(-1);
            } else if (boosterType === 'legendary') {
                if ((currentData.boosterInventory.legendary || 0) < 1) throw new Error("Pas de booster légendaire à ouvrir.");
                updates['boosterInventory.legendary'] = increment(-1);
            }

            transaction.update(userDocRef, updates);
        });

        // === APPEL Q13 ICI ===
        // On le fait pour chaque carte tirée (on boucle !)
        for (const card of drawnCards) {
            await updateQuestProgress('obtain_10_diff_cards_24h', 1, {cardId: card.id});
        }

        // === Q12 : Booster légendaire ===
        if (boosterType === 'legendary') {
            await updateQuestProgress('open_legendary_booster');
        }

    } catch (error) {
        console.error("Erreur - mise à jour après ouverture booster:", error);
    }
}
