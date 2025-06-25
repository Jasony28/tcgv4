import { collection, query, where, getDocs, getDoc, Timestamp, doc, runTransaction, onSnapshot, orderBy, increment }
from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { allCards } from './cards.js';
import { showToast, showConfirmDialog } from './toast.js';
import { updateUserStats } from './stats-manager.js'; // ou le fichier où tu mets la fonction
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { updateQuestProgress } from './quest-manager.js';

// Variables globales
let localUserData;
let unsubscribeBidListener = null;

const auctionsGrid = document.getElementById('auctions-grid');
const noAuctionsMessage = document.getElementById('no-auctions-message');
const bidModal = document.getElementById('bid-modal');

function normalizeRarity(rawRarity) {
  if (!rawRarity) return '';
  let r = rawRarity.toLowerCase();
  r = r.replace('é', 'e');
  if (r === 'epique') return 'Épique';
  if (r === 'commune') return 'Commune';
  if (r === 'rare') return 'Rare';
  if (r === 'legendaire') return 'Légendaire';
  return rawRarity;
}

// Initialisation du marché si la grille est présente
if (auctionsGrid) initializeMarketplace();

async function initializeMarketplace() {
    localUserData = await protectPage();
    if (!localUserData) return;

    // Fermer la modale
    const closeModalBtn = bidModal.querySelector('.close-btn');
    closeModalBtn.addEventListener('click', closeBidModal);
    bidModal.addEventListener('click', (e) => {
        if (e.target === bidModal) closeBidModal();
    });

    await finalizeExpiredAuctions();
    fetchAndDisplayAuctions();
}

// Affiche les enchères actives
async function fetchAndDisplayAuctions() {
    auctionsGrid.innerHTML = '';
    const q = query(collection(db, "auctions"), where("status", "==", "active"));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        noAuctionsMessage.style.display = 'block';
    } else {
        noAuctionsMessage.style.display = 'none';
        for (const docSnap of querySnapshot.docs) {
            const auctionData = { id: docSnap.id, ...docSnap.data() };

            // === NOUVEAU : On vérifie si le vendeur existe ===
            const sellerRef = doc(db, 'users', auctionData.sellerId);
            const sellerSnap = await getDoc(sellerRef);
            if (!sellerSnap.exists()) continue; // On saute les enchères orphelines

            const cardInfo = allCards.find(c => c.id === auctionData.cardId);
            if (cardInfo) {
                const auctionCard = createAuctionCard(auctionData, cardInfo);
                auctionsGrid.appendChild(auctionCard);
            }
        }
    }
}


// Crée une carte d'enchère HTML
function createAuctionCard(auction, card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `card rarity-${card.rarity.replace(/é/g, 'e')}`;
    cardDiv.style.cursor = 'pointer';

    const cardImage = document.createElement('img');
    cardImage.className = 'card-image';
    cardImage.src = card.image;
    cardImage.alt = card.name;
    cardDiv.appendChild(cardImage);

    const owned = localUserData.collection?.[card.id]?.quantity > 0;
    const badge = document.createElement('div');
    badge.className = `ownership-badge ${owned ? 'owned' : 'not-owned'}`;
    badge.textContent = owned ? 'Possédée' : 'Pas possédée';
    cardDiv.appendChild(badge);

    const infoOverlay = document.createElement('div');
    infoOverlay.className = 'auction-info-overlay';
    const timeLeft = calculateTimeLeft(auction.endTime);
    infoOverlay.innerHTML = `<p class="auction-card-name">${card.name} (x${auction.quantity})</p><p>Prix: <strong>${auction.currentPrice} pièces</strong></p><p>Temps restant: ${timeLeft}</p>`;
    cardDiv.appendChild(infoOverlay);

    cardDiv.addEventListener('click', () => {
        if (auction.sellerId === localUserData.uid) {
            openOwnAuctionModal(auction, card);
        } else {
            openBidModal(auction, card);
        }
    });
    return cardDiv;
}

// Modale pour miser sur une enchère d'un AUTRE joueur
function openBidModal(auction, card) {
    const bidForm = document.querySelector('.bid-form');
    if(bidForm) bidForm.style.display = 'flex';

    document.getElementById('modal-error-message').textContent = '';
    document.getElementById('modal-card-name').textContent = `${card.name} (x${auction.quantity})`;
    document.getElementById('modal-card-preview').innerHTML = `<img src="${card.image}" class="card-image">`;
    document.getElementById('modal-seller-pseudo').textContent = auction.sellerPseudo;
    document.getElementById('modal-current-price').textContent = auction.currentPrice;
    document.getElementById('modal-time-left').textContent = calculateTimeLeft(auction.endTime);

    const bidAmountInput = document.getElementById('bid-amount-input');
    const minBid = auction.currentPrice + 1;
    bidAmountInput.min = minBid;
    bidAmountInput.placeholder = `Minimum ${minBid} pièces`;
    bidAmountInput.value = minBid;

    // On désactive le bouton annuler sur une enchère qui n'est pas à soi
    document.getElementById('cancel-auction-button').style.display = 'none';

    // Rafraîchit l'écouteur du bouton de mise
    const submitBtn = document.getElementById('submit-bid-button');
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
   newSubmitBtn.addEventListener('click', () => handlePlaceBid(auction));

    fetchAndDisplayBidHistory(auction.id);
    bidModal.style.display = 'flex';
}

// Modale pour gérer SA PROPRE enchère (avec bouton Annuler)
function openOwnAuctionModal(auction, card) {
    document.querySelector('.bid-form').style.display = 'none';

    document.getElementById('modal-card-name').textContent = `${card.name} (x${auction.quantity})`;
    document.getElementById('modal-card-preview').innerHTML = `<img src="${card.image}" class="card-image">`;
    document.getElementById('modal-seller-pseudo').textContent = auction.sellerPseudo;
    document.getElementById('modal-current-price').textContent = auction.currentPrice;
    document.getElementById('modal-time-left').textContent = calculateTimeLeft(auction.endTime);



const cancelButton = document.getElementById('cancel-auction-button');
cancelButton.style.display = 'block';
const newCancelButton = cancelButton.cloneNode(true);
newCancelButton.addEventListener('click', async () => {
    console.log("Bouton ANNULER ENCHERE cliqué !");
    await handleCancelAuction(auction);
});
cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);

    fetchAndDisplayBidHistory(auction.id);
    bidModal.style.display = 'flex';
}

// Finalise les enchères expirées (corrigé anti-bug)
async function finalizeExpiredAuctions() {
  const q = query(
    collection(db, "auctions"),
    where("status", "==", "active"),
    where("endTime", "<=", Timestamp.now())
  );
  const snapshot = await getDocs(q);

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const auctionRef = doc(db, "auctions", docSnap.id);

    await runTransaction(db, async (transaction) => {
      const sellerRef = doc(db, "users", data.sellerId);
      const sellerDoc = await transaction.get(sellerRef);

      // Vérif : si vendeur supprimé, on termine juste l'enchère, pas d'update vendeur
      if (!sellerDoc.exists()) {
        transaction.update(auctionRef, { status: 'ended' });
        return;
      }

      // Si vente réussie
      if (data.highestBidderId) {
        const buyerRef = doc(db, "users", data.highestBidderId);
        const buyerDoc = await transaction.get(buyerRef);

        // Vérif : si l'acheteur est supprimé, rembourse juste le vendeur et termine l'enchère
        if (!buyerDoc.exists()) {
          transaction.update(sellerRef, { coins: increment(data.currentPrice) });
          transaction.update(auctionRef, { status: 'ended' });
          return;
        }

        const buyerCollectionPath = `collection.${data.cardId}.quantity`;
        transaction.update(buyerRef, { [buyerCollectionPath]: increment(data.quantity) });
        transaction.update(sellerRef, { coins: increment(data.currentPrice) });
        transaction.update(auctionRef, { status: 'ended' });
        // On peut placer updateQuestProgress('win_bid') APRES la transaction hors du bloc
      } else {
        // Vente échouée
        const returnPath = `collection.${data.cardId}.quantity`;
        transaction.update(sellerRef, { [returnPath]: increment(data.quantity) });
        transaction.update(auctionRef, { status: 'ended' });
      }
    });

    // Statistiques (hors transaction)
    if (data.highestBidderId) {
      await handleSuccessfulMarketSale(data.sellerId, data.cardId, data.currentPrice);
      await handleSuccessfulMarketPurchase(data.highestBidderId, data.cardId, data.currentPrice);
      await updateQuestProgress('win_bid');
    } else {
      await updateUserStats(data.sellerId, { failedSales: 1 });
    }
  }
}


function closeBidModal() {
  if (unsubscribeBidListener) {
    unsubscribeBidListener();
    unsubscribeBidListener = null;
  }
  if (bidModal) bidModal.style.display = 'none';
}

// Affiche l'historique des enchères
function fetchAndDisplayBidHistory(auctionId) {
  const bidHistoryList = document.getElementById('bid-history-list');
  const bidsRef = collection(db, "auctions", auctionId, "bids");
  const q = query(bidsRef, orderBy("timestamp", "desc"));

  if (unsubscribeBidListener) unsubscribeBidListener();

  unsubscribeBidListener = onSnapshot(q, (snapshot) => {
    bidHistoryList.innerHTML = '';
    if (snapshot.empty) {
      bidHistoryList.innerHTML = '<li>Aucune enchère pour le moment.</li>';
    } else {
      snapshot.forEach(doc => {
        const bid = doc.data();
        const li = document.createElement('li');
        li.innerHTML = `<strong>${bid.bidderPseudo}</strong> a enchéri <strong>${bid.amount}</strong> pièces`;
        bidHistoryList.appendChild(li);
      });
    }
  });
}
// Fonction utilitaire pour le vendeur
async function handleSuccessfulMarketSale(userId, cardId, price) {
  await updateUserStats(userId, {
    cardsSoldMarket: 1,
    bestSale: { cardId, price }
  });
}

// Fonction utilitaire pour l’acheteur
async function handleSuccessfulMarketPurchase(userId, cardId, price) {
  await updateUserStats(userId, {
    bestPurchase: { cardId, price }
  });
}

// Finalise les enchères expirées


// Calcul du temps restant
function calculateTimeLeft(endTime) {
  const diff = endTime.toMillis() - Date.now();
  if (diff <= 0) return "Terminée";

  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
async function handlePlaceBid(auction) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    showToast("error", "Connecte-toi pour miser !");
    return;
  }

  // Récupérer montant de la mise
  const bidAmountInput = document.getElementById('bid-amount-input');
  const bidAmount = parseInt(bidAmountInput.value);
  const minBid = auction.currentPrice + 1;
  if (!bidAmount || bidAmount < minBid) {
    showToast("error", `Enchère trop basse ! (minimum ${minBid})`);
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const auctionRef = doc(db, "auctions", auction.id);
  const bidsCol = collection(db, "auctions", auction.id, "bids");

  try {
    await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const auctionDoc = await transaction.get(auctionRef);

      if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
      if (!auctionDoc.exists()) throw new Error("Enchère introuvable.");
      if (auctionDoc.data().status !== "active") throw new Error("Enchère terminée ou annulée.");

      const userData = userDoc.data();
      const auctionData = auctionDoc.data();

      // Vérifie le solde
      if ((userData.coins || 0) < bidAmount) {
        throw new Error("Pas assez de pièces pour miser !");
      }

      // Si il y a déjà un highestBidder, rembourse-le
      if (auctionData.highestBidderId && auctionData.highestBidderId !== user.uid) {
        const lastBidderRef = doc(db, "users", auctionData.highestBidderId);
        transaction.update(lastBidderRef, { coins: increment(auctionData.currentPrice) });
      }

      // Déduit les pièces de l'utilisateur
      transaction.update(userRef, { coins: increment(-bidAmount) });

      // Met à jour le document d’enchère
      transaction.update(auctionRef, {
        currentPrice: bidAmount,
        highestBidderId: user.uid,
        highestBidderPseudo: userData.pseudo || "???"
      });

      // Ajoute l'enchère à l'historique
      const bidRef = doc(bidsCol);
      transaction.set(bidRef, {
        amount: bidAmount,
        bidderId: user.uid,
        bidderPseudo: userData.pseudo || "???",
        timestamp: Timestamp.now()
      });
    });

    showToast("success", "Enchère placée !");
    closeBidModal();
    fetchAndDisplayAuctions();
  } catch (error) {
    showToast("error", error.message || "Erreur lors de la mise.");
    console.error("Erreur place bid :", error);
  }
}

export async function sellCardToConsole(cardId, quantity = 1, pricePerCard = 1, rarity = null) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    showToast("error", "Utilisateur non connecté !");
    return;
  }
  const userRef = doc(db, "users", user.uid);

  try {
    await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists()) throw new Error("Utilisateur non trouvé.");
      const currentData = userDoc.data();

      // Vérifie la quantité de cartes
      const currentQuantity = currentData.collection?.[cardId]?.quantity || 0;
      if (currentQuantity < quantity) throw new Error("Pas assez de cartes à vendre.");

      // Retire les cartes
      transaction.update(userRef, { [`collection.${cardId}.quantity`]: increment(-quantity) });
      // Ajoute les pièces
      transaction.update(userRef, { coins: increment(pricePerCard * quantity) });
    });

    // Mets à jour les stats (une seule fois après la transaction)
    await updateUserStats(user.uid, { cardsSoldConsole: quantity });

    // ==== AJOUT POUR LES QUÊTES ====
    // Récupère la rareté de la carte vendue
    if (!rarity) {
      // Si on ne passe pas la rareté à la fonction, va la chercher dans allCards
      const card = allCards.find(c => c.id === cardId);
      rarity = card?.rarity || null;
    }
    const usedRarity = normalizeRarity(rarity);
if (usedRarity === "Épique") {
  await updateQuestProgress('sell_epic_console');
}
if (usedRarity === "Légendaire") {
  await updateQuestProgress('sell_legendary_console');
}

    // ==============================

    showToast("success", `Carte vendue à la console pour ${pricePerCard * quantity} pièce(s) !`);
  } catch (error) {
    showToast("error", error.message || "Erreur lors de la vente à la console.");
    console.error("Erreur vente console :", error);
  }
}
