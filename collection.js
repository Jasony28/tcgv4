// Fichier: collection.js (Version Finale Complète et Corrigée)

import { doc, runTransaction, Timestamp, collection, increment } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { sellCardToConsole } from './marche.js'; // Assurez-vous que marche.js exporte bien cette fonction

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
const sellMinPrice = document.getElementById('sell-min-price');
const sellQuantityInput = document.getElementById('sell-quantity-input');
const sellPriceInput = document.getElementById('sell-price-input');
const confirmSellButton = document.getElementById('confirm-sell-button');
const modalErrorMessage = document.getElementById('modal-error-message');

let localUserData;

// --- Fonctions d'affichage et de gestion de l'UI ---

function displayCollection(userCollection, cardsSet) {
    if (!collectionGrid) return;
    collectionGrid.innerHTML = '';

    cardsSet.forEach(card => {
        const cardData = userCollection ? (userCollection[card.id] || null) : null;
        const owned = cardData && cardData.quantity > 0;
        const cardDiv = document.createElement('div');
        // Correction pour la classe CSS : remplace les accents pour être compatible
        cardDiv.className = `card rarity-${card.rarity.replace(/é/g, 'e').replace(/É/g, 'E')}`;

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
        auctionButton.onclick = () => showAuctionForm(card, cardData);
        consoleSellButton.onclick = () => showConsoleSellForm(card, cardData);
    }
    overlay.style.display = 'flex';
}

function closeOverlay() {
    overlay.style.display = 'none';
}

function showAuctionForm(card, cardData) {
    viewMode.style.display = 'none';
    sellMode.style.display = 'block';
    const minPrice = { "Commune": 5, "Rare": 10, "epique": 25, "Légendaire": 100 };
    const maxQuantity = cardData.quantity - 1;

    sellCardName.textContent = `Mettre '${card.name}' aux enchères`;
    sellCardPreview.innerHTML = `<img src="${card.image}" class="card-image">`;
    sellCardPreview.className = `card rarity-${card.rarity.replace(/é/g, 'e').replace(/É/g, 'E')}`;
    sellMaxQuantity.textContent = maxQuantity;
    sellMinPrice.textContent = minPrice[card.rarity];
    sellQuantityInput.max = maxQuantity;
    sellQuantityInput.value = 1;
    sellQuantityInput.min = 1;
    sellPriceContainer.style.display = 'block';
    sellPriceInput.min = minPrice[card.rarity];
    sellPriceInput.value = minPrice[card.rarity];
    confirmSellButton.textContent = "Confirmer la mise en vente";
    confirmSellButton.onclick = () => createAuction(card, cardData);
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

    await sellCardToConsole(card.id, quantityToSell, pricePerCard);
    closeOverlay();
    // Recharger la collection pour voir les changements
    initializeCollection(); 
}

async function createAuction(card, cardData) {
    const quantityToSell = parseInt(sellQuantityInput.value);
    const startPrice = parseInt(sellPriceInput.value);
    const minPrice = { "Commune": 5, "Rare": 10, "epique": 25, "Légendaire": 100 }[card.rarity];
    const maxQuantity = cardData.quantity - 1;

    if (!quantityToSell || quantityToSell <= 0 || quantityToSell > maxQuantity) {
        modalErrorMessage.textContent = `La quantité doit être entre 1 et ${maxQuantity}.`;
        return;
    }
    if (!startPrice || startPrice < minPrice) {
        modalErrorMessage.textContent = `Le prix de départ doit être d'au moins ${minPrice} pièces.`;
        return;
    }

    confirmSellButton.disabled = true;
    modalErrorMessage.textContent = "Création de l'enchère...";

    try {
        const userDocRef = doc(db, "users", localUserData.uid);
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userDocRef);
            if (!userDoc.exists()) throw new Error("Document utilisateur non trouvé.");
            
            const currentCollection = userDoc.data().collection;
            if (!currentCollection[card.id] || currentCollection[card.id].quantity <= quantityToSell) {
                throw new Error("Vous ne possédez pas assez de doubles de cette carte.");
            }
            
            transaction.update(userDocRef, { [`collection.${card.id}.quantity`]: increment(-quantityToSell) });

           
            const endTime = Timestamp.fromMillis(Date.now() + 12 * 60 * 60 * 1000); 
            const auctionData = {
                sellerId: localUserData.uid,
                sellerPseudo: localUserData.pseudo,
                cardId: card.id,
                quantity: quantityToSell,
                startPrice: startPrice,
                currentPrice: startPrice,
                highestBidderId: null,
                highestBidderPseudo: null,
                endTime: endTime,
                status: 'active'
            };
            const auctionsColRef = collection(db, "auctions");
            transaction.set(doc(auctionsColRef), auctionData);
        });

        showToast("Votre carte a été mise aux enchères avec succès !", "success");
        closeOverlay();
        initializeCollection();
        
    } catch (error) {
        modalErrorMessage.textContent = `Erreur : ${error.message || error}`;
    } finally {
        confirmSellButton.disabled = false;
    }
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

    // C'est cet appel qui causait l'erreur car la fonction ci-dessus manquait.
    initializeCollection();
}