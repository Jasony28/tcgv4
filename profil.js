import {
  addDoc, collection, serverTimestamp,
  doc, getDoc, updateDoc, arrayUnion, arrayRemove, increment, runTransaction,
  query, where, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { protectPage } from './auth-manager.js';
import { allCards } from './cards.js';
import { db } from './firebase-config.js';
import { showToast } from './toast.js';
import { updateQuestProgress } from './quest-manager.js';

// ----------- VARIABLES GLOBALES -----------

let globalUserData = null;
let currentTradeId = null;
let currentTradeData = null;
let tradeUnsubscribe = null;
let localOffer = {};   // { cardId: qty }
let localCoins = 0;
let ready = false;

// ----------- UTILS -----------

function getCardNameById(cardId) {
  const card = allCards.find(c => c.id === cardId);
  return card ? card.name : cardId || "Aucune";
}
function getCardImg(cardId) {
  const card = allCards.find(c => c.id === cardId);
  return card ? card.image : '';
}

// ----------- INIT PROFIL PAGE -----------

async function initializeProfilPage() {
  const userData = await protectPage();
  if (!userData) return;
  globalUserData = userData;

  document.getElementById('profile-username').textContent = userData.pseudo || "Nom inconnu";
  document.getElementById('profile-coins').textContent = userData.coins || 0;
  const stats = userData.stats || {};
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('stats-boosters-opened', stats.boostersOpened || 0);
  setText('stats-cards-sold-console', stats.cardsSoldConsole || 0);
  setText('stats-cards-sold-market', stats.cardsSoldMarket || 0);
  setText('stats-failed-sales', stats.failedSales || 0);
  setText('stats-best-sale',
    (stats.bestSale && typeof stats.bestSale.price === "number" && stats.bestSale.price > 0)
      ? `${getCardNameById(stats.bestSale.cardId)} (${stats.bestSale.price} pièces)` : "Aucune"
  );
  setText('stats-best-purchase',
    (stats.bestPurchase && typeof stats.bestPurchase.price === "number" && stats.bestPurchase.price > 0)
      ? `${getCardNameById(stats.bestPurchase.cardId)} (${stats.bestPurchase.price} pièces)` : "Aucun"
  );

  // Modale pseudo
  const editPseudoBtn = document.getElementById('edit-pseudo-btn');
  const pseudoChangeInfo = document.getElementById('pseudo-change-info');
  const pseudoModal = document.getElementById('pseudo-modal');
  const newPseudoInput = document.getElementById('new-pseudo-input');
  const confirmPseudoBtn = document.getElementById('confirm-pseudo-btn');
  const closePseudoModal = document.getElementById('close-pseudo-modal');
  if (userData.pseudoChanged) {
    editPseudoBtn.style.display = 'none';
    pseudoChangeInfo.textContent = 'Pseudo déjà modifié.';
  } else {
    editPseudoBtn.style.display = 'inline-block';
    pseudoChangeInfo.textContent = '';
  }
  if (editPseudoBtn && !userData.pseudoChanged) {
    editPseudoBtn.onclick = () => {
      pseudoModal.style.display = "flex";
      setTimeout(() => {
        newPseudoInput.value = '';
        newPseudoInput.focus();
      }, 100);
    };
  }
  if (closePseudoModal) closePseudoModal.onclick = () => pseudoModal.style.display = "none";
  if (confirmPseudoBtn) confirmPseudoBtn.onclick = async () => {
    let newPseudo = newPseudoInput.value.trim();
    if (!newPseudo) return;
    if (newPseudo.length < 3 || newPseudo.length > 20) {
      showToast('error', "Le pseudo doit faire entre 3 et 20 caractères.");
      return;
    }
    const q = query(collection(db, "users"), where("pseudo", "==", newPseudo));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      showToast('error', "Ce pseudo est déjà utilisé, choisis-en un autre.");
      return;
    }
    await updateDoc(doc(db, "users", userData.uid), { pseudo: newPseudo, pseudoChanged: true });
    pseudoModal.style.display = "none";
    showToast('success', "Ton pseudo a été changé pour : " + newPseudo + ". Tu ne pourras plus le modifier.");
    setTimeout(() => location.reload(), 1000);
  };

  // Amis & échanges
  setupFriendsFeature(userData);
  listenForTradeRequests();
  listenForTradeResponses();
}

// ----------- AMIS & LISTES -----------

function setupFriendsFeature(userData) {
  const addFriendBtn = document.getElementById('add-friend-btn');
  if (addFriendBtn) {
    addFriendBtn.onclick = async () => {
      const friendPseudo = prompt("Entrez le pseudo de votre ami à ajouter :");
      if (!friendPseudo || friendPseudo.trim() === "") return;
      const q = query(collection(db, "users"), where("pseudo", "==", friendPseudo.trim()));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        showToast('error', "Aucun utilisateur trouvé avec ce pseudo.");
        return;
      }
      const friendDoc = querySnapshot.docs[0];
      const friendUid = friendDoc.id;
      if (friendUid === userData.uid) {
        showToast('error', "Impossible de s’ajouter soi-même !");
        return;
      }
      if (userData.friends && userData.friends.includes(friendUid)) {
        showToast('error', "Cet utilisateur est déjà dans vos amis !");
        return;
      }
      const friendData = friendDoc.data();
      if (friendData.friendRequests && friendData.friendRequests.includes(userData.uid)) {
        showToast('info', "Demande déjà envoyée, en attente d’acceptation.");
        return;
      }
      await updateDoc(doc(db, "users", friendUid), { friendRequests: arrayUnion(userData.uid) });
      showToast('success', "Demande envoyée !");
    };
  }
  const friendsListBtn = document.getElementById('friends-list-btn');
  if (friendsListBtn) friendsListBtn.onclick = refreshFriendsList;
  const friendRequestsBtn = document.getElementById('friend-requests-btn');
  if (friendRequestsBtn) friendRequestsBtn.onclick = refreshFriendRequestsList;
}

window.refreshFriendsList = async function() {
  const userSnap = await getDoc(doc(db, "users", globalUserData.uid));
  if (!userSnap.exists()) return;
  const userData = { ...globalUserData, ...userSnap.data() };
  globalUserData.friends = userData.friends;
  const section = document.getElementById('friends-section');
  section.innerHTML = "";
  section.style.display = 'block';
  const friends = userData.friends || [];
  if (friends.length === 0) {
    section.innerHTML = "<p style='text-align:center;color:#888'>Tu n’as pas encore d’amis.</p>";
    return;
  }
  for (let friendUid of friends) {
    try {
      const friendRef = doc(db, "users", friendUid);
      const friendSnap = await getDoc(friendRef);
      if (!friendSnap.exists()) continue;
      const friend = friendSnap.data();
      const now = Date.now();
      const lastOnline = friend.lastOnline ? friend.lastOnline.toDate().getTime() : 0;
      const isOnline = (now - lastOnline < 5 * 60 * 1000);
      const friendDiv = document.createElement('div');
      friendDiv.className = 'friend-block';
      friendDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:3px;">
          <strong>${friend.pseudo}</strong>
          <span style="color:${isOnline ? 'green' : '#999'};font-size:0.9em;">
            ${isOnline ? "En ligne" : ("Dernière connexion : " + (lastOnline ? new Date(lastOnline).toLocaleString() : 'inconnue'))}
          </span>
        </div>
        <button class="profile-btn" style="margin-bottom:10px;margin-top:4px;background:#7b9acc;font-size:1em"
          onclick="window.showFriendCollection && window.showFriendCollection('${friendUid}')">Voir la collection</button>
        <button class="profile-btn" style="margin-bottom:10px;margin-top:4px;background:#00b894;font-size:1em"
          onclick="window.startTradeWithFriend && window.startTradeWithFriend('${friendUid}')">Échanger</button>
      `;
      section.appendChild(friendDiv);
    } catch {}
  }
};

window.refreshFriendRequestsList = async function() {
  const section = document.getElementById('friend-requests-section');
  section.innerHTML = "";
  section.style.display = 'block';
  const userSnap = await getDoc(doc(db, "users", globalUserData.uid));
  if (!userSnap.exists()) return;
  const userData = userSnap.data();
  globalUserData.friendRequests = userData.friendRequests || [];
  const requests = userData.friendRequests || [];
  if (requests.length === 0) {
    section.innerHTML = "<p style='color:#888;text-align:center;'>Aucune demande en attente.</p>";
    return;
  }
  for (const requestUid of requests) {
    const reqRef = doc(db, "users", requestUid);
    const reqSnap = await getDoc(reqRef);
    const reqUser = reqSnap.exists() ? reqSnap.data() : { pseudo: "(utilisateur inconnu)" };
    const block = document.createElement('div');
    block.className = 'friend-request-block';
    block.innerHTML = `
      <strong>${reqUser.pseudo}</strong>
      <button class="profile-btn" style="margin-left:10px;background:#7b9acc" onclick="window.acceptFriendRequest && window.acceptFriendRequest('${requestUid}')">Accepter</button>
      <button class="profile-btn" style="margin-left:10px;background:#e67e22" onclick="window.refuseFriendRequest && window.refuseFriendRequest('${requestUid}')">Refuser</button>
    `;
    section.appendChild(block);
  }
};

window.acceptFriendRequest = async function(requestUid) {
  const userRef = doc(db, "users", globalUserData.uid);
  const requesterRef = doc(db, "users", requestUid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data();
  const newRequests = (userData.friendRequests || []).filter(uid => uid !== requestUid);
  await updateDoc(userRef, { friends: arrayUnion(requestUid), friendRequests: newRequests });
  await updateDoc(requesterRef, { friends: arrayUnion(globalUserData.uid) });
  showToast('success', "Demande acceptée !");
  setTimeout(() => refreshFriendRequestsList(), 500);
};
window.refuseFriendRequest = async function(requestUid) {
  const userRef = doc(db, "users", globalUserData.uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.data();
  const newRequests = (userData.friendRequests || []).filter(uid => uid !== requestUid);
  await updateDoc(userRef, { friendRequests: newRequests });
  showToast('info', "Demande refusée.");
  setTimeout(() => refreshFriendRequestsList(), 400);
};

window.showFriendCollection = async function(friendUid) {
  const friendRef = doc(db, "users", friendUid);
  const friendSnap = await getDoc(friendRef);
  if (!friendSnap.exists()) return showToast('error', "Utilisateur introuvable !");
  const friend = friendSnap.data();
  let html = `<h4 style="margin-top:0">${friend.pseudo} – Collections</h4>`;
  try {
    let v1Html = '';
    for (let card of allCards) {
      const quantity = friend.collection?.[card.id]?.quantity || 0;
      if (quantity > 0) {
        v1Html += `
          <div style="display:inline-block;margin:3px 7px 7px 0;padding:6px 10px 2px 10px;border-radius:8px;background:#f7f7fa;text-align:center;">
            <img src="${card.image}" alt="${card.name}" style="height:48px;vertical-align:middle;border-radius:6px;box-shadow:0 2px 10px #0001;"><br>
            ${card.name} <span style="color:#5376a1">x${quantity}</span>
          </div>`;
      }
    }
    html += `<div style="margin-bottom:10px;"><strong>Collection :</strong>${v1Html ? "<br>"+v1Html : " <span style='color:#aaa'>Aucune carte</span>"}</div>`;
  } catch {}
  if (html.endsWith('</h4>')) html += `<div style="color:#aaa;margin-top:6px;">Aucune carte possédée</div>`;
  const section = document.getElementById('friends-section');
  section.innerHTML = html + '<div style="margin-top:18px"><button class="profile-btn" onclick="document.getElementById(\'friends-section\').style.display=\'none\'">Fermer</button></div>';
};

// ----------- ECHANGE (DEMANDE/NOTIF) -----------

window.startTradeWithFriend = async function(friendUid) {
  await addDoc(
    collection(db, "tradeRequests"),
    {
      from: globalUserData.uid,
      to: friendUid,
      status: "pending",
      createdAt: serverTimestamp(),
      offerA: { cards: {}, coins: 0 },
      offerB: { cards: {}, coins: 0 },
      readyA: false,
      readyB: false
    }
  );
  showToast('success', "Demande d'échange envoyée !");
};

function listenForTradeRequests() {
  const q = query(
    collection(db, "tradeRequests"),
    where("to", "==", globalUserData.uid),
    where("status", "==", "pending")
  );
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data();
        console.log("Nouvelle demande d'échange reçue !", change.doc.id, data);
        if (data.createdAt && data.createdAt.toDate) {
          const created = data.createdAt.toDate().getTime();
          if (Date.now() - created > 2 * 60 * 1000) return;
        }
        window.showIncomingTradeNotif(change.doc.id, data);
      }
    });
  });
}
function listenForTradeResponses() {
  const q = query(
    collection(db, "tradeRequests"),
    where("from", "==", globalUserData.uid),
    where("status", "in", ["accepted", "refused", "expired", "canceled"])
  );
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(change => {
      const data = change.doc.data();
      const tradeId = change.doc.id;
      window.__lastTradeStatus = window.__lastTradeStatus || {};
      if (data.createdAt && data.createdAt.toDate) {
        const created = data.createdAt.toDate().getTime();
        if (Date.now() - created > 2 * 60 * 1000) return;
      }
      if (window.__lastTradeStatus[tradeId] === "accepted" || window.__lastTradeStatus[tradeId] === "refused") return;
      if (data.status === "accepted") {
        window.__lastTradeStatus[tradeId] = "accepted";
        showToast('success', "Demande acceptée ! Lancement de l’échange...");
        openTradeUI(data, tradeId);
      } else if (data.status === "refused") {
        window.__lastTradeStatus[tradeId] = "refused";
        showToast('error', "Ton ami a refusé l’échange.");
      } else if (data.status === "expired") {
        if (!window.__lastTradeStatus[tradeId]) {
          window.__lastTradeStatus[tradeId] = "expired";
          showToast('info', "La demande d’échange a expiré.");
        }
      } else if (data.status === "canceled") {
        showToast('info', "L'échange a été annulé.");
      }
    });
  });
}

window.showIncomingTradeNotif = function(tradeReqId, data) {
  console.log('Appel de showIncomingTradeNotif', tradeReqId, data);
  if (document.getElementById('trade-notif-'+tradeReqId)) return;
  const notif = document.createElement('div');
  notif.id = 'trade-notif-'+tradeReqId;
  notif.style = `
    position:fixed;top:20px;left:50%;transform:translateX(-50%);
    background:#fff;border-radius:15px;box-shadow:0 6px 32px #0002;padding:24px 32px;z-index:3000;
    display:flex;flex-direction:column;align-items:center;gap:16px;min-width:260px;
    font-size:1.2em;
  `;
  notif.innerHTML = `
    <div style="margin-bottom:8px;">
      <strong class="trade-from-pseudo">${data.from}</strong> souhaite échanger avec toi !
    </div>
    <div>
      <button class="profile-btn" style="margin-right:14px;background:#00b894" onclick="window.acceptTradeNotif('${tradeReqId}')">Accepter</button>
      <button class="profile-btn" style="background:#e67e22" onclick="window.refuseTradeNotif('${tradeReqId}')">Refuser</button>
    </div>
    <div id="trade-timer-${tradeReqId}" style="font-size:0.9em;color:#888;margin-top:4px;"></div>
  `;
  document.body.appendChild(notif);
  (async () => {
    try {
      const userSnap = await getDoc(doc(db, "users", data.from));
      if (userSnap.exists()) {
        notif.querySelector('.trade-from-pseudo').textContent = userSnap.data().pseudo;
      }
    } catch {}
  })();
  let timer = 60;
  const timerEl = document.getElementById('trade-timer-'+tradeReqId);
  timerEl.textContent = `Temps restant : 60s`;
  const interval = setInterval(async () => {
    timer -= 1;
    if (timerEl) timerEl.textContent = `Temps restant : ${timer}s`;
    if (timer <= 0) {
      clearInterval(interval);
      notif.remove();
      await updateDoc(doc(db, "tradeRequests", tradeReqId), { status: "expired" });
    }
  }, 1000);
};

window.acceptTradeNotif = async function(tradeReqId) {
  try {
    await updateDoc(doc(db, "tradeRequests", tradeReqId), { status: "accepted" });
    document.getElementById('trade-notif-'+tradeReqId).remove();
    showToast('success', "Tu as accepté la demande d'échange !");
    const tradeSnap = await getDoc(doc(db, "tradeRequests", tradeReqId));
    if (tradeSnap.exists()) {
      openTradeUI(tradeSnap.data(), tradeReqId);
    }
  } catch (err) {
    showToast('error', "Erreur Firestore : " + err.message);
  }
};
window.refuseTradeNotif = async function(tradeReqId) {
  await updateDoc(doc(db, "tradeRequests", tradeReqId), { status: "refused" });
  document.getElementById('trade-notif-'+tradeReqId).remove();
  showToast('info', "Tu as refusé la demande d'échange.");
};

// ----------- MODALE D'ECHANGE (COMPLÈTE) -----------

window.openTradeUI = function(tradeData, tradeId) {
  currentTradeId = tradeId;
  currentTradeData = tradeData;
  localOffer = {}; localCoins = 0; ready = false;

  document.getElementById('trade-modal').style.display = 'flex';
  document.getElementById('trade-your-pseudo').textContent = globalUserData.pseudo;
  let otherUid = (tradeData.from === globalUserData.uid) ? tradeData.to : tradeData.from;
  getDoc(doc(db, "users", otherUid)).then(snap => {
    document.getElementById('trade-other-pseudo').textContent = snap.data()?.pseudo || "???";
  });

  document.getElementById('trade-accept-btn').onclick = handleReadyToggle;
  document.getElementById('trade-cancel-btn').onclick = handleCancelTrade;
  document.getElementById('close-trade-modal').onclick = handleCancelTrade;

  renderYourDuplicates();

  if (tradeUnsubscribe) tradeUnsubscribe();
  tradeUnsubscribe = onSnapshot(doc(db, "tradeRequests", tradeId), (docSnap) => {
    if (!docSnap.exists()) return;
    updateTradeModalUI(docSnap.data());
  });
};

function renderYourDuplicates() {
  const container = document.getElementById('trade-your-cards');
  container.innerHTML = '';
  for (const cardId in globalUserData.collection) {
    const qty = globalUserData.collection[cardId].quantity;
    if (qty >= 2) {
      const div = document.createElement('div');
      div.innerHTML = `
        <img src="${getCardImg(cardId)}" style="height:40px;margin:2px;">
        x${qty} 
        <button data-card="${cardId}" class="minus-btn">-</button>
        <span class="trade-offer-qty">${localOffer[cardId] || 0}</span>
        <button data-card="${cardId}" class="plus-btn">+</button>
      `;
      container.appendChild(div);
    }
  }
  container.querySelectorAll('.plus-btn').forEach(btn =>
    btn.onclick = () => updateCardOffer(btn.dataset.card, 1)
  );
  container.querySelectorAll('.minus-btn').forEach(btn =>
    btn.onclick = () => updateCardOffer(btn.dataset.card, -1)
  );
  const coinsInput = document.getElementById('trade-your-coins');
  coinsInput.value = localCoins;
  coinsInput.max = globalUserData.coins;
  coinsInput.oninput = () => {
    let val = parseInt(coinsInput.value) || 0;
    if (val < 0) val = 0;
    if (val > globalUserData.coins) val = globalUserData.coins;
    localCoins = val;
    updateTradeFirestore();
  };
}

function updateCardOffer(cardId, delta) {
  const maxQty = globalUserData.collection[cardId].quantity - 1;
  localOffer[cardId] = (localOffer[cardId] || 0) + delta;
  if (localOffer[cardId] < 0) localOffer[cardId] = 0;
  if (localOffer[cardId] > maxQty) localOffer[cardId] = maxQty;
  renderYourDuplicates();
  updateTradeFirestore();
}
function updateTradeFirestore() {
  if (!currentTradeId) return;
  const isA = (currentTradeData.from === globalUserData.uid);
  const offerField = isA ? "offerA" : "offerB";
  const readyField = isA ? "readyA" : "readyB";
  updateDoc(doc(db, "tradeRequests", currentTradeId), {
    [offerField]: { cards: {...localOffer}, coins: localCoins },
    [readyField]: false
  });
  ready = false;
  document.getElementById('trade-status-msg').textContent = '';
}

function handleReadyToggle() {
  if (!currentTradeId) return;
  for (const cardId in localOffer) {
    const qty = globalUserData.collection[cardId].quantity;
    if (localOffer[cardId] > qty - 1) {
      showToast("error", "Tu ne peux pas offrir plus que tes doublons !");
      return;
    }
  }
  if (localCoins > globalUserData.coins) {
    showToast("error", "Pas assez de pièces !");
    return;
  }
  const isA = (currentTradeData.from === globalUserData.uid);
  const readyField = isA ? "readyA" : "readyB";
  updateDoc(doc(db, "tradeRequests", currentTradeId), { [readyField]: true });
  ready = true;
  document.getElementById('trade-status-msg').textContent = "En attente de l’autre joueur…";
}

function renderOffer(cardsObj) {
  if (!cardsObj || Object.keys(cardsObj).length === 0) return "(Aucune carte)";
  return Object.entries(cardsObj).map(([id, qty]) =>
    `<span style="display:inline-block;margin:2px;">
      <img src="${getCardImg(id)}" style="height:32px;vertical-align:middle;">
      x${qty}
    </span>`
  ).join('');
}
async function updateTradeModalUI(tradeData) {
  currentTradeData = tradeData;
  const isA = (tradeData.from === globalUserData.uid);
  const myOffer = isA ? tradeData.offerA : tradeData.offerB;
  const otherOffer = isA ? tradeData.offerB : tradeData.offerA;

  // Affiche l'offre adverse dans la colonne droite
  renderOtherOffer(otherOffer.cards);

  document.getElementById('trade-other-coins').textContent = otherOffer.coins || 0;

   if (tradeData.status === "completed") {
      showToast('success', "Échange réalisé !");
      await updateQuestProgress('friend_trade');
      closeTradeModal();
      return;
  }
  if (["canceled", "refused", "expired"].includes(tradeData.status)) {
    showToast('info', "Échange annulé/refusé.");
    closeTradeModal();
    return;
  }
  if (tradeData.readyA && tradeData.readyB) {
    document.getElementById('trade-status-msg').innerHTML = `<button id="trade-final-confirm-btn" class="profile-btn" style="background:#2196f3;">Valider l'échange</button>`;
    document.getElementById('trade-final-confirm-btn').onclick = handleFinalValidation;
  } else {
    document.getElementById('trade-status-msg').textContent = '';
  }
}


async function handleFinalValidation() {
  const docRef = doc(db, "tradeRequests", currentTradeId);
  await runTransaction(db, async (transaction) => {
    const tradeSnap = await transaction.get(docRef);
    if (!tradeSnap.exists()) throw "Échange introuvable.";
    const trade = tradeSnap.data();
    const userARef = doc(db, "users", trade.from);
    const userBRef = doc(db, "users", trade.to);
    const [userASnap, userBSnap] = await Promise.all([transaction.get(userARef), transaction.get(userBRef)]);
    const dataA = userASnap.data(), dataB = userBSnap.data();
    for (const [id, qty] of Object.entries(trade.offerA.cards || {})) {
      if ((dataA.collection?.[id]?.quantity || 0) < qty) throw "A n’a plus les cartes nécessaires !";
    }
    for (const [id, qty] of Object.entries(trade.offerB.cards || {})) {
      if ((dataB.collection?.[id]?.quantity || 0) < qty) throw "B n’a plus les cartes nécessaires !";
    }
    if ((dataA.coins || 0) < (trade.offerA.coins || 0)) throw "A n’a plus assez de pièces.";
    if ((dataB.coins || 0) < (trade.offerB.coins || 0)) throw "B n’a plus assez de pièces.";
    let updatesA = {}, updatesB = {};
    for (const [id, qty] of Object.entries(trade.offerA.cards || {})) {
      updatesA[`collection.${id}.quantity`] = increment(-qty);
    }
    for (const [id, qty] of Object.entries(trade.offerB.cards || {})) {
      updatesA[`collection.${id}.quantity`] = increment(qty);
    }
    updatesA['coins'] = increment((trade.offerB.coins || 0) - (trade.offerA.coins || 0));
    for (const [id, qty] of Object.entries(trade.offerB.cards || {})) {
      updatesB[`collection.${id}.quantity`] = increment(-qty);
    }
    for (const [id, qty] of Object.entries(trade.offerA.cards || {})) {
      updatesB[`collection.${id}.quantity`] = increment(qty);
    }
    updatesB['coins'] = increment((trade.offerA.coins || 0) - (trade.offerB.coins || 0));
    transaction.update(userARef, updatesA);
    transaction.update(userBRef, updatesB);
    transaction.update(docRef, { status: "completed" });
  }).then(() => {
    showToast('success', "Échange effectué !");
    closeTradeModal();
  }).catch(e => {
    showToast("error", "Erreur : " + (e?.message || e));
  });
}
function handleCancelTrade() {
  if (!currentTradeId) return;
  updateDoc(doc(db, "tradeRequests", currentTradeId), { status: "canceled" });
  closeTradeModal();
}
function closeTradeModal() {
  document.getElementById('trade-modal').style.display = 'none';
  if (tradeUnsubscribe) tradeUnsubscribe();
  tradeUnsubscribe = null;
  currentTradeId = null;
}

// ---------- INIT AUTO ----------
window.onload = () => {
  if (document.getElementById('profile-username')) {
    initializeProfilPage();
  }
};
function renderOtherOffer(cardsObj) {
  const container = document.getElementById('trade-other-cards');
  container.innerHTML = '';
  if (!cardsObj || Object.keys(cardsObj).length === 0) {
    container.innerHTML = "<span style='color:#aaa;'>Aucune carte proposée</span>";
    return;
  }
  for (const [cardId, qty] of Object.entries(cardsObj)) {
    if (qty > 0) {
      const card = allCards.find(c => c.id === cardId);
      const div = document.createElement('div');
      div.style.opacity = 0.8;
      div.innerHTML = `
        <img src="${card?.image || ''}" alt="${card?.name || cardId}" />
        x${qty}
        <span style="font-size:.99em;color:#777">${card?.name || cardId}</span>
      `;
      container.appendChild(div);
    }
  }
}
await updateQuestProgress('friend_trade');