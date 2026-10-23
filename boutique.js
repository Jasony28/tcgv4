// Fichier: boutique.js — boutique du jour (3 cartes), boosters et cadeau quotidien
import { doc, getDoc, runTransaction, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { updateQuestProgress } from './quest-manager.js';
import { updateUserStats } from './stats-manager.js';
import { getDayKey, msUntilNextDay, formatDuration } from './daily-utils.js';
import {
    getDailyShop, SHOP_RARITY_ODDS, SHOP_BOOSTERS, DAILY_GIFT_COINS, RARITY_LABELS
} from './shop-config.js';

const shopCardsEl = document.getElementById('shop-cards');
const shopBoostersEl = document.getElementById('shop-boosters');
const countdownEl = document.getElementById('shop-countdown');
const giftButton = document.getElementById('gift-button');
const giftSubtitle = document.getElementById('gift-subtitle');
const giftBanner = document.getElementById('daily-gift');
const oddsToggle = document.getElementById('odds-toggle');
const oddsPanel = document.getElementById('odds-panel');

let userData;
let currentDay = getDayKey();
let busy = false;

/** État boutique du joueur pour aujourd'hui (remis à zéro automatiquement chaque jour). */
function getShopState(data, day) {
    const s = (data?.shop && data.shop.day === day) ? data.shop : {};
    const boosters = {};
    for (const type of Object.keys(SHOP_BOOSTERS)) boosters[type] = s.boosters?.[type] || 0;
    return { day, bought: s.bought || {}, boosters, giftClaimed: !!s.giftClaimed };
}

const rarityClass = (rarity) => `rarity-${rarity.replace(/é/g, 'e')}`;

// ---------- Affichage ----------

function render() {
    const state = getShopState(userData, currentDay);
    const coins = userData.coins || 0;

    // Cadeau
    giftBanner.classList.toggle('claimed', state.giftClaimed);
    giftButton.disabled = state.giftClaimed;
    giftButton.textContent = state.giftClaimed ? 'Récupéré ✓' : `+${DAILY_GIFT_COINS} pièces`;
    giftSubtitle.textContent = state.giftClaimed ? 'Reviens demain pour un nouveau cadeau' : 'Des pièces gratuites chaque jour';

    // Cartes du jour
    shopCardsEl.innerHTML = '';
    for (const offer of getDailyShop(currentDay)) {
        const { card, price } = offer;
        const bought = !!state.bought[card.id];
        const owned = userData.collection?.[card.id]?.quantity || 0;
        const item = document.createElement('div');
        item.className = `shop-item ${bought ? 'sold' : ''}`;
        item.innerHTML = `
            <span class="rarity-chip ${rarityClass(card.rarity)}">${RARITY_LABELS[card.rarity]}</span>
            <div class="card ${rarityClass(card.rarity)}">
                <img class="card-image" src="${card.image}" alt="${card.name}">
                ${owned === 0 ? '<span class="new-ribbon">Nouvelle</span>' : ''}
            </div>
            <p class="shop-item-name">${card.name}</p>
            <button class="price-button" ${bought || coins < price ? 'disabled' : ''}>
                ${bought ? 'Achetée ✓' : `<span class="coin-icon"></span>${price}`}
            </button>
        `;
        if (!bought) item.querySelector('.price-button').addEventListener('click', () => buyCard(offer));
        shopCardsEl.appendChild(item);
    }

    // Boosters
    shopBoostersEl.innerHTML = '';
    for (const [type, def] of Object.entries(SHOP_BOOSTERS)) {
        const boughtToday = state.boosters[type] || 0;
        const soldOut = boughtToday >= def.dailyLimit;
        const item = document.createElement('div');
        item.className = `booster-item ${type} ${soldOut ? 'sold' : ''}`;
        item.innerHTML = `
            <img src="assets/booster/booster.png" alt="${def.name}">
            <div class="booster-item-info">
                <strong>${def.name}</strong>
                <span>${def.description}</span>
                <span class="booster-stock">${boughtToday}/${def.dailyLimit} achetés aujourd'hui</span>
            </div>
            <button class="price-button" ${soldOut || coins < def.price ? 'disabled' : ''}>
                ${soldOut ? 'Épuisé' : `<span class="coin-icon"></span>${def.price}`}
            </button>
        `;
        if (!soldOut) item.querySelector('.price-button').addEventListener('click', () => buyBooster(type));
        shopBoostersEl.appendChild(item);
    }
}

function renderOdds() {
    oddsPanel.innerHTML = `
        <p>Chaque emplacement tire une rareté au hasard :</p>
        <ul>${SHOP_RARITY_ODDS.map(o => `<li><span class="rarity-chip ${rarityClass(o.rarity)}">${o.label}</span><strong>${o.chance}%</strong></li>`).join('')}</ul>
        <p>Maximum une légendaire par jour. La boutique change tous les jours à minuit.</p>
    `;
}

function tick() {
    countdownEl.textContent = formatDuration(msUntilNextDay());
    // Passage à minuit : nouvelle boutique sans recharger
    const day = getDayKey();
    if (day !== currentDay) {
        currentDay = day;
        render();
        showToast('info', 'La boutique a été renouvelée !');
    }
}

async function refreshUser() {
    const snap = await getDoc(doc(db, "users", userData.uid));
    userData = { uid: userData.uid, ...snap.data() };
    render();
}

// ---------- Achats (transactions) ----------

async function runShopTransaction(mutate) {
    const userRef = doc(db, "users", userData.uid);
    await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(userRef);
        if (!snap.exists()) throw new Error("Utilisateur non trouvé.");
        const data = snap.data();
        const state = getShopState(data, getDayKey());
        const updates = mutate(data, state) || {};
        updates.shop = state;
        transaction.update(userRef, updates);
    });
}

async function buyCard(offer) {
    if (busy) return;
    const { card, price } = offer;
    const ok = await showConfirmDialog({
        title: 'Acheter cette carte ?',
        message: `${card.name} (${RARITY_LABELS[card.rarity]}) pour ${price} pièces.`,
        confirmText: 'Acheter',
        cancelText: 'Annuler'
    });
    if (!ok) return;

    busy = true;
    try {
        // On revérifie que la carte est toujours dans la boutique (passage de minuit pendant la confirmation)
        if (!getDailyShop(getDayKey()).some(o => o.card.id === card.id)) throw new Error("La boutique vient de changer !");
        await runShopTransaction((data, state) => {
            if (state.bought[card.id]) throw new Error("Tu as déjà acheté cette carte aujourd'hui.");
            if ((data.coins || 0) < price) throw new Error("Pas assez de pièces !");
            state.bought[card.id] = true;
            return {
                coins: increment(-price),
                [`collection.${card.id}.quantity`]: increment(1)
            };
        });
        showToast('success', `${card.name} ajoutée à ta collection !`);
        await updateUserStats(userData.uid, { bestPurchase: { cardId: card.id, price } });
        await updateQuestProgress('shop_buy');
        await updateQuestProgress('obtain_10_diff_cards_24h', 1, { cardId: card.id });
    } catch (e) {
        showToast('error', e.message || "Achat impossible.");
    } finally {
        busy = false;
        await refreshUser();
    }
}

async function buyBooster(type) {
    if (busy) return;
    const def = SHOP_BOOSTERS[type];
    const ok = await showConfirmDialog({
        title: 'Acheter un booster ?',
        message: `${def.name} pour ${def.price} pièces. Il t'attendra sur la page Booster.`,
        confirmText: 'Acheter',
        cancelText: 'Annuler'
    });
    if (!ok) return;

    busy = true;
    try {
        await runShopTransaction((data, state) => {
            if ((state.boosters[type] || 0) >= def.dailyLimit) throw new Error("Limite du jour atteinte pour ce booster.");
            if ((data.coins || 0) < def.price) throw new Error("Pas assez de pièces !");
            state.boosters[type] = (state.boosters[type] || 0) + 1;
            return {
                coins: increment(-def.price),
                [`boosterInventory.${type}`]: increment(1)
            };
        });
        showToast('success', `${def.name} acheté ! Va l'ouvrir sur la page Booster.`);
        await updateQuestProgress('shop_buy');
    } catch (e) {
        showToast('error', e.message || "Achat impossible.");
    } finally {
        busy = false;
        await refreshUser();
    }
}

async function claimGift() {
    if (busy) return;
    busy = true;
    giftButton.disabled = true;
    try {
        await runShopTransaction((data, state) => {
            if (state.giftClaimed) throw new Error("Cadeau déjà récupéré aujourd'hui.");
            state.giftClaimed = true;
            return { coins: increment(DAILY_GIFT_COINS) };
        });
        showToast('success', `+${DAILY_GIFT_COINS} pièces ! Reviens demain.`);
    } catch (e) {
        showToast('error', e.message || "Impossible de récupérer le cadeau.");
    } finally {
        busy = false;
        await refreshUser();
    }
}

// ---------- Lancement ----------

async function initializeShop() {
    userData = await protectPage();
    if (!userData) return;

    giftButton.addEventListener('click', claimGift);
    oddsToggle.addEventListener('click', () => {
        oddsPanel.hidden = !oddsPanel.hidden;
        oddsToggle.setAttribute('aria-expanded', String(!oddsPanel.hidden));
    });

    renderOdds();
    render();
    tick();
    setInterval(tick, 1000);
}

initializeShop();
