// Fichier: marche.js — interface de l'Hôtel des Ventes (la logique est dans market-service.js)
import { collection, query, where, doc, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { updateUserStats } from './stats-manager.js';
import { updateQuestProgress } from './quest-manager.js';
import {
    ALL_CARDS, BOOSTER_INFO, DISPLAY_INFO, DURATIONS_HOURS, MAX_WANTED_CARDS,
    findCard, cardLabel, getListingItem, getListingType, describeItem, minPriceFor, sellerProceeds, MARKET_TAX_RATE,
    createListing, placeBid, acceptTradeListing, cancelListing, finalizeExpiredListings, sellToConsole
} from './market-service.js';
import { seriesOfBooster, seriesOfCard, seriesStatus } from './series-config.js';
import { loadMarketHistory, summarize, receivedCards } from './history-service.js';

/** Badge « Série terminée » : l'objet n'est plus produit, il devient rare */
function seriesBadge(item) {
    const series = item.type === 'card' ? seriesOfCard(findCard(item.cardId))
        : seriesOfBooster(item.type === 'display' ? item.displayType : item.boosterType);
    return seriesStatus(series) === 'ended' ? '<span class="series-badge ended">💎 Série terminée</span>' : '';
}

// ---------- Utilitaires ----------

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const rarityClass = (rarity) => rarity ? `rarity-${rarity.replace(/é/g, 'e')}` : '';
const RARITY_LABELS = { 'Commune': 'Commune', 'Rare': 'Rare', 'epique': 'Épique', 'Légendaire': 'Légendaire' };

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

/** Visuel d'un objet (carte ou booster) */
function itemVisual(item, extraClass = '') {
    const info = describeItem(item);
    if (item.type === 'display') {
        return `<div class="booster-visual display-stack ${item.displayType} ${extraClass}">
            <img src="${info.image}" alt=""><img src="${info.image}" alt=""><img src="${info.image}" alt="${info.name}">
            <span class="display-tag">DISPLAY</span>
            ${item.quantity > 1 ? `<span class="card-quantity">x${item.quantity}</span>` : ''}</div>`;
    }
    if (item.type === 'booster') {
        return `<div class="booster-visual ${item.boosterType} ${extraClass}"><img src="${info.image}" alt="${info.name}">
            ${item.boosterType === 'v2' ? '<span class="v2-tag">V2</span>' : ''}
            ${item.quantity > 1 ? `<span class="card-quantity">x${item.quantity}</span>` : ''}</div>`;
    }
    return `<div class="card ${rarityClass(info.rarity)} ${extraClass}"><img loading="lazy" decoding="async" class="card-image" src="${info.image}" alt="${escapeHtml(info.name)}">
        ${item.quantity > 1 ? `<span class="card-quantity">x${item.quantity}</span>` : ''}</div>`;
}

// ---------- Vente console (utilisée aussi par la page Collection) ----------

export async function sellCardToConsole(cardId, quantity = 1, pricePerCard = 1, rarity = null) {
    const user = getAuth().currentUser;
    if (!user) {
        showToast("error", "Utilisateur non connecté !");
        return;
    }
    try {
        await sellToConsole(user.uid, cardId, quantity, pricePerCard);
        await updateUserStats(user.uid, { cardsSoldConsole: quantity });
        await updateQuestProgress('sell_console', quantity);
        const usedRarity = rarity || findCard(cardId)?.rarity;
        // On compte chaque carte vendue (vendre 2 épiques d'un coup = 2 pour la quête)
        if (usedRarity === 'epique') await updateQuestProgress('sell_epic_console', quantity);
        if (usedRarity === 'Légendaire') await updateQuestProgress('sell_legendary_console', quantity);
        showToast("success", `Carte vendue à la console pour ${pricePerCard * quantity} pièce(s) !`);
    } catch (error) {
        showToast("error", error.message || "Erreur lors de la vente à la console.");
        console.error("Erreur vente console :", error);
    }
}

// ---------- État de la page ----------

const grid = document.getElementById('market-grid');
let me = null;            // données du joueur (mises à jour en direct)
let listings = [];        // annonces actives
let currentTab = 'all';      // vue : 'all' (acheter), 'mine', 'history'
let currentFilter = 'all';   // filtre de la vue Acheter : 'all', 'auction', 'trade', 'fulfil'
let searchText = '';
let sortMode = 'ending';
let openListingId = null;
let unsubscribeBids = null;
let busy = false;

// Historique
let historyEvents = null;     // null = pas encore chargé
let historyError = false;
let historyFilter = 'all';
let historySeenBefore = 0;    // dernière visite de l'onglet avant celle-ci (pour surligner les nouveautés)

if (grid) initializeMarketplace();

async function initializeMarketplace() {
    const userData = await protectPage();
    if (!userData) return;
    me = userData;

    // Joueur et annonces en temps réel : la page se met à jour toute seule
    onSnapshot(doc(db, "users", me.uid), (snap) => {
        if (!snap.exists()) return;
        me = { uid: me.uid, ...snap.data() };
        renderGrid();
    });
    onSnapshot(query(collection(db, "auctions"), where("status", "==", "active")), (snap) => {
        listings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderGrid();
        if (openListingId) {
            const l = listings.find(x => x.id === openListingId);
            if (l) renderListingModal(l); else closeListingModal();
        }
    });

    setupToolbar();
    document.getElementById('create-listing-button').addEventListener('click', () => openCreateModal());
    document.getElementById('listing-modal-close').addEventListener('click', closeListingModal);
    document.getElementById('create-modal-close').addEventListener('click', closeCreateModal);
    for (const id of ['listing-modal', 'create-modal']) {
        const el = document.getElementById(id);
        el.addEventListener('click', (e) => { if (e.target === el) id === 'listing-modal' ? closeListingModal() : closeCreateModal(); });
    }

    await runFinalize();
    refreshHistory();
    setInterval(async () => { await runFinalize(); refreshHistory(); }, 60000);
    setInterval(updateTimers, 30000); // compte à rebours (sans tout redessiner)

    // Lien direct vers l'historique : marche.html?tab=history
    if (new URLSearchParams(location.search).get('tab') === 'history') document.querySelector('#market-tabs [data-tab="history"]').click();

    // Arrivée depuis la collection : marche.html?sell=C01
    const sellId = new URLSearchParams(location.search).get('sell');
    if (sellId && findCard(sellId)) openCreateModal({ type: 'card', cardId: sellId });
}

async function runFinalize() {
    const results = await finalizeExpiredListings(me?.uid);
    for (const { listing, outcome } of results) {
        const item = getListingItem(listing);
        const name = describeItem(item).name;
        if (outcome === 'sold') {
            // La quête ne peut être créditée qu'au joueur connecté : seulement s'il est le gagnant
            if (listing.highestBidderId === me.uid) {
                await updateQuestProgress('win_bid');
                showToast('success', `🎉 Tu as remporté ${name} !`);
            }
            if (listing.sellerId === me.uid) showToast('success', `💰 ${name} vendu pour ${listing.currentPrice} pièces (tu reçois ${sellerProceeds(listing.currentPrice)} après la taxe) !`);
        }
        if (outcome === 'returned' && listing.sellerId === me.uid) showToast('info', `${name} n'a pas trouvé preneur : il t'a été rendu.`);
    }
}

// ---------- Liste des annonces ----------

function setupToolbar() {
    const tabs = document.querySelectorAll('#market-tabs [data-tab]');
    tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        currentTab = tab.dataset.tab;
        const inHistory = currentTab === 'history';
        document.getElementById('history-view').hidden = !inHistory;
        document.getElementById('market-toolbar').hidden = inHistory;
        document.getElementById('market-filters').hidden = currentTab !== 'all';
        grid.hidden = inHistory;
        if (inHistory) {
            document.getElementById('market-empty').hidden = true;
            openHistory();
        } else {
            renderGrid();
        }
    }));
    const filters = document.querySelectorAll('#market-filters [data-filter]');
    filters.forEach(chip => chip.addEventListener('click', () => {
        filters.forEach(c => c.classList.toggle('active', c === chip));
        currentFilter = chip.dataset.filter;
        renderGrid();
    }));
    document.getElementById('market-search').addEventListener('input', (e) => { searchText = e.target.value.trim().toLowerCase(); renderGrid(); });
    document.getElementById('market-sort').addEventListener('change', (e) => { sortMode = e.target.value; renderGrid(); });
}

/** Le joueur possède-t-il au moins une des cartes demandées ? */
const canFulfill = (listing) => (listing.wantedCardIds || []).some(id => (me.collection?.[id]?.quantity || 0) > 0);

function visibleListings() {
    const now = Date.now();
    let list = listings.filter(l => l.endTime?.toMillis() > now);
    if (currentTab === 'mine') list = list.filter(l => l.sellerId === me.uid);
    else {
        list = list.filter(l => l.sellerId !== me.uid); // « Acheter » : les annonces des autres
        if (currentFilter === 'auction') list = list.filter(l => getListingType(l) === 'auction');
        if (currentFilter === 'trade') list = list.filter(l => getListingType(l) === 'trade');
        if (currentFilter === 'fulfil') list = list.filter(l => getListingType(l) === 'trade' && canFulfill(l));
    }
    if (searchText) {
        list = list.filter(l => {
            const names = [describeItem(getListingItem(l)).name, ...(l.wantedCardIds || []).map(id => cardLabel(findCard(id))), l.sellerPseudo || ''];
            return names.some(n => n.toLowerCase().includes(searchText));
        });
    }
    // Tri par prix : les échanges (sans prix) passent toujours après les enchères
    const byPrice = (dir) => (a, b) => {
        const pa = getListingType(a) === 'auction' ? a.currentPrice : null;
        const pb = getListingType(b) === 'auction' ? b.currentPrice : null;
        if (pa === null || pb === null) return (pa === null) - (pb === null);
        return dir * (pa - pb);
    };
    const sorters = {
        ending: (a, b) => a.endTime.toMillis() - b.endTime.toMillis(),
        recent: (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
        'price-asc': byPrice(1),
        'price-desc': byPrice(-1)
    };
    return list.sort(sorters[sortMode]);
}

function renderGrid() {
    if (!me || currentTab === 'history') return;
    const list = visibleListings();
    const empty = document.getElementById('market-empty');
    empty.hidden = list.length > 0;
    empty.textContent = currentTab === 'mine'
        ? "Tu n'as aucune annonce en cours. Crée-en une avec le bouton ci-dessus !"
        : (searchText ? "Aucune annonce ne correspond à ta recherche." : "Aucune annonce pour le moment. Sois le premier à en créer une !");

    // Compteurs des onglets
    const now = Date.now();
    const active = listings.filter(l => l.endTime?.toMillis() > now);
    const mineCount = active.filter(l => l.sellerId === me.uid).length;
    const fulfilCount = active.filter(l => l.sellerId !== me.uid && getListingType(l) === 'trade' && canFulfill(l)).length;
    const pill = (id, n) => { const el = document.getElementById(id); el.hidden = !n; el.textContent = n; };
    pill('mine-count', mineCount);
    pill('fulfil-count', fulfilCount);

    // On garde les cartes déjà affichées qui n'ont pas changé : pas de rechargement d'images
    const existing = new Map([...grid.children].map(el => [el.dataset.sig, el]));
    const nodes = list.map(listing => {
        const html = tileHTML(listing);
        const sig = listing.id + '|' + html.length + '|' + hashString(html);
        const keep = existing.get(sig);
        if (keep) return keep;
        const tile = document.createElement('div');
        tile.dataset.sig = sig;
        tile.dataset.id = listing.id;
        tile.className = tileClass(listing);
        tile.innerHTML = html;
        tile.addEventListener('click', () => openListingModal(listing.id));
        return tile;
    });
    grid.replaceChildren(...nodes);
    updateTimers();
}

const hashString = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

function tileClass(listing) {
    const type = getListingType(listing);
    const mine = listing.sellerId === me.uid;
    const fulfil = type === 'trade' && !mine && canFulfill(listing);
    return `listing-tile ${type} ${mine ? 'mine' : ''} ${fulfil ? 'can-fulfill' : ''}`;
}

/** Une annonce : type à gauche, statut à droite (une seule ligne de badges), visuel, infos */
function tileHTML(listing) {
    const item = getListingItem(listing);
    const info = describeItem(item);
    const type = getListingType(listing);
    const mine = listing.sellerId === me.uid;
    const fulfil = type === 'trade' && !mine && canFulfill(listing);
    const owned = item.type === 'card' && (me.collection?.[item.cardId]?.quantity || 0) > 0;
    const leading = type === 'auction' && listing.highestBidderId === me.uid;
    const status = mine ? ['mine', 'Ton annonce']
        : leading ? ['leading', '👑 Tu mènes']
        : fulfil ? ['fulfil', '✓ Échangeable']
        : item.type === 'card' ? (owned ? ['owned', 'Possédée'] : ['new', 'Nouvelle']) : null;
    const ended = seriesBadge(item) ? '<span class="listing-collector">💎 Collector</span>' : '';
    const priceLine = type === 'auction'
        ? `<span class="listing-price"><span class="coin-icon"></span>${listing.currentPrice}${listing.highestBidderId ? '' : ' <small>prix de départ</small>'}</span>`
        : `<span class="listing-wanted">Contre ${(listing.wantedCardIds || []).map(id => `<img loading="lazy" src="${findCard(id)?.image || ''}" alt="">`).join('')}</span>`;
    return `
        <div class="listing-badges">
            <span class="listing-type-chip icon ${type}" title="${type === 'auction' ? 'Enchère' : 'Échange'}">${type === 'auction' ? '💰' : '🔄'}</span>
            ${status ? `<span class="listing-status ${status[0]}">${status[1]}</span>` : ''}
        </div>
        ${itemVisual(item)}
        <div class="listing-info">
            <strong class="listing-name">${escapeHtml(info.name)}${item.quantity > 1 ? ` <small>x${item.quantity}</small>` : ''}</strong>
            ${priceLine}
            <span class="listing-meta"><span class="listing-time" data-end="${listing.endTime.toMillis()}"></span> · ${mine ? 'Toi' : escapeHtml(listing.sellerPseudo)}</span>
            ${ended}
        </div>`;
}

/** Minuteurs seuls (toutes les 30 s) : rien d'autre n'est redessiné. Rouge à moins d'une heure. */
function updateTimers() {
    for (const el of grid.querySelectorAll('.listing-time')) {
        const left = Number(el.dataset.end) - Date.now();
        el.textContent = '⏱ ' + calculateTimeLeft({ toMillis: () => Number(el.dataset.end) });
        el.classList.toggle('urgent', left > 0 && left < 3600000);
    }
}

// ---------- Historique ----------

const HISTORY_FILTERS = [
    { key: 'all', label: 'Tout' },
    { key: 'sales', label: '💰 Ventes' },
    { key: 'purchases', label: '🛒 Achats' },
    { key: 'trades', label: '🔄 Échanges' },
    { key: 'cards', label: '🃏 Cartes obtenues' }
];
const HISTORY_ICONS = { sale: '💰', purchase: '🛒', 'market-trade': '🔄', 'friend-trade': '🤝', unsold: '↩️', cancelled: '✖️', refunded: '💸' };
// Événements provoqués par un autre joueur ou par la fin d'une annonce (ceux qui méritent une pastille)
const NOTIFY_KINDS = ['sale', 'purchase', 'market-trade', 'friend-trade', 'unsold', 'refunded'];

const seenKey = () => `marketHistorySeen_${me.uid}`;
function getSeen() {
    try { return Number(localStorage.getItem(seenKey())) || 0; } catch { return 0; }
}
function setSeen(t) {
    try { localStorage.setItem(seenKey(), String(t)); } catch { /* navigation privée */ }
}

/** Recharge l'historique en arrière-plan et met à jour la pastille de l'onglet. */
async function refreshHistory() {
    if (!me) return;
    try {
        historyEvents = await loadMarketHistory(me.uid);
        historyError = false;
    } catch (e) {
        console.error("Erreur historique :", e);
        historyError = historyEvents === null;
    }
    updateHistoryDot();
    if (currentTab === 'history') renderHistory();
}

function updateHistoryDot() {
    const dot = document.getElementById('history-dot');
    if (!dot || !historyEvents) return;
    // Première visite : on ne marque pas tout l'ancien historique comme nouveau
    if (!getSeen()) setSeen(Date.now());
    const fresh = currentTab === 'history' ? 0
        : historyEvents.filter(e => NOTIFY_KINDS.includes(e.kind) && e.time > getSeen()).length;
    dot.hidden = fresh === 0;
    dot.textContent = fresh > 9 ? '9+' : String(fresh);
}

function openHistory() {
    historySeenBefore = getSeen();
    setSeen(Date.now());
    updateHistoryDot();
    renderHistory();
    refreshHistory();
}

/** Libellé du jour : Aujourd'hui, Hier, ou « lundi 20 octobre » */
function dayLabel(time) {
    if (!time) return 'Date inconnue';
    const d = new Date(time);
    const today = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
    return label.charAt(0).toUpperCase() + label.slice(1);
}
const hourLabel = (time) => time ? new Date(time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

/** Nom d'un objet avec sa quantité : « Nicolas (V2) x2 » */
function itemName(item) {
    const name = describeItem(item).name;
    return item.quantity > 1 ? `${name} x${item.quantity}` : name;
}

/** Petite vignette d'un objet (carte ou booster) */
function historyThumb(item, isNew) {
    const info = describeItem(item);
    const qty = item.quantity > 1 ? `<span class="thumb-qty">x${item.quantity}</span>` : '';
    const newTag = isNew ? '<span class="thumb-new" title="Nouvelle carte">✨</span>' : '';
    if (item.type === 'card') {
        return `<span class="history-thumb card-thumb ${rarityClass(info.rarity)}" title="${escapeHtml(info.name)}">
            <img src="${info.image}" alt="${escapeHtml(info.name)}" loading="lazy">${qty}${newTag}</span>`;
    }
    return `<span class="history-thumb booster-thumb ${item.boosterType || ''}" title="${escapeHtml(info.name)}">
        <img src="${info.image}" alt="${escapeHtml(info.name)}" loading="lazy">${qty}</span>`;
}

function historyText(e) {
    const p = `<strong>${escapeHtml(e.partner)}</strong>`;
    const gave = e.gave[0], got = e.got[0];
    switch (e.kind) {
        case 'sale':
            return { title: `${p} a acheté ton ${escapeHtml(itemName(gave))}`,
                sub: `Vendu ${e.price} pièces · tu as reçu ${e.coins} après la taxe` };
        case 'purchase':
            return { title: `Tu as remporté ${escapeHtml(itemName(got))}`, sub: `Enchère de ${p} · payé ${e.price} pièces` };
        case 'market-trade':
            return { title: `Échange avec ${p}`, sub: 'Échange à l’Hôtel des Ventes' };
        case 'friend-trade':
            return { title: `Échange avec ${p}`, sub: 'Échange entre amis' };
        case 'unsold':
            return { title: `${escapeHtml(itemName(gave))} n'a pas trouvé preneur`, sub: 'Rendu dans ton inventaire' };
        case 'cancelled':
            return { title: `Tu as annulé ton annonce`, sub: escapeHtml(itemName(gave)) };
        case 'refunded':
            return { title: `${p} a annulé son annonce`, sub: `${escapeHtml(itemName(gave))} · tes ${e.price} pièces t'ont été rendues` };
        default:
            return { title: '', sub: '' };
    }
}

function historyRow(e) {
    const { title, sub } = historyText(e);
    const isTrade = e.kind === 'market-trade' || e.kind === 'friend-trade';
    const coinsHtml = e.coins ? `<span class="history-coins ${e.coins > 0 ? 'plus' : 'minus'}">${e.coins > 0 ? '+' : '−'}${Math.abs(e.coins)}<span class="coin-icon"></span></span>` : '';
    const thumbs = (items) => items.length ? items.map(it => historyThumb(it, it.type === 'card' && e.newCards.includes(it.cardId))).join('') : '<span class="history-nothing">—</span>';
    let visuals = '';
    if (isTrade) {
        visuals = `<div class="history-swap">
            <div class="swap-side"><span class="swap-label">Donné</span><div class="swap-thumbs">${thumbs(e.gave)}</div></div>
            <span class="swap-arrow" aria-hidden="true">→</span>
            <div class="swap-side"><span class="swap-label">Reçu</span><div class="swap-thumbs">${thumbs(e.got)}</div></div>
        </div>`;
    } else {
        const items = e.got.length ? e.got : e.gave;
        visuals = `<div class="swap-thumbs">${thumbs(items)}</div>`;
    }
    const fresh = e.time > historySeenBefore && historySeenBefore > 0 && NOTIFY_KINDS.includes(e.kind);
    return `<article class="history-item kind-${e.kind} ${fresh ? 'fresh' : ''}">
        <span class="history-icon" aria-hidden="true">${HISTORY_ICONS[e.kind] || '•'}</span>
        <div class="history-body">
            <p class="history-title">${title}</p>
            <p class="history-sub">${sub}</p>
            ${visuals}
        </div>
        <div class="history-side">
            ${coinsHtml}
            <span class="history-time">${hourLabel(e.time)}</span>
            ${fresh ? '<span class="history-fresh">Nouveau</span>' : ''}
        </div>
    </article>`;
}

function renderHistoryCards(events) {
    const cards = receivedCards(events);
    if (!cards.length) return `<p class="market-empty">Tu n'as encore reçu aucune carte au marché ou par échange.</p>`;
    return `<div class="history-cards">${cards.map(c => {
        const card = findCard(c.cardId);
        const name = card ? cardLabel(card) : c.cardId;
        return `<div class="history-card ${c.isNew ? 'is-new' : ''}">
            <div class="card ${rarityClass(card?.rarity)}"><img class="card-image" src="${card?.image || ''}" alt="${escapeHtml(name)}" loading="lazy">
                ${c.quantity > 1 ? `<span class="card-quantity">x${c.quantity}</span>` : ''}</div>
            ${c.isNew ? '<span class="history-new-badge">✨ Nouvelle</span>' : ''}
            <strong>${escapeHtml(name)}</strong>
            <small>${c.from.length ? 'de ' + c.from.map(escapeHtml).join(', ') : ''}</small>
            <small>${dayLabel(c.lastTime)}</small>
        </div>`;
    }).join('')}</div>
    <p class="hint history-hint">Le badge ✨ Nouvelle s'affiche sur les cartes que tu n'avais pas encore, pour tout ce que tu obtiens à partir de maintenant.</p>`;
}

function renderHistory() {
    const view = document.getElementById('history-view');
    if (!view || currentTab !== 'history') return;
    if (historyEvents === null) {
        view.innerHTML = historyError
            ? `<p class="market-empty">Impossible de charger l'historique. Vérifie ta connexion et réessaie.</p>`
            : `<p class="market-empty">Chargement de ton historique…</p>`;
        return;
    }

    const s = summarize(historyEvents);
    const filters = {
        all: () => true,
        sales: (e) => e.kind === 'sale' || e.kind === 'unsold',
        purchases: (e) => e.kind === 'purchase' || e.kind === 'refunded',
        trades: (e) => e.kind === 'market-trade' || e.kind === 'friend-trade'
    };

    let content;
    if (historyFilter === 'cards') {
        content = renderHistoryCards(historyEvents);
    } else {
        const list = historyEvents.filter(filters[historyFilter]);
        if (!list.length) {
            content = `<p class="market-empty">${historyEvents.length ? 'Rien dans cette catégorie pour le moment.' : "Ton historique est vide. Vends, achète ou échange une carte et tout s'affichera ici !"}</p>`;
        } else {
            const groups = [];
            for (const e of list) {
                const label = dayLabel(e.time);
                if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
                groups[groups.length - 1].items.push(e);
            }
            content = groups.map(g => `<h4 class="history-day">${g.label}</h4>${g.items.map(historyRow).join('')}`).join('');
        }
    }

    view.innerHTML = `
        <div class="history-summary">
            <div class="summary-tile"><span>Pièces gagnées</span><strong class="plus">+${s.earned}<span class="coin-icon"></span></strong></div>
            <div class="summary-tile"><span>Pièces dépensées</span><strong class="minus">−${s.spent}<span class="coin-icon"></span></strong></div>
            <div class="summary-tile"><span>Cartes reçues</span><strong>${s.cardsReceived}</strong></div>
            <div class="summary-tile"><span>Ventes · Achats · Échanges</span><strong>${s.sales} · ${s.purchases} · ${s.trades}</strong></div>
        </div>
        <div class="filter-chips history-filters">${HISTORY_FILTERS.map(f =>
            `<button class="chip ${historyFilter === f.key ? 'active' : ''}" data-hfilter="${f.key}">${f.label}</button>`).join('')}</div>
        <div class="history-list">${content}</div>`;

    // Le filtre choisi reste visible dans la barre qui défile (sans faire bouger la page)
    const bar = view.querySelector('.history-filters');
    const active = bar.querySelector('.chip.active');
    if (active) bar.scrollLeft = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;

    view.querySelectorAll('[data-hfilter]').forEach(b => b.addEventListener('click', () => {
        historyFilter = b.dataset.hfilter;
        renderHistory();
    }));
}

// ---------- Détail d'une annonce ----------

function openListingModal(id) {
    const listing = listings.find(l => l.id === id);
    if (!listing) return;
    openListingId = id;
    renderListingModal(listing);
    document.getElementById('listing-modal').style.display = 'flex';

    if (unsubscribeBids) unsubscribeBids();
    unsubscribeBids = null;
    if (getListingType(listing) === 'auction') {
        unsubscribeBids = onSnapshot(query(collection(db, "auctions", id, "bids"), orderBy("timestamp", "desc")), (snap) => {
            const list = document.getElementById('bid-history-list');
            if (!list) return;
            list.innerHTML = snap.empty ? '<li>Aucune enchère pour le moment.</li>'
                : snap.docs.map(d => `<li><strong>${escapeHtml(d.data().bidderPseudo)}</strong> a misé <strong>${escapeHtml(d.data().amount)}</strong> pièces</li>`).join('');
        });
    }
}

function closeListingModal() {
    document.getElementById('listing-modal').style.display = 'none';
    openListingId = null;
    if (unsubscribeBids) unsubscribeBids();
    unsubscribeBids = null;
}

function renderListingModal(listing) {
    const body = document.getElementById('listing-modal-body');
    const item = getListingItem(listing);
    const info = describeItem(item);
    const type = getListingType(listing);
    const mine = listing.sellerId === me.uid;

    let actions = '';
    if (type === 'auction') {
        const minBid = listing.currentPrice + 1;
        actions = `
            <div class="listing-stats">
                <div><span>Prix actuel</span><strong class="gold"><span class="coin-icon"></span>${listing.currentPrice}</strong></div>
                <div><span>Meilleure offre</span><strong>${listing.highestBidderPseudo ? escapeHtml(listing.highestBidderPseudo) + (listing.highestBidderId === me.uid ? ' (toi)' : '') : '—'}</strong></div>
            </div>
            ${mine ? `<p class="hint">Si l'enchère se termine maintenant, tu reçois <strong>${sellerProceeds(listing.currentPrice)}</strong> pièces (taxe de ${Math.round(MARKET_TAX_RATE * 100)} %).</p>` : ''}
            ${mine ? '' : `
            <div class="bid-form">
                <input type="number" id="bid-amount-input" min="${minBid}" value="${minBid}" inputmode="numeric">
                <button id="submit-bid-button">Miser</button>
            </div>
            <div class="quick-bids">${[1, 5, Math.max(10, Math.ceil(listing.currentPrice * 0.1))].map(n => `<button class="chip" data-add="${n}">+${n}</button>`).join('')}</div>
            ${listing.highestBidderId === me.uid ? '<p class="hint good">👑 Tu es le meilleur enchérisseur. Tu peux encore monter ta mise.</p>' : ''}
            <p class="hint" id="bid-hint">Tu as <strong>${me.coins || 0}</strong> pièces. Si quelqu'un mise plus que toi, tes pièces te sont rendues.</p>`}
            <div class="bid-history"><h4>Historique</h4><ul id="bid-history-list"><li>Chargement…</li></ul></div>`;
    } else {
        const wanted = (listing.wantedCardIds || []).map(id => {
            const card = findCard(id);
            const have = me.collection?.[id]?.quantity || 0;
            return `
                <div class="wanted-card ${have > 0 ? 'have' : ''}">
                    <div class="card ${rarityClass(card?.rarity)}"><img loading="lazy" decoding="async" class="card-image" src="${card?.image || ''}" alt=""></div>
                    <span class="wanted-name">${escapeHtml(cardLabel(card) || id)}</span>
                    <span class="wanted-have">${have > 0 ? `Tu en as ${have}` : 'Tu ne l’as pas'}</span>
                    ${mine ? '' : `<button class="give-button" data-card="${id}" ${have > 0 ? '' : 'disabled'}>Donner</button>`}
                </div>`;
        }).join('');
        actions = `
            <p class="trade-explain">${mine ? 'Tu acceptes une de ces cartes en échange :' : `Donne <strong>une</strong> de ces cartes et reçois ${escapeHtml(info.name)}${item.quantity > 1 ? ` x${item.quantity}` : ''} immédiatement :`}</p>
            <div class="wanted-grid">${wanted}</div>`;
    }

    body.innerHTML = `
        <div class="listing-detail-head">
            ${itemVisual(item, 'detail-visual')}
            <div class="listing-detail-info">
                <span class="listing-type-chip static">${type === 'auction' ? '💰 Enchère' : '🔄 Échange'}</span>
                <h3>${escapeHtml(info.name)}${item.quantity > 1 ? ` <small>x${item.quantity}</small>` : ''}</h3>
                ${info.rarity ? `<span class="rarity-chip ${rarityClass(info.rarity)}">${RARITY_LABELS[info.rarity]}</span>` : ''}
                <p>Vendeur : <strong>${mine ? 'Toi' : escapeHtml(listing.sellerPseudo)}</strong></p>
                <p>Fin dans : <strong>${calculateTimeLeft(listing.endTime)}</strong></p>
            </div>
        </div>
        ${actions}
        ${mine ? `<button id="cancel-listing-button" class="button-secondary">Annuler mon annonce</button>` : ''}
    `;

    body.querySelector('#submit-bid-button')?.addEventListener('click', () => handleBid(listing));
    // Coût réel de la mise (si je mène déjà, je ne paie que la différence) et pièces disponibles
    const bidInput = document.getElementById('bid-amount-input');
    const checkBid = () => {
        if (!bidInput) return;
        const amount = parseInt(bidInput.value, 10) || 0;
        const cost = listing.highestBidderId === me.uid ? amount - listing.currentPrice : amount;
        const ok = amount > listing.currentPrice && cost <= (me.coins || 0);
        const btn = document.getElementById('submit-bid-button');
        btn.disabled = !ok;
        btn.textContent = amount > listing.currentPrice ? `Miser ${amount}` : 'Miser';
        document.getElementById('bid-hint').innerHTML = cost > (me.coins || 0)
            ? `<span class="bad">Il te manque ${cost - (me.coins || 0)} pièces pour cette mise.</span>`
            : `Tu as <strong>${me.coins || 0}</strong> pièces. Si quelqu'un mise plus que toi, tes pièces te sont rendues.`;
    };
    bidInput?.addEventListener('input', checkBid);
    checkBid();
    body.querySelectorAll('.quick-bids .chip').forEach(btn => btn.addEventListener('click', () => {
        bidInput.value = listing.currentPrice + Number(btn.dataset.add);
        checkBid();
    }));
    body.querySelectorAll('.give-button').forEach(btn => btn.addEventListener('click', () => handleGive(listing, btn.dataset.card)));
    body.querySelector('#cancel-listing-button')?.addEventListener('click', () => handleCancel(listing));
}

async function handleBid(listing) {
    if (busy) return;
    const amount = parseInt(document.getElementById('bid-amount-input').value, 10);
    busy = true;
    try {
        await placeBid(me, listing.id, amount);
        showToast('success', `Enchère placée : ${amount} pièces !`);
        updateQuestProgress('place_bid');
    } catch (e) {
        showToast('error', e.message || "Erreur lors de la mise.");
    } finally {
        busy = false;
    }
}

async function handleGive(listing, cardId) {
    if (busy) return;
    const card = findCard(cardId);
    const have = me.collection?.[cardId]?.quantity || 0;
    const itemName = describeItem(getListingItem(listing)).name;
    const ok = await showConfirmDialog({
        title: "Confirmer l'échange",
        message: `Donner ${cardLabel(card)} contre ${itemName} ?${have === 1 ? ' Attention : c’est ton seul exemplaire !' : ''}`,
        confirmText: 'Échanger',
        cancelText: 'Annuler'
    });
    if (!ok) return;
    busy = true;
    try {
        await acceptTradeListing(me, listing.id, cardId);
        showToast('success', `🔄 Échange réussi ! Tu as reçu ${itemName}.`);
        closeListingModal();
        refreshHistory();
        const item = getListingItem(listing);
        if (item.type === 'card') updateQuestProgress('obtain_10_diff_cards_24h', 1, { cardId: item.cardId });
    } catch (e) {
        showToast('error', e.message || "Échange impossible.");
    } finally {
        busy = false;
    }
}

async function handleCancel(listing) {
    const ok = await showConfirmDialog({
        title: "Annuler l'annonce",
        message: "L'objet te sera rendu" + (listing.highestBidderId ? " et le meilleur enchérisseur remboursé." : "."),
        confirmText: 'Oui, annuler',
        cancelText: 'Non'
    });
    if (!ok) return;
    try {
        await cancelListing(me, listing.id);
        showToast('success', "Annonce annulée, l'objet t'a été rendu.");
        closeListingModal();
        refreshHistory();
    } catch (e) {
        showToast('error', e.message || "Erreur lors de l'annulation.");
    }
}

// ---------- Création d'une annonce ----------

const draft = { itemType: 'card', cardId: null, boosterType: null, quantity: 1, mode: 'auction', price: 0, wanted: [], duration: 24, cardSearch: '', wantSearch: '' };

function openCreateModal(preset) {
    Object.assign(draft, { itemType: 'card', cardId: null, boosterType: null, displayType: null, quantity: 1, mode: 'auction', price: 0, wanted: [], duration: 24, cardSearch: '', wantSearch: '' });
    if (preset?.type === 'card') draft.cardId = preset.cardId;
    renderCreate();
    document.getElementById('create-modal').style.display = 'flex';
}
function closeCreateModal() {
    document.getElementById('create-modal').style.display = 'none';
}

function draftItem() {
    if (draft.itemType === 'display') return draft.displayType ? { type: 'display', displayType: draft.displayType, quantity: draft.quantity } : null;
    if (draft.itemType === 'booster') return draft.boosterType ? { type: 'booster', boosterType: draft.boosterType, quantity: draft.quantity } : null;
    return draft.cardId ? { type: 'card', cardId: draft.cardId, quantity: draft.quantity } : null;
}
function maxQuantity() {
    if (draft.itemType === 'display') return me.displayInventory?.[draft.displayType] || 0;
    if (draft.itemType === 'booster') return me.boosterInventory?.[draft.boosterType] || 0;
    return Math.max(0, (me.collection?.[draft.cardId]?.quantity || 0) - 1);
}

function renderCreate() {
    const body = document.getElementById('create-body');
    const dupes = ALL_CARDS
        .filter(c => (me.collection?.[c.id]?.quantity || 0) >= 2)
        .filter(c => !draft.cardSearch || cardLabel(c).toLowerCase().includes(draft.cardSearch));
    const item = draftItem();
    if (item && draft.quantity > maxQuantity()) draft.quantity = Math.max(1, maxQuantity());
    const min = item ? minPriceFor({ ...item, quantity: draft.quantity }) : 0;
    if (draft.price < min) draft.price = min;

    const cardPicker = dupes.length === 0
        ? `<p class="empty-msg">Tu n'as aucun doublon pour l'instant. Ouvre des boosters !</p>`
        : `<input type="search" class="picker-search" id="card-search" placeholder="Chercher dans tes doublons…" value="${escapeHtml(draft.cardSearch)}">
           <div class="pick-grid">${dupes.map(c => `
            <button class="pick-tile ${draft.cardId === c.id ? 'selected' : ''}" data-card="${c.id}">
                <img loading="lazy" src="${c.image}" alt=""><span>${escapeHtml(cardLabel(c))}</span><small>x${me.collection[c.id].quantity}</small>
            </button>`).join('')}</div>`;

    const boosterPicker = `<div class="pick-row">${Object.entries(BOOSTER_INFO).map(([t, b]) => {
        const n = me.boosterInventory?.[t] || 0;
        return `<button class="pick-tile booster ${t} ${draft.boosterType === t ? 'selected' : ''}" data-booster="${t}" ${n ? '' : 'disabled'}>
            <img src="assets/booster/booster.webp" alt=""><span>${b.name}</span><small>x${n}</small></button>`;
    }).join('')}</div>`;

    const displayPicker = `<div class="pick-row">${Object.entries(DISPLAY_INFO).map(([t, d]) => {
        const n = me.displayInventory?.[t] || 0;
        return `<button class="pick-tile booster ${t} ${draft.displayType === t ? 'selected' : ''}" data-display="${t}" ${n ? '' : 'disabled'}>
            <img src="assets/booster/booster.webp" alt=""><span>${d.name}</span><small>x${n}</small></button>`;
    }).join('')}</div>`;

    const wantList = ALL_CARDS
        .filter(c => !(draft.itemType === 'card' && c.id === draft.cardId))
        .filter(c => !draft.wantSearch || cardLabel(c).toLowerCase().includes(draft.wantSearch));

    body.innerHTML = `
        <div class="form-step">
            <span class="step-label">1. Que veux-tu proposer ?</span>
            <div class="segmented">
                <button data-itemtype="card" class="${draft.itemType === 'card' ? 'active' : ''}">🃏 Une carte</button>
                <button data-itemtype="booster" class="${draft.itemType === 'booster' ? 'active' : ''}">🎴 Un booster</button>
                <button data-itemtype="display" class="${draft.itemType === 'display' ? 'active' : ''}">🗃️ Une display</button>
            </div>
            ${{ card: cardPicker, booster: boosterPicker, display: displayPicker }[draft.itemType]}
            ${item ? `
            <div class="qty-row">
                <span>Quantité</span>
                <div class="stepper"><button data-qty="-1">−</button><strong>${draft.quantity}</strong><button data-qty="1">+</button></div>
                <small>max ${maxQuantity()}${draft.itemType === 'card' ? ' (tu gardes 1 exemplaire)' : ''}</small>
            </div>` : ''}
        </div>

        <div class="form-step">
            <span class="step-label">2. Type d'annonce</span>
            <div class="segmented">
                <button data-mode="auction" class="${draft.mode === 'auction' ? 'active' : ''}">💰 Enchère</button>
                <button data-mode="trade" class="${draft.mode === 'trade' ? 'active' : ''}">🔄 Échange</button>
            </div>
            ${draft.mode === 'auction' ? `
                <label class="field-label" for="price-input">Prix de départ ${item ? `(minimum ${min})` : ''}</label>
                <input type="number" id="price-input" min="${min}" value="${draft.price || ''}" inputmode="numeric" ${item ? '' : 'disabled'}>
                <p class="hint">Taxe de l'Hôtel des Ventes : ${Math.round(MARKET_TAX_RATE * 100)} % du prix final est prélevé à la vente. Les échanges ne sont pas taxés.</p>
            ` : `
                <span class="field-label">Cartes que tu acceptes en échange (1 à ${MAX_WANTED_CARDS}) — <strong>${draft.wanted.length} choisie(s)</strong></span>
                <input type="search" class="picker-search" id="want-search" placeholder="Chercher une carte…" value="${escapeHtml(draft.wantSearch)}">
                <div class="pick-grid wanted-picker">${wantList.map(c => {
                    const have = (me.collection?.[c.id]?.quantity || 0) > 0;
                    return `<button class="pick-tile ${draft.wanted.includes(c.id) ? 'selected' : ''}" data-want="${c.id}">
                        <img loading="lazy" src="${c.image}" alt=""><span>${escapeHtml(cardLabel(c))}</span><small>${have ? 'possédée' : '<b>manquante</b>'}</small></button>`;
                }).join('')}</div>
            `}
        </div>

        <div class="form-step">
            <span class="step-label">3. Durée</span>
            <div class="filter-chips no-bleed">${DURATIONS_HOURS.map(h => `<button class="chip ${draft.duration === h ? 'active' : ''}" data-duration="${h}">${h}h</button>`).join('')}</div>
        </div>

        <button id="publish-button" ${item ? '' : 'disabled'}>Publier l'annonce</button>
    `;

    const rerender = () => renderCreate();
    body.querySelectorAll('[data-itemtype]').forEach(b => b.onclick = () => { draft.itemType = b.dataset.itemtype; draft.quantity = 1; rerender(); });
    body.querySelectorAll('[data-card]').forEach(b => b.onclick = () => { draft.cardId = b.dataset.card; draft.quantity = 1; draft.wanted = draft.wanted.filter(id => id !== draft.cardId); rerender(); });
    body.querySelectorAll('[data-display]').forEach(b => b.onclick = () => { draft.displayType = b.dataset.display; draft.quantity = 1; rerender(); });
    body.querySelectorAll('[data-booster]').forEach(b => b.onclick = () => { draft.boosterType = b.dataset.booster; draft.quantity = 1; rerender(); });
    body.querySelectorAll('[data-qty]').forEach(b => b.onclick = () => { draft.quantity = Math.min(Math.max(1, draft.quantity + Number(b.dataset.qty)), Math.max(1, maxQuantity())); rerender(); });
    body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { draft.mode = b.dataset.mode; rerender(); });
    body.querySelectorAll('[data-duration]').forEach(b => b.onclick = () => { draft.duration = Number(b.dataset.duration); rerender(); });
    body.querySelectorAll('[data-want]').forEach(b => b.onclick = () => {
        const id = b.dataset.want;
        if (draft.wanted.includes(id)) draft.wanted = draft.wanted.filter(x => x !== id);
        else if (draft.wanted.length >= MAX_WANTED_CARDS) { showToast('warning', `Maximum ${MAX_WANTED_CARDS} cartes.`); return; }
        else draft.wanted.push(id);
        rerender();
    });
    // Recherche : on garde le focus et la position du curseur après le rafraîchissement
    for (const [inputId, key] of [['card-search', 'cardSearch'], ['want-search', 'wantSearch']]) {
        const input = body.querySelector('#' + inputId);
        if (!input) continue;
        input.oninput = () => {
            draft[key] = input.value.trim().toLowerCase();
            rerender();
            const again = document.getElementById(inputId);
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
        };
    }
    const priceInput = body.querySelector('#price-input');
    if (priceInput) priceInput.oninput = () => { draft.price = parseInt(priceInput.value, 10) || 0; };
    body.querySelector('#publish-button').onclick = publish;
}

async function publish() {
    if (busy) return;
    const item = draftItem();
    if (!item) return;
    busy = true;
    const button = document.getElementById('publish-button');
    button.disabled = true;
    try {
        await createListing(me, {
            mode: draft.mode, item, startPrice: draft.price, wantedCardIds: draft.wanted, durationHours: draft.duration
        });
        showToast('success', 'Annonce publiée ! Retrouve-la dans « Mes annonces ».');
        updateQuestProgress('create_auction');
        closeCreateModal();
        document.querySelector('#market-tabs [data-tab="mine"]').click();
    } catch (e) {
        showToast('error', e.message || "Impossible de publier l'annonce.");
        button.disabled = false;
    } finally {
        busy = false;
    }
}
