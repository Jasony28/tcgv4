// Fichier: collection.js (Version Finale Complète et Corrigée)

import { protectPage } from './auth-manager.js';
import { showConfirmDialog } from './toast.js';
import { sellCardToConsole } from './marche.js';

// --- Éléments du DOM ---
const collectionGrid = document.getElementById('collection-grid');
const overlay = document.getElementById('card-overlay');
const closeBtn = overlay.querySelector('.close-btn');
const viewMode = document.getElementById('view-mode');
const overlayImage = document.getElementById('overlay-image');
const overlayCardName = document.getElementById('overlay-card-name');
const overlayCardQuantity = document.getElementById('overlay-card-quantity');
const auctionButton = document.getElementById('auction-button');
const consoleSellButton = document.getElementById('console-sell-button');
const sellMode = document.getElementById('sell-mode');
const sellCardName = document.getElementById('sell-card-name');
const sellCardPreview = document.getElementById('sell-card-preview');
const sellMaxQuantity = document.getElementById('sell-max-quantity');
const sellPriceContainer = document.getElementById('sell-price-container');
const sellQuantityInput = document.getElementById('sell-quantity-input');
const confirmSellButton = document.getElementById('confirm-sell-button');
const modalErrorMessage = document.getElementById('modal-error-message');

let localUserData;

// --- Fonctions d'affichage et de gestion de l'UI ---

let activeFilter = 'all';

// Filtre affiché (rareté, possédées, manquantes) sans recharger la collection
function applyFilter() {
    collectionGrid.querySelectorAll('.card').forEach(el => {
        const show = activeFilter === 'all'
            || (activeFilter === 'owned' && el.dataset.owned === '1')
            || (activeFilter === 'missing' && el.dataset.owned === '0')
            || el.dataset.rarity === activeFilter;
        el.style.display = show ? '' : 'none';
    });
}

function setupFilters() {
    const chips = document.querySelectorAll('#collection-filters .chip');
    chips.forEach(chip => chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.toggle('active', c === chip));
        activeFilter = chip.dataset.filter;
        applyFilter();
    }));
}

function displayCollection(userCollection, cardsSet) {
    if (!collectionGrid) return;
    collectionGrid.innerHTML = '';

    // Progression de l'album
    const ownedCount = cardsSet.filter(card => userCollection?.[card.id]?.quantity > 0).length;
    const pct = cardsSet.length ? Math.round((ownedCount / cardsSet.length) * 100) : 0;
    document.getElementById('collection-count').textContent = `${ownedCount} / ${cardsSet.length}`;
    document.getElementById('collection-pct').textContent = `${pct}%`;
    document.getElementById('collection-fill').style.width = `${pct}%`;

    // Progression par rareté (chaque rareté complète = un succès dans le profil)
    const rarityIcons = [['Commune', '⚪'], ['Rare', '🔷'], ['epique', '💜'], ['Légendaire', '👑']];
    document.getElementById('album-achievements').innerHTML = rarityIcons.map(([rarity, icon]) => {
        const ofRarity = cardsSet.filter(c => c.rarity === rarity);
        if (!ofRarity.length) return '';
        const have = ofRarity.filter(c => userCollection?.[c.id]?.quantity > 0).length;
        const done = have === ofRarity.length;
        return `<span class="rarity-progress ${done ? 'done' : ''}">${icon} ${have}/${ofRarity.length}${done ? ' 🏅' : ''}</span>`;
    }).join('');

    cardsSet.forEach(card => {
        const cardData = userCollection ? (userCollection[card.id] || null) : null;
        const owned = cardData && cardData.quantity > 0;
        const cardDiv = document.createElement('div');
        // Correction pour la classe CSS : remplace les accents pour être compatible
        cardDiv.className = `card rarity-${card.rarity.replace(/é/g, 'e').replace(/É/g, 'E')}`;
        cardDiv.dataset.rarity = card.rarity;
        cardDiv.dataset.owned = owned ? '1' : '0';

        if (owned) {
            const cardImage = document.createElement('img');
            cardImage.className = 'card-image';
            cardImage.src = card.image;
            cardImage.alt = card.name;
            cardDiv.appendChild(cardImage);

            if (cardData.quantity > 1) {
                const quantityDiv = document.createElement('div');
                quantityDiv.className = 'card-quantity';
                quantityDiv.textContent = `x${cardData.quantity}`;
                cardDiv.appendChild(quantityDiv);
            }
            cardDiv.addEventListener('click', () => openCardOverlay(card, cardData));
        } else {
            cardDiv.classList.add('card-back-display');
        }
        
        collectionGrid.appendChild(cardDiv);
    });
    applyFilter();
}

function openCardOverlay(card, cardData) {
    modalErrorMessage.textContent = '';
    viewMode.style.display = 'block';
    sellMode.style.display = 'none';
    overlayImage.src = card.image;
    overlayCardName.textContent = card.name;
    overlayCardQuantity.textContent = cardData.quantity;
    const hasDuplicates = cardData.quantity > 1;
    auctionButton.style.display = hasDuplicates ? 'block' : 'none';
    consoleSellButton.style.display = hasDuplicates ? 'block' : 'none';

    if (hasDuplicates) {
        // Enchère ou échange : on passe par l'Hôtel des Ventes, avec la carte déjà sélectionnée
        auctionButton.onclick = () => { window.location.href = `marche.html?sell=${encodeURIComponent(card.id)}`; };
        consoleSellButton.onclick = () => showConsoleSellForm(card, cardData);
    }
    overlay.style.display = 'flex';
}

function closeOverlay() {
    overlay.style.display = 'none';
}

function showConsoleSellForm(card, cardData) {
    viewMode.style.display = 'none';
    sellMode.style.display = 'block';
    const maxQuantity = cardData.quantity - 1;

    sellCardName.textContent = `Vendre '${card.name}' à la console`;
    sellCardPreview.innerHTML = `<img src="${card.image}" class="card-image">`;
    sellCardPreview.className = `card rarity-${card.rarity.replace(/é/g, 'e').replace(/É/g, 'E')}`;
    sellMaxQuantity.textContent = maxQuantity;
    sellPriceContainer.style.display = 'none'; // On cache le prix pour la vente console
    sellQuantityInput.max = maxQuantity;
    sellQuantityInput.value = 1;
    sellQuantityInput.min = 1;
    confirmSellButton.textContent = "Vendre à la console";
    confirmSellButton.onclick = () => handleConsoleSell(card, cardData);
}

// --- Fonctions de logique métier (interactions avec la DB) ---

async function handleConsoleSell(card, cardData) {
    const quantityToSell = parseInt(sellQuantityInput.value);
    const maxQuantity = cardData.quantity - 1;

    if (!quantityToSell || quantityToSell <= 0 || quantityToSell > maxQuantity) {
        modalErrorMessage.textContent = `La quantité doit être entre 1 et ${maxQuantity}.`;
        return;
    }
    const consoleSellPrices = { "Commune": 1, "Rare": 2, "epique": 5, "Légendaire": 20 };
    const pricePerCard = consoleSellPrices[card.rarity];
    const ok = await showConfirmDialog({
        title: "Vente à la console",
        message: `Voulez-vous vraiment vendre ${quantityToSell} exemplaire(s) de '${card.name}' pour ${pricePerCard * quantityToSell} pièce(s) ?`,
        confirmText: "Vendre",
        cancelText: "Annuler"
    });

    if (!ok) return;

    // Bouton désactivé pendant la vente pour éviter une double vente au double clic
    confirmSellButton.disabled = true;
    try {
        // On passe la rareté : sinon les cartes V2 ne comptaient pas pour les quêtes de vente
        await sellCardToConsole(card.id, quantityToSell, pricePerCard, card.rarity);
    } finally {
        confirmSellButton.disabled = false;
    }
    closeOverlay();
    // Recharger la collection pour voir les changements
    initializeCollection(); 
}

// --- FONCTION PRINCIPALE (RESTAURÉE) ---
async function initializeCollection() {
    const urlParams = new URLSearchParams(window.location.search);
    const set = urlParams.get('set') || 'v1';
    
    localUserData = await protectPage();
    if (!localUserData) return;

    const pageTitle = document.querySelector('.collection-container h2');
    if (pageTitle) {
        pageTitle.textContent = `Ma Collection (V${set.replace('v', '')})`;
    }
    
    let cardsToDisplay = [];
    try {
        if (set === 'v2') {
            const { allCardsV2 } = await import('./cards1.js');
            cardsToDisplay = allCardsV2;
        } else if (set === 'v3') {
            const { allCardsV3, V3_RELEASED } = await import('./cards-v3.js');
            cardsToDisplay = allCardsV3;
            // Avant la sortie : bandeau d'annonce
            document.getElementById('v3-banner').hidden = V3_RELEASED;
        } else {
            const { allCards } = await import('./cards.js');
            cardsToDisplay = allCards;
        }
    } catch(e) {
        console.error(`Erreur lors du chargement du set de cartes '${set}':`, e);
        if(collectionGrid) collectionGrid.innerHTML = `<p class="error">Impossible de charger les cartes pour cette collection.</p>`;
        return;
    }

    if (!localUserData.collection) localUserData.collection = {};
    displayCollection(localUserData.collection, cardsToDisplay);
}


// --- ÉCOUTEURS D'ÉVÉNEMENTS ET APPEL INITIAL ---
if (collectionGrid) {
    closeBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeOverlay();
    });

    setupFilters();
    initializeCollection();
}