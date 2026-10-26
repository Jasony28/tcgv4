import {
  collection, doc, getDoc, updateDoc, query, where, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { protectPage } from './auth-manager.js';
import { allCards as allCardsV1 } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { db } from './firebase-config.js';
import { showToast, showConfirmDialog } from './toast.js';
import { updateQuestProgress } from './quest-manager.js';
import { getAchievementsStatus, rewardText, countClaimedAchievements } from './achievements-config.js';
import { claimAchievement } from './achievements.js';
import {
  sendFriendRequest, acceptFriendRequest, refuseFriendRequest, removeFriend, friendCode, getFriendSuggestions,
  createTradeRequest, validateTrade, normalizeOffer, checkOfferAffordable
} from './trade-service.js';
import { getLevel } from './battlepass-config.js';
import { cardLabel } from './market-service.js';
import { allCardsV3, allCardsV3Released, V3_RELEASED } from './cards-v3.js';
import { getWeekKey } from './daily-utils.js';
import { playerLevel, xpCounters, XP_RULES } from './player-level.js';

// ----------- VARIABLES GLOBALES -----------

let globalUserData = null;
let currentTradeId = null;
let currentTradeData = null;
let tradeUnsubscribe = null;
let localOffer = {};   // { cardId: qty }
let localCoins = 0;
let ready = false;
const tradeNotifIntervals = {}; // tradeReqId -> interval du compte à rebours

// Les deux collections (V1 + V2) pour retrouver nom/image de n'importe quelle carte
const allCards = [...allCardsV1, ...allCardsV2, ...allCardsV3Released];

// ----------- UTILS -----------

// Les pseudos sont choisis par les joueurs : on les échappe avant de les insérer en HTML
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
  renderPlayerLevel(userData);
  const stats = userData.stats || {};
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('stats-boosters-opened', stats.boostersOpened || 0);
  setText('stats-cards-sold-console', stats.cardsSoldConsole || 0);
  setText('stats-cards-sold-market', stats.cardsSoldMarket || 0);
  setText('stats-failed-sales', stats.failedSales || 0);
  // name : boosters vendus au marché (pas de cardId)
  setText('stats-best-sale',
    (stats.bestSale && typeof stats.bestSale.price === "number" && stats.bestSale.price > 0)
      ? `${stats.bestSale.name || getCardNameById(stats.bestSale.cardId)} (${stats.bestSale.price} pièces)` : "Aucune"
  );
  setText('stats-best-purchase',
    (stats.bestPurchase && typeof stats.bestPurchase.price === "number" && stats.bestPurchase.price > 0)
      ? `${stats.bestPurchase.name || getCardNameById(stats.bestPurchase.cardId)} (${stats.bestPurchase.price} pièces)` : "Aucun"
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

  renderAchievements(userData);

  // Amis & échanges
  setupFriendsFeature(userData);
  listenForTradeRequests();
  listenForTradeResponses();
}

// ----------- SUCCÈS -----------

function renderAchievements(userData) {
  const list = document.getElementById('achievements-list');
  if (!list) return;
  const status = getAchievementsStatus(userData);

  // Prêts à réclamer d'abord, puis obtenus, puis en cours (les plus avancés en premier)
  const rank = a => (a.unlocked && !a.claimed) ? 0 : (a.claimed ? 1 : 2);
  status.sort((a, b) => rank(a) - rank(b) || (b.owned / b.total) - (a.owned / a.total));

  document.getElementById('achievements-count').textContent = `${status.filter(a => a.claimed).length} / ${status.length}`;
  document.getElementById('profile-badges').innerHTML = status.filter(a => a.claimed)
    .map(a => `<span class="badge-medal tier-${a.tier}" title="${a.title}">${a.icon}</span>`).join('');

  list.innerHTML = '';
  for (const a of status) {
    const state = a.claimed ? 'claimed' : (a.unlocked ? 'ready' : 'locked');
    const pct = Math.round((a.owned / a.total) * 100);
    const item = document.createElement('div');
    item.className = `achievement ${state}`;
    item.innerHTML = `
      <span class="badge-medal tier-${a.tier}">${a.icon}</span>
      <div class="achievement-info">
        <strong>${a.title}</strong>
        <span class="achievement-desc">${a.description}</span>
        ${a.claimed ? '' : `<div class="quest-bar"><div class="quest-bar-fill" style="width:${pct}%"></div></div>`}
        <span class="achievement-reward">🎁 ${rewardText(a.reward)}</span>
      </div>
      <div class="achievement-action">
        ${state === 'ready' ? '<button class="claim-button">Réclamer</button>'
          : state === 'claimed' ? '<span class="achievement-done">Obtenu ✓</span>'
          : `<span class="achievement-progress">${a.owned}/${a.total}</span>`}
      </div>
    `;
    if (state === 'ready') {
      const btn = item.querySelector('.claim-button');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const claimed = await claimAchievement(globalUserData.uid, a.id);
          showToast('success', `🏅 ${claimed.title} ! ${rewardText(claimed.reward)}`, 4500);
        } catch (e) {
          showToast('error', e.message || "Impossible de réclamer ce succès.");
        }
        const snap = await getDoc(doc(db, "users", globalUserData.uid));
        globalUserData = { ...globalUserData, ...snap.data() };
        document.getElementById('profile-coins').textContent = globalUserData.coins || 0;
    renderPlayerLevel(globalUserData);
        renderAchievements(globalUserData);
      });
    }
    list.appendChild(item);
  }
}

// ----------- AMIS & LISTES -----------

let openSection = null; // 'friends' | 'requests' | null

function setupFriendsFeature() {
  const input = document.getElementById('friend-pseudo-input');
  const addFriendBtn = document.getElementById('add-friend-btn');
  const submit = async () => {
    addFriendBtn.disabled = true;
    try {
      const res = await sendFriendRequest(globalUserData, input.value);
      input.value = '';
      renderFriendSuggestions();
      showToast('success', res.status === 'accepted'
        ? `${res.pseudo} t'avait déjà demandé : vous êtes maintenant amis !`
        : `Demande envoyée à ${res.pseudo} !`);
    } catch (e) {
      console.error("Ajout d'ami :", e);
      showToast('error', e.code === 'permission-denied'
        ? "Firebase a refusé la demande d'ami (règles de sécurité de la base). Préviens l'admin."
        : e.code === 'unavailable'
          ? "Pas de connexion à la base : vérifie ton internet et réessaie."
          : e.message, 6000);
    } finally {
      addFriendBtn.disabled = false;
    }
  };
  addFriendBtn.onclick = submit;

  // Mon code ami (à donner aux autres joueurs)
  const myCode = friendCode(globalUserData.pseudo || '?', globalUserData.uid);
  document.getElementById('my-friend-code').textContent = myCode;
  document.getElementById('copy-friend-code').onclick = async () => {
    try { await navigator.clipboard.writeText(myCode); showToast('success', 'Code ami copié !'); }
    catch { showToast('info', `Ton code ami : ${myCode}`); }
  };
  renderFriendSuggestions();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  document.getElementById('friends-list-btn').onclick = () => toggleSection('friends');
  document.getElementById('friend-requests-btn').onclick = () => toggleSection('requests');

  // Mes données en direct : compteurs et listes toujours à jour (nouvelle demande, ami ajouté…)
  onSnapshot(doc(db, "users", globalUserData.uid), (snap) => {
    if (!snap.exists()) return;
    globalUserData = { ...globalUserData, ...snap.data() };
    updateFriendCounters();
    document.getElementById('profile-coins').textContent = globalUserData.coins || 0;
    renderPlayerLevel(globalUserData);
    if (openSection === 'friends') refreshFriendsList();
    if (openSection === 'requests') refreshFriendRequestsList();
  });
}

/** Niveau global : barre de progression + comment gagner de l'XP */
function renderPlayerLevel(data) {
  const box = document.getElementById('profile-level');
  if (!box) return;
  const lv = playerLevel(data), counters = xpCounters(data);
  box.innerHTML = `
    <div class="progress-head"><span><strong>Niveau ${lv.level}</strong> · ${lv.xp} XP</span><span>${lv.current} / ${lv.needed}</span></div>
    <div class="xp-bar"><div class="xp-bar-fill" style="width:${lv.pct}%"></div></div>
    <details class="xp-help"><summary>Comment gagner de l'XP ?</summary>
      <ul>${XP_RULES.map(r => `<li>${r.label} : <strong>+${r.xp} XP</strong> <span>(${counters[r.key]})</span></li>`).join('')}</ul>
    </details>`;
}

/** Suggestions d'amis (lues une fois à l'ouverture du profil, puis après chaque ajout) */
async function renderFriendSuggestions() {
  const box = document.getElementById('friend-suggestions');
  let list = [];
  try { list = await getFriendSuggestions(globalUserData, 4); } catch { /* hors ligne : pas de suggestions */ }
  box.innerHTML = list.length ? `<p class="suggest-title">Suggestions</p>` + list.map(s => `
    <div class="suggest-row">
      <span><strong>${escapeHtml(s.pseudo)}</strong>${s.mutual ? ` <small>${s.mutual} ami${s.mutual > 1 ? 's' : ''} en commun</small>` : ''}</span>
      <button class="profile-btn primary small" data-code="${escapeHtml(s.code)}">Ajouter</button>
    </div>`).join('') : '';
  box.querySelectorAll('[data-code]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const res = await sendFriendRequest(globalUserData, btn.dataset.code);
        showToast('success', res.status === 'accepted' ? `Vous êtes maintenant amis avec ${res.pseudo} !` : `Demande envoyée à ${res.pseudo} !`);
        renderFriendSuggestions();
      } catch (e) {
        showToast('error', e.code === 'permission-denied' ? "Firebase a refusé la demande d'ami (règles de sécurité de la base). Préviens l'admin." : e.message, 6000);
        btn.disabled = false;
      }
    };
  });
}

function updateFriendCounters() {
  const nbFriends = (globalUserData.friends || []).length;
  const nbRequests = (globalUserData.friendRequests || []).length;
  document.getElementById('friends-list-btn').innerHTML = `Mes amis <span class="count-pill">${nbFriends}</span>`;
  document.getElementById('friend-requests-btn').innerHTML = `Demandes ${nbRequests ? `<span class="count-pill alert">${nbRequests}</span>` : ''}`;
}

function toggleSection(name) {
  const friends = document.getElementById('friends-section');
  const requests = document.getElementById('friend-requests-section');
  openSection = openSection === name ? null : name;
  friends.style.display = openSection === 'friends' ? 'block' : 'none';
  requests.style.display = openSection === 'requests' ? 'block' : 'none';
  document.getElementById('friends-list-btn').classList.toggle('active', openSection === 'friends');
  document.getElementById('friend-requests-btn').classList.toggle('active', openSection === 'requests');
  if (openSection === 'friends') refreshFriendsList();
  if (openSection === 'requests') refreshFriendRequestsList();
}

const isOnline = (u) => u.lastOnline && (Date.now() - u.lastOnline.toDate().getTime() < 5 * 60 * 1000);
function lastSeenText(u) {
  if (isOnline(u)) return 'En ligne';
  if (!u.lastOnline) return 'Jamais vu';
  const mins = Math.floor((Date.now() - u.lastOnline.toDate().getTime()) / 60000);
  if (mins < 60) return `Vu il y a ${mins} min`;
  if (mins < 1440) return `Vu il y a ${Math.floor(mins / 60)} h`;
  return `Vu il y a ${Math.floor(mins / 1440)} j`;
}

let friendsRenderToken = 0;
window.refreshFriendsList = async function() {
  const token = ++friendsRenderToken; // évite les doublons si deux rafraîchissements se croisent
  const section = document.getElementById('friends-section');
  const friends = globalUserData.friends || [];
  if (friends.length === 0) {
    section.innerHTML = "<p class='empty-msg'>Tu n’as pas encore d’amis. Ajoute-les avec leur pseudo !</p>";
    return;
  }
  const snaps = await Promise.all(friends.map(uid => getDoc(doc(db, "users", uid)).catch(() => null)));
  if (token !== friendsRenderToken) return;
  const list = snaps.filter(s => s?.exists()).map(s => ({ uid: s.id, ...s.data() }))
    .sort((a, b) => (isOnline(b) ? 1 : 0) - (isOnline(a) ? 1 : 0) || (a.pseudo || '').localeCompare(b.pseudo || ''));
  section.innerHTML = '';
  for (const friend of list) {
    const friendDiv = document.createElement('div');
    friendDiv.className = 'friend-block';
    friendDiv.innerHTML = `
      <div class="friend-head">
        <strong>${escapeHtml(friend.pseudo)}</strong>
        <span class="friend-badges" title="Succès obtenus">🏅 ${countClaimedAchievements(friend)}</span>
        <span class="friend-status ${isOnline(friend) ? 'online' : ''}">${lastSeenText(friend)}</span>
      </div>
      <div class="friend-actions three">
        <button class="profile-btn blue" data-action="profile">Profil</button>
        <button class="profile-btn success" data-action="trade">Échanger</button>
        <button class="profile-btn ghost small" data-action="remove" title="Retirer de mes amis">✕</button>
      </div>
    `;
    friendDiv.querySelector('[data-action="profile"]').onclick = () => showFriendProfile(friend.uid);
    friendDiv.querySelector('[data-action="trade"]').onclick = () => startTradeWithFriend(friend.uid, friend.pseudo);
    friendDiv.querySelector('[data-action="remove"]').onclick = async () => {
      const ok = await showConfirmDialog({ title: 'Retirer cet ami ?', message: `${friend.pseudo} ne sera plus dans ta liste d'amis.`, confirmText: 'Retirer', cancelText: 'Annuler' });
      if (!ok) return;
      try { await removeFriend(globalUserData.uid, friend.uid); showToast('info', `${friend.pseudo} a été retiré de tes amis.`); }
      catch (e) { showToast('error', e.message); }
    };
    section.appendChild(friendDiv);
  }
};

window.refreshFriendRequestsList = async function() {
  const section = document.getElementById('friend-requests-section');
  const requests = globalUserData.friendRequests || [];
  if (requests.length === 0) {
    section.innerHTML = "<p class='empty-msg'>Aucune demande en attente.</p>";
    return;
  }
  const snaps = await Promise.all(requests.map(uid => getDoc(doc(db, "users", uid)).catch(() => null)));
  section.innerHTML = '';
  requests.forEach((requestUid, i) => {
    const reqUser = snaps[i]?.exists() ? snaps[i].data() : { pseudo: "(joueur supprimé)" };
    const block = document.createElement('div');
    block.className = 'friend-request-block';
    block.innerHTML = `
      <strong>${escapeHtml(reqUser.pseudo)}</strong>
      <button class="profile-btn success" data-action="accept">Accepter</button>
      <button class="profile-btn warn" data-action="refuse">Refuser</button>
    `;
    block.querySelector('[data-action="accept"]').onclick = async () => {
      try { await acceptFriendRequest(globalUserData.uid, requestUid); showToast('success', `${reqUser.pseudo} est maintenant ton ami !`); }
      catch (e) { showToast('error', e.message); }
    };
    block.querySelector('[data-action="refuse"]').onclick = async () => {
      try { await refuseFriendRequest(globalUserData.uid, requestUid); showToast('info', "Demande refusée."); }
      catch (e) { showToast('error', e.message); }
    };
    section.appendChild(block);
  });
};

// ----------- PROFIL D'UN AMI (stats, collection, succès) -----------

function bestText(entry) {
  if (!entry || typeof entry.price !== 'number' || entry.price <= 0) return 'Aucune';
  return `${escapeHtml(entry.name || getCardNameById(entry.cardId))} (${entry.price} pièces)`;
}

async function showFriendProfile(friendUid) {
  const snap = await getDoc(doc(db, "users", friendUid));
  if (!snap.exists()) return showToast('error', "Joueur introuvable !");
  const friend = snap.data();
  const stats = friend.stats || {};
  const owned = (cards) => cards.filter(c => friend.collection?.[c.id]?.quantity > 0).length;
  const v1 = owned(allCardsV1), v2 = owned(allCardsV2), v3 = owned(allCardsV3);
  const bp = friend.battlePass?.seasonId === getWeekKey() ? friend.battlePass : null;
  const level = bp ? getLevel(bp.xp) : 0;
  const badges = getAchievementsStatus(friend).filter(a => a.claimed);
  const ownedCards = allCards.filter(c => friend.collection?.[c.id]?.quantity > 0);
  const legendaries = ownedCards.filter(c => c.rarity === 'Légendaire').length;

  const bar = (n, total) => `<div class="xp-bar"><div class="xp-bar-fill" style="width:${Math.round(n / total * 100)}%"></div></div>`;
  document.getElementById('friend-modal-body').innerHTML = `
    <div class="friend-profile-head">
      <div class="profile-avatar small" aria-hidden="true">${escapeHtml((friend.pseudo || '?')[0].toUpperCase())}</div>
      <div>
        <h3>${escapeHtml(friend.pseudo)}</h3>
        <span class="friend-status ${isOnline(friend) ? 'online' : ''}">${lastSeenText(friend)}</span>
      </div>
    </div>
    ${badges.length ? `<div class="profile-badges">${badges.map(a => `<span class="badge-medal tier-${a.tier}" title="${escapeHtml(a.title)}">${a.icon}</span>`).join('')}</div>` : ''}

    <div class="stats-grid compact">
      <div class="stat-item"><span class="stat-value">${playerLevel(friend).level}</span><span class="stat-label">Niveau global</span></div>
      <div class="stat-item"><span class="stat-value">${level}</span><span class="stat-label">Niveau du Pass</span></div>
      <div class="stat-item"><span class="stat-value">${legendaries}</span><span class="stat-label">Légendaires</span></div>
      <div class="stat-item"><span class="stat-value">${stats.boostersOpened || 0}</span><span class="stat-label">Boosters ouverts</span></div>
      <div class="stat-item"><span class="stat-value">${badges.length}</span><span class="stat-label">Succès</span></div>
      <div class="stat-item"><span class="stat-value">${stats.cardsSoldMarket || 0}</span><span class="stat-label">Ventes au marché</span></div>
      <div class="stat-item"><span class="stat-value">${stats.cardsSoldConsole || 0}</span><span class="stat-label">Ventes console</span></div>
      <div class="stat-item full-width"><span class="stat-label">Vente la plus chère</span><span class="stat-value">${bestText(stats.bestSale)}</span></div>
      <div class="stat-item full-width"><span class="stat-label">Achat le plus cher</span><span class="stat-value">${bestText(stats.bestPurchase)}</span></div>
    </div>

    <div class="album-progress">
      <div class="progress-head"><span>Album V1</span><span><strong>${v1}</strong> / ${allCardsV1.length}</span></div>${bar(v1, allCardsV1.length)}
      <div class="progress-head"><span>Album V2</span><span><strong>${v2}</strong> / ${allCardsV2.length}</span></div>${bar(v2, allCardsV2.length)}
      ${V3_RELEASED ? `<div class="progress-head"><span>Album V3</span><span><strong>${v3}</strong> / ${allCardsV3.length}</span></div>${bar(v3, allCardsV3.length)}` : ""}
    </div>

    <h4 class="friend-collection-title">Ses collections</h4>
    <div class="friend-sets">${FRIEND_SETS().map(([label, cards], i) => `
      <button class="friend-set-tab" data-set="${i}">Collection ${label} <span>${owned(cards)} / ${cards.length}</span></button>`).join('')}
    </div>
    <div id="friend-set-view"></div>

    <button class="profile-btn success" id="friend-modal-trade">🔄 Proposer un échange</button>
  `;
  document.getElementById('friend-modal-trade').onclick = () => { closeFriendModal(); startTradeWithFriend(friendUid, friend.pseudo); };
  setupFriendSets(friend);
  document.getElementById('friend-modal').style.display = 'flex';
}
// Collections affichées dans le profil d'un ami (une de plus à chaque nouvelle série)
const FRIEND_SETS = () => [['V1', allCardsV1], ['V2', allCardsV2], ...(V3_RELEASED ? [['V3', allCardsV3]] : [])];

/** Onglets fermés : un clic ouvre la collection (toutes / possédées / manquantes), un 2e clic la ferme */
function setupFriendSets(friend) {
  const view = document.getElementById('friend-set-view');
  const tabs = document.querySelectorAll('.friend-set-tab');
  let openSet = null, filter = 'all';
  const render = () => {
    tabs.forEach(t => t.classList.toggle('active', Number(t.dataset.set) === openSet));
    if (openSet === null) { view.innerHTML = ''; return; }
    const cards = FRIEND_SETS()[openSet][1];
    const qty = (c) => friend.collection?.[c.id]?.quantity || 0;
    const shown = cards.filter(c => filter === 'all' || (filter === 'owned' ? qty(c) > 0 : qty(c) === 0));
    const missing = cards.filter(c => qty(c) === 0).length;
    view.innerHTML = `
      <div class="friend-set-filters">
        ${[['all', 'Toutes'], ['owned', 'Possédées'], ['missing', `Manquantes (${missing})`]].map(([k, l]) =>
          `<button class="chip ${filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
      </div>
      ${shown.length ? `<div class="friend-card-list">${shown.map(c => `
        <div class="friend-card-item ${qty(c) ? '' : 'missing'}">
          <img src="${c.image}" alt="${escapeHtml(c.name)}" loading="lazy">
          ${escapeHtml(c.name)} <span>${qty(c) ? 'x' + qty(c) : 'Manquante'}</span>
        </div>`).join('')}</div>` : `<p class="empty-msg">${filter === 'missing' ? 'Collection complète ! 🎉' : 'Aucune carte'}</p>`}`;
    view.querySelectorAll('[data-filter]').forEach(b => { b.onclick = () => { filter = b.dataset.filter; render(); }; });
  };
  tabs.forEach(t => { t.onclick = () => { const i = Number(t.dataset.set); openSet = openSet === i ? null : i; filter = 'all'; render(); }; });
}

function closeFriendModal() { document.getElementById('friend-modal').style.display = 'none'; }

// ----------- ECHANGE (DEMANDE/NOTIF) -----------

async function startTradeWithFriend(friendUid, pseudo) {
  try {
    await createTradeRequest(globalUserData.uid, friendUid);
    showToast('success', `Demande d'échange envoyée à ${pseudo || 'ton ami'} ! L'échange s'ouvrira quand il acceptera.`, 4500);
  } catch (e) {
    showToast('error', e.message);
  }
}

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
        if (data.createdAt && data.createdAt.toDate) {
          const created = data.createdAt.toDate().getTime();
          if (Date.now() - created > 2 * 60 * 1000) return;
        }
        showIncomingTradeNotif(change.doc.id, data);
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
  const seen = {};
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(change => {
      const data = change.doc.data();
      const tradeId = change.doc.id;
      if (data.createdAt && data.createdAt.toDate) {
        const created = data.createdAt.toDate().getTime();
        if (Date.now() - created > 10 * 60 * 1000) return;
      }
      if (seen[tradeId] === data.status) return;
      seen[tradeId] = data.status;
      if (data.status === "accepted" && currentTradeId !== tradeId) {
        showToast('success', "Demande acceptée ! Lancement de l’échange...");
        openTradeUI(data, tradeId);
      } else if (data.status === "refused") {
        showToast('error', "Ton ami a refusé l’échange.");
      } else if (data.status === "expired") {
        showToast('info', "La demande d’échange a expiré.");
      }
    });
  });
}

function showIncomingTradeNotif(tradeReqId, data) {
  if (document.getElementById('trade-notif-'+tradeReqId)) return;
  const notif = document.createElement('div');
  notif.id = 'trade-notif-'+tradeReqId;
  notif.className = 'trade-notif';
  notif.innerHTML = `
    <div>🔄 <strong class="trade-from-pseudo">…</strong> veut échanger avec toi !</div>
    <div class="friend-actions">
      <button class="profile-btn success" data-action="accept">Accepter</button>
      <button class="profile-btn warn" data-action="refuse">Refuser</button>
    </div>
    <div id="trade-timer-${tradeReqId}" class="trade-notif-timer"></div>
  `;
  notif.querySelector('[data-action="accept"]').onclick = () => acceptTradeNotif(tradeReqId);
  notif.querySelector('[data-action="refuse"]').onclick = () => refuseTradeNotif(tradeReqId);
  document.body.appendChild(notif);
  getDoc(doc(db, "users", data.from)).then(userSnap => {
    if (userSnap.exists()) notif.querySelector('.trade-from-pseudo').textContent = userSnap.data().pseudo;
  }).catch(() => {});
  let timer = 60;
  const timerEl = document.getElementById('trade-timer-'+tradeReqId);
  timerEl.textContent = `Temps restant : 60s`;
  const interval = setInterval(async () => {
    timer -= 1;
    if (timerEl) timerEl.textContent = `Temps restant : ${timer}s`;
    if (timer <= 0) {
      clearTradeNotif(tradeReqId);
      await updateDoc(doc(db, "tradeRequests", tradeReqId), { status: "expired" });
    }
  }, 1000);
  tradeNotifIntervals[tradeReqId] = interval;
}

// Retire la notif ET stoppe son compte à rebours (sinon l'échange accepté passait en "expired")
function clearTradeNotif(tradeReqId) {
  clearInterval(tradeNotifIntervals[tradeReqId]);
  delete tradeNotifIntervals[tradeReqId];
  document.getElementById('trade-notif-'+tradeReqId)?.remove();
}

async function acceptTradeNotif(tradeReqId) {
  try {
    clearTradeNotif(tradeReqId);
    await updateDoc(doc(db, "tradeRequests", tradeReqId), { status: "accepted" });
    const tradeSnap = await getDoc(doc(db, "tradeRequests", tradeReqId));
    if (tradeSnap.exists()) openTradeUI(tradeSnap.data(), tradeReqId);
  } catch (err) {
    showToast('error', "Erreur : " + err.message);
  }
}
async function refuseTradeNotif(tradeReqId) {
  clearTradeNotif(tradeReqId);
  await updateDoc(doc(db, "tradeRequests", tradeReqId), { status: "refused" });
  showToast('info', "Tu as refusé la demande d'échange.");
}

// ----------- MODALE D'ECHANGE -----------

const BOOSTER_LABELS = { classic: 'Booster Classique', v2: 'Booster V2', v3: 'Booster V3', legendary: 'Booster Légendaire', v3_legendary: 'Booster Légendaire V3' };
let localBoosters = { classic: 0, v2: 0, legendary: 0 };

async function openTradeUI(tradeData, tradeId) {
  currentTradeId = tradeId;
  currentTradeData = tradeData;
  localOffer = {}; localCoins = 0; localBoosters = { classic: 0, v2: 0, legendary: 0 }; ready = false;

  // Données fraîches : la collection a pu changer depuis l'ouverture de la page
  const meSnap = await getDoc(doc(db, "users", globalUserData.uid));
  globalUserData = { ...globalUserData, ...meSnap.data() };

  document.getElementById('trade-modal').style.display = 'flex';
  document.getElementById('trade-your-pseudo').textContent = globalUserData.pseudo;
  const otherUid = (tradeData.from === globalUserData.uid) ? tradeData.to : tradeData.from;
  getDoc(doc(db, "users", otherUid)).then(snap => {
    const pseudo = snap.data()?.pseudo || "???";
    document.getElementById('trade-other-pseudo').textContent = pseudo;
    document.getElementById('trade-title').textContent = `Échange avec ${pseudo}`;
  });

  document.getElementById('trade-accept-btn').onclick = handleReadyToggle;
  document.getElementById('trade-cancel-btn').onclick = handleCancelTrade;
  document.getElementById('close-trade-modal').onclick = handleCancelTrade;

  renderYourOffer();

  if (tradeUnsubscribe) tradeUnsubscribe();
  tradeUnsubscribe = onSnapshot(doc(db, "tradeRequests", tradeId), (docSnap) => {
    if (!docSnap.exists()) return;
    updateTradeModalUI(docSnap.data());
  });
}

function renderYourOffer() {
  const container = document.getElementById('trade-your-cards');
  container.innerHTML = '';
  const dupes = allCards.filter(c => (globalUserData.collection?.[c.id]?.quantity || 0) >= 2);
  if (dupes.length === 0) container.innerHTML = "<span class='empty-msg'>Aucun doublon à proposer</span>";
  for (const card of dupes) {
    const qty = globalUserData.collection[card.id].quantity;
    const row = document.createElement('div');
    row.innerHTML = `
      <img src="${card.image}" alt="">
      <span class="trade-card-name">${escapeHtml(cardLabel(card))}<small>x${qty}</small></span>
      <button class="minus-btn">-</button>
      <span class="trade-offer-qty">${localOffer[card.id] || 0}</span>
      <button class="plus-btn">+</button>
    `;
    row.querySelector('.plus-btn').onclick = () => updateCardOffer(card.id, 1);
    row.querySelector('.minus-btn').onclick = () => updateCardOffer(card.id, -1);
    container.appendChild(row);
  }
  // Boosters
  for (const [type, label] of Object.entries(BOOSTER_LABELS)) {
    const have = globalUserData.boosterInventory?.[type] || 0;
    if (!have) continue;
    const row = document.createElement('div');
    row.className = 'trade-booster-row';
    row.innerHTML = `
      <img src="assets/booster/booster.webp" class="booster-thumb ${type}" alt="">
      <span class="trade-card-name">${label}<small>x${have}</small></span>
      <button class="minus-btn">-</button>
      <span class="trade-offer-qty">${localBoosters[type]}</span>
      <button class="plus-btn">+</button>
    `;
    row.querySelector('.plus-btn').onclick = () => { localBoosters[type] = Math.min(have, localBoosters[type] + 1); renderYourOffer(); updateTradeFirestore(); };
    row.querySelector('.minus-btn').onclick = () => { localBoosters[type] = Math.max(0, localBoosters[type] - 1); renderYourOffer(); updateTradeFirestore(); };
    container.appendChild(row);
  }
  const coinsInput = document.getElementById('trade-your-coins');
  coinsInput.value = localCoins;
  coinsInput.max = globalUserData.coins || 0;
  coinsInput.oninput = () => {
    let val = parseInt(coinsInput.value) || 0;
    val = Math.min(Math.max(0, val), globalUserData.coins || 0);
    localCoins = val;
    updateTradeFirestore();
  };
}

function updateCardOffer(cardId, delta) {
  const maxQty = (globalUserData.collection?.[cardId]?.quantity || 0) - 1;
  localOffer[cardId] = Math.min(Math.max(0, (localOffer[cardId] || 0) + delta), maxQty);
  if (localOffer[cardId] === 0) delete localOffer[cardId];
  renderYourOffer();
  updateTradeFirestore();
}

function myOffer() {
  return normalizeOffer({ cards: localOffer, coins: localCoins, boosters: localBoosters });
}

function updateTradeFirestore() {
  if (!currentTradeId) return;
  const isA = (currentTradeData.from === globalUserData.uid);
  // L'offre change : les DEUX joueurs doivent revalider
  updateDoc(doc(db, "tradeRequests", currentTradeId), {
    [isA ? "offerA" : "offerB"]: myOffer(),
    readyA: false,
    readyB: false
  });
  ready = false;
}

function handleReadyToggle() {
  if (!currentTradeId) return;
  const err = checkOfferAffordable(globalUserData, myOffer());
  if (err) { showToast("error", err); return; }
  const isA = (currentTradeData.from === globalUserData.uid);
  updateDoc(doc(db, "tradeRequests", currentTradeId), { [isA ? "readyA" : "readyB"]: true });
  ready = true;
}

async function updateTradeModalUI(tradeData) {
  currentTradeData = tradeData;
  const isA = (tradeData.from === globalUserData.uid);
  const otherOffer = normalizeOffer(isA ? tradeData.offerB : tradeData.offerA);
  const meReady = isA ? tradeData.readyA : tradeData.readyB;
  const otherReady = isA ? tradeData.readyB : tradeData.readyA;

  renderOtherOffer(otherOffer);
  document.getElementById('trade-other-coins').textContent = otherOffer.coins;

  if (tradeData.status === "completed") { await onTradeCompleted(); return; }
  if (["canceled", "refused", "expired"].includes(tradeData.status)) {
    showToast('info', "Échange annulé.");
    closeTradeModal();
    return;
  }
  const status = document.getElementById('trade-status-msg');
  const acceptBtn = document.getElementById('trade-accept-btn');
  acceptBtn.textContent = meReady ? 'Prêt ✓' : 'Je suis prêt';
  acceptBtn.disabled = !!meReady;
  if (meReady && otherReady) {
    status.innerHTML = `<button id="trade-final-confirm-btn" class="profile-btn blue">✅ Valider l'échange</button>`;
    document.getElementById('trade-final-confirm-btn').onclick = handleFinalValidation;
  } else {
    status.textContent = otherReady ? "Ton ami est prêt ! Clique sur « Je suis prêt »."
      : (meReady ? "En attente de ton ami…" : "Choisis ce que tu proposes, puis clique sur « Je suis prêt ».");
  }
}

async function handleFinalValidation() {
  const btn = document.getElementById('trade-final-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    await validateTrade(currentTradeId);
    await onTradeCompleted();
  } catch (e) {
    // Si l'ami a validé en même temps, l'échange est déjà fait : l'écouteur fermera la fenêtre
    if (!/déjà effectué/.test(e.message)) showToast("error", e.message);
    if (btn) btn.disabled = false;
  }
}

// Appelé une seule fois par joueur (par le validateur, ou via l'écouteur pour l'autre joueur)
async function onTradeCompleted() {
  if (!currentTradeId) return;
  closeTradeModal();
  showToast('success', "🔄 Échange effectué !");
  await updateQuestProgress('friend_trade');
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

function renderOtherOffer(offer) {
  const container = document.getElementById('trade-other-cards');
  container.innerHTML = '';
  const rows = [
    ...Object.entries(offer.cards).map(([cardId, qty]) => {
      const card = allCards.find(c => c.id === cardId);
      return `<div><img src="${card?.image || ''}" alt=""><span class="trade-card-name">${escapeHtml(cardLabel(card) || cardId)}</span><strong>x${qty}</strong></div>`;
    }),
    ...Object.entries(offer.boosters).filter(([, n]) => n > 0).map(([type, n]) =>
      `<div><img src="assets/booster/booster.webp" class="booster-thumb ${type}" alt=""><span class="trade-card-name">${BOOSTER_LABELS[type]}</span><strong>x${n}</strong></div>`)
  ];
  container.innerHTML = rows.length ? rows.join('') : "<span class='empty-msg'>Rien pour l'instant…</span>";
}

// ---------- INIT AUTO ----------
window.onload = () => {
  if (document.getElementById('profile-username')) {
    document.getElementById('friend-modal-close').onclick = closeFriendModal;
    document.getElementById('friend-modal').addEventListener('click', (e) => { if (e.target.id === 'friend-modal') closeFriendModal(); });
    initializeProfilPage();
  }
};
