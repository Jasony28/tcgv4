import { collection, query, where, getDocs, getDoc, Timestamp, doc, runTransaction, onSnapshot, orderBy, increment }
from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { allCards as allCardsV1 } from './cards.js';
import { allCardsV2 } from './cards1.js';
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

// Les deux collections (V1 + V2) : sinon les enchères de cartes V2 n'apparaissaient jamais
const allCards = [...allCardsV1, ...allCardsV2];

// Les pseudos sont choisis par les joueurs : on les échappe avant de les insérer en HTML
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
    document.getElementById('modal-error-message').textContent = '';

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
    const auctionRef = doc(db, "auctions", docSnap.id);
    let data = null;

    let finalized = false;
    try {
      await runTransaction(db, async (transaction) => {
        finalized = false;
        // On relit l'enchère DANS la transaction : un autre joueur (ou la Cloud Function)
        // a pu la finaliser entre-temps. Sans ce contrôle, le vendeur était payé plusieurs fois.
        const auctionDoc = await transaction.get(auctionRef);
        if (!auctionDoc.exists() || auctionDoc.data().status !== 'active') return;
        data = auctionDoc.data();

        const sellerRef = doc(db, "users", data.sellerId);
        const sellerDoc = await transaction.get(sellerRef);
        const buyerRef = data.highestBidderId ? doc(db, "users", data.highestBidderId) : null;
        const buyerDoc = buyerRef ? await transaction.get(buyerRef) : null;
        const cardPath = `collection.${data.cardId}.quantity`;

        // Vérif : si vendeur supprimé, on rembourse l'enchérisseur et on termine l'enchère
        if (!sellerDoc.exists()) {
          if (buyerDoc?.exists()) transaction.update(buyerRef, { coins: increment(data.currentPrice) });
          transaction.update(auctionRef, { status: 'ended' });
          return;
        }

        // Si vente réussie
        if (data.highestBidderId) {
          // Vérif : si l'acheteur est supprimé, on paie quand même le vendeur et on termine l'enchère
          if (!buyerDoc.exists()) {
            transaction.update(sellerRef, { coins: increment(data.currentPrice) });
            transaction.update(auctionRef, { status: 'ended' });
            return;
          }

          transaction.update(buyerRef, { [cardPath]: increment(data.quantity) });
          transaction.update(sellerRef, { coins: increment(data.currentPrice) });
          transaction.update(auctionRef, { status: 'ended' });
        } else {
          // Vente échouée
          transaction.update(sellerRef, { [cardPath]: increment(data.quantity) });
          transaction.update(auctionRef, { status: 'ended' });
        }
        finalized = true;
      });
    } catch (e) {
      console.error("Erreur finalisation enchère :", e);
      continue;
    }

    if (!finalized) continue;

    // Statistiques (hors transaction)
    if (data.highestBidderId) {
      await handleSuccessfulMarketSale(data.sellerId, data.cardId, data.currentPrice);
      await handleSuccessfulMarketPurchase(data.highestBidderId, data.cardId, data.currentPrice);
      // La quête ne peut être créditée qu'au joueur connecté : seulement s'il est le gagnant
      // (avant, c'était n'importe quel visiteur du marché qui la recevait).
      if (data.highestBidderId === localUserData?.uid) {
        await updateQuestProgress('win_bid');
      }
    } else {
      await updateUserStats(data.sellerId, { failedSales: 1 });
    }
  }
}

// Annulation de sa propre enchère : la carte revient au vendeur, le meilleur enchérisseur est remboursé
async function handleCancelAuction(auction) {
  const ok = await showConfirmDialog({
    title: "Annuler l'enchère",
    message: "Voulez-vous vraiment annuler cette enchère ? La carte vous sera rendue et le meilleur enchérisseur remboursé.",
    confirmText: "Oui, annuler",
    cancelText: "Non"
  });
  if (!ok) return;

  const auctionRef = doc(db, "auctions", auction.id);
  try {
    await runTransaction(db, async (transaction) => {
      const auctionDoc = await transaction.get(auctionRef);
      if (!auctionDoc.exists()) throw new Error("Enchère introuvable.");
      const data = auctionDoc.data();
      if (data.sellerId !== localUserData.uid) throw new Error("Ce n'est pas votre enchère.");
      if (data.status !== 'active') throw new Error("Cette enchère est déjà terminée.");

      if (data.highestBidderId) {
        transaction.update(doc(db, "users", data.highestBidderId), { coins: increment(data.currentPrice) });
      }
      transaction.update(doc(db, "users", data.sellerId), { [`collection.${data.cardId}.quantity`]: increment(data.quantity) });
      transaction.update(auctionRef, { status: 'cancelled' });
    });
    showToast("success", "Enchère annulée, la carte vous a été rendue.");
    closeBidModal();
    fetchAndDisplayAuctions();
  } catch (error) {
    showToast("error", error.message || "Erreur lors de l'annulation.");
    console.error("Erreur annulation enchère :", error);
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
        li.innerHTML = `<strong>${escapeHtml(bid.bidderPseudo)}</strong> a enchéri <strong>${escapeHtml(bid.amount)}</strong> pièces`;
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

      // Contrôles sur les données à jour (le prix affiché a pu changer depuis l'ouverture de la modale)
      if (auctionData.sellerId === user.uid) throw new Error("Tu ne peux pas miser sur ta propre enchère.");
      if (auctionData.endTime.toMillis() <= Date.now()) throw new Error("Cette enchère est terminée.");
      if (bidAmount <= auctionData.currentPrice) {
        throw new Error(`Quelqu'un a déjà misé plus ! (minimum ${auctionData.currentPrice + 1})`);
      }

      // Si on est déjà le meilleur enchérisseur, notre ancienne mise est rendue :
      // on ne paie que la différence (avant, l'ancienne mise était perdue).
      const alreadyHighest = auctionData.highestBidderId === user.uid;
      const cost = alreadyHighest ? bidAmount - auctionData.currentPrice : bidAmount;

      // Vérifie le solde
      if ((userData.coins || 0) < cost) {
        throw new Error("Pas assez de pièces pour miser !");
      }

      // Si il y a déjà un autre highestBidder, rembourse-le
      if (auctionData.highestBidderId && !alreadyHighest) {
        const lastBidderRef = doc(db, "users", auctionData.highestBidderId);
        transaction.update(lastBidderRef, { coins: increment(auctionData.currentPrice) });
      }

      // Déduit les pièces de l'utilisateur
      transaction.update(userRef, { coins: increment(-cost) });

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
    updateQuestProgress('place_bid');
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
    await updateQuestProgress('sell_console', quantity);

    // ==== AJOUT POUR LES QUÊTES ====
    // Récupère la rareté de la carte vendue
    if (!rarity) {
      // Si on ne passe pas la rareté à la fonction, va la chercher dans allCards
      const card = allCards.find(c => c.id === cardId);
      rarity = card?.rarity || null;
    }
    const usedRarity = normalizeRarity(rarity);
    // On compte chaque carte vendue (vendre 2 épiques d'un coup = 2 pour la quête)
    if (usedRarity === "Épique") {
      await updateQuestProgress('sell_epic_console', quantity);
    }
    if (usedRarity === "Légendaire") {
      await updateQuestProgress('sell_legendary_console', quantity);
    }

    // ==============================

    showToast("success", `Carte vendue à la console pour ${pricePerCard * quantity} pièce(s) !`);
  } catch (error) {
    showToast("error", error.message || "Erreur lors de la vente à la console.");
    console.error("Erreur vente console :", error);
  }
}
