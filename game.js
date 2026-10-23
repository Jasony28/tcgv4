import { updateDoc, doc, getDoc, Timestamp, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { updateQuestProgress } from './quest-manager.js';
import { updateUserStats } from './stats-manager.js';
import { showToast } from './toast.js';
import { getDayKey } from './daily-utils.js';

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
const DAILY_BOOSTER_LIMIT = 5;

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
}


async function openBooster(boosterType) {
    if (!userData) return;
    boosterSelectionContainer.style.display = 'none';
    cardRevealArea.style.display = 'grid';

    let drawnCards;
    const drawBoosterType = (boosterType === 'daily') ? 'classic' : boosterType;

    if (drawBoosterType === 'legendary') {
        drawnCards = drawLegendaryBoosterCards();
    } else if (drawBoosterType === 'v2') {
        drawnCards = drawClassicBoosterCards(allCardsV2);
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

    startProgressiveReveal(drawnCards, isNew);

    // Quêtes et stats en arrière-plan : la révélation n'attend pas
    updateQuestsAfterBoosterOpen(boosterType, drawnCards);
    updateUserStats(userData.uid, { boostersOpened: 1 });
}

async function updateQuestsAfterBoosterOpen(boosterType, drawnCards) {
    await updateQuestProgress('obtain_10_diff_cards_24h', 1, { cardIds: drawnCards.map(c => c.id) });
    await updateQuestProgress('open_booster');
    if (boosterType === 'legendary') {
        await updateQuestProgress('open_legendary_booster');
    }
}

const rarityClass = (rarity) => `rarity-${rarity.replace(/é/g, 'e')}`;

// Récapitulatif du booster (les 5 cartes d'un coup)
function showBoosterRecap(cards, isNew, onContinue) {
    revealStatusEl.textContent = 'Booster terminé !';
    cardRevealArea.classList.add('recap');
    cardRevealArea.innerHTML = `
        <div class="recap-grid">
            ${cards.map((card, i) => `
                <div class="card ${rarityClass(card.rarity)}">
                    <img class="card-image" src="${card.image}" alt="${card.name}">
                    ${isNew[i] ? '<span class="new-ribbon">Nouvelle</span>' : ''}
                </div>`).join('')}
        </div>
        <button id="recap-continue" class="recap-button">Continuer</button>
    `;
    document.getElementById('recap-continue').addEventListener('click', onContinue, { once: true });
}

function startProgressiveReveal(cards, isNew = []) {
    let currentCardIndex = 0;
    let isClickable = true;

    revealStatusEl.style.display = 'block';
    revealStatusEl.textContent = `Touche la carte pour révéler la suivante (1/${cards.length})`;
    cardRevealArea.classList.remove('recap');
    cardRevealArea.innerHTML = '<div id="reveal-slot" class="card" style="cursor: pointer;"></div>';
    const revealSlot = document.getElementById('reveal-slot');

    const displayCard = (card, index) => {
        revealSlot.innerHTML = `<img src="${card.image}" alt="${card.name}" class="card-image">`
            + (isNew[index] ? '<span class="new-ribbon big">Nouvelle !</span>' : '');
        revealSlot.className = `card ${rarityClass(card.rarity)}`;
    };

    const returnToBoosterSelection = async () => {
        revealSlot.removeEventListener('click', revealNextCardHandler);

        showBoosterRecap(cards, isNew, async () => {
            cardRevealArea.style.display = 'none';
            cardRevealArea.classList.remove('recap');
            revealStatusEl.style.display = 'none';
            boosterSelectionContainer.style.display = 'flex';

            const userDocRef = doc(db, "users", userData.uid);
            const updatedUserDoc = await getDoc(userDocRef);
            userData = { uid: userData.uid, ...updatedUserDoc.data() };

            displayAvailableBoosters();
        });
    };

    const revealNextCardHandler = () => {
        if (!isClickable) return;
        isClickable = false;
        currentCardIndex++;

        if (currentCardIndex < cards.length) {
            displayCard(cards[currentCardIndex], currentCardIndex);
            revealStatusEl.textContent = currentCardIndex === cards.length - 1
                ? 'Dernière carte ! Touche-la pour voir le récap.'
                : `Touche la carte pour révéler la suivante (${currentCardIndex + 1}/${cards.length})`;
        } else {
            returnToBoosterSelection();
        }

        setTimeout(() => { isClickable = true; }, 250);
    };

    displayCard(cards[currentCardIndex], currentCardIndex);
    revealSlot.addEventListener('click', revealNextCardHandler);
}

// Même composition pour le booster classique (V1) et le booster V2 : seul le set de cartes change
function drawClassicBoosterCards(cardSet = allCards) {
    const commons = cardSet.filter(c => c.rarity === 'Commune');
    const rares = cardSet.filter(c => c.rarity === 'Rare');
    const epics = cardSet.filter(c => c.rarity === 'epique');
    const legendaries = cardSet.filter(c => c.rarity === 'Légendaire');
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
    // Même minuit que la boutique et les quêtes du jour (heure de Paris)
    const today = getDayKey();
    const lastReset = userData.dailyLastReset ? getDayKey(new Date(userData.dailyLastReset.seconds * 1000)) : null;
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
            } else if (boosterType === 'classic') {
                if ((currentData.boosterInventory?.classic || 0) < 1) throw new Error("Pas de booster classique à ouvrir.");
                updates['boosterInventory.classic'] = increment(-1);
            } else if (boosterType === 'legendary') {
                if ((currentData.boosterInventory?.legendary || 0) < 1) throw new Error("Pas de booster légendaire à ouvrir.");
                updates['boosterInventory.legendary'] = increment(-1);
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
