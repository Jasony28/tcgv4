// Fichier: marche.js — interface de l'Hôtel des Ventes (la logique est dans market-service.js)
import { collection, query, where, doc, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { updateUserStats } from './stats-manager.js';
import { updateQuestProgress } from './quest-manager.js';
import {
    ALL_CARDS, BOOSTER_INFO, DURATIONS_HOURS, MAX_WANTED_CARDS,
    findCard, cardLabel, getListingItem, getListingType, describeItem, minPriceFor,
    createListing, placeBid, acceptTradeListing, cancelListing, finalizeExpiredListings, sellToConsole
} from './market-service.js';

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
    if (item.type === 'booster') {
        return `<div class="booster-visual ${item.boosterType} ${extraClass}"><img src="${info.image}" alt="${info.name}">
            ${item.boosterType === 'v2' ? '<span class="v2-tag">V2</span>' : ''}
            ${item.quantity > 1 ? `<span class="card-quantity">x${item.quantity}</span>` : ''}</div>`;
    }
    return `<div class="card ${rarityClass(info.rarity)} ${extraClass}"><img class="card-image" src="${info.image}" alt="${escapeHtml(info.name)}">
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
let currentTab = 'all';
let searchText = '';
let sortMode = 'ending';
let openListingId = null;
let unsubscribeBids = null;
let busy = false;

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
    setInterval(runFinalize, 60000);
    setInterval(renderGrid, 30000); // compte à rebours

    // Arrivée depuis la collection : marche.html?sell=C01
    const sellId = new URLSearchParams(location.search).get('sell');
    if (sellId && findCard(sellId)) openCreateModal({ type: 'card', cardId: sellId });
}

async function runFinalize() {
    const results = await finalizeExpiredListings();
    for (const { listing, outcome } of results) {
        const item = getListingItem(listing);
        const name = describeItem(item).name;
        if (outcome === 'sold') {
            await updateUserStats(listing.sellerId, { cardsSoldMarket: 1, bestSale: { cardId: item.cardId || null, name, price: listing.currentPrice } });
            await updateUserStats(listing.highestBidderId, { bestPurchase: { cardId: item.cardId || null, name, price: listing.currentPrice } });
            // La quête ne peut être créditée qu'au joueur connecté : seulement s'il est le gagnant
            if (listing.highestBidderId === me.uid) {
                await updateQuestProgress('win_bid');
                showToast('success', `🎉 Tu as remporté ${name} !`);
            }
            if (listing.sellerId === me.uid) showToast('success', `💰 ${name} vendu pour ${listing.currentPrice} pièces !`);
        } else if (getListingType(listing) === 'auction') {
            await updateUserStats(listing.sellerId, { failedSales: 1 });
        }
        if (outcome === 'returned' && listing.sellerId === me.uid) showToast('info', `${name} n'a pas trouvé preneur : il t'a été rendu.`);
    }
}

// ---------- Liste des annonces ----------

function setupToolbar() {
    const tabs = document.querySelectorAll('#market-tabs .chip');
    tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        currentTab = tab.dataset.tab;
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
    if (currentTab === 'auction') list = list.filter(l => getListingType(l) === 'auction' && l.sellerId !== me.uid);
    if (currentTab === 'trade') list = list.filter(l => getListingType(l) === 'trade' && l.sellerId !== me.uid);
    if (currentTab === 'mine') list = list.filter(l => l.sellerId === me.uid);
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
    if (!me) return;
    const list = visibleListings();
    const empty = document.getElementById('market-empty');
    empty.hidden = list.length > 0;
    empty.textContent = currentTab === 'mine'
        ? "Tu n'as aucune annonce en cours. Crée-en une avec le bouton ci-dessus !"
        : (searchText ? "Aucune annonce ne correspond à ta recherche." : "Aucune annonce pour le moment. Sois le premier à en créer une !");

    grid.innerHTML = '';
    for (const listing of list) {
        const item = getListingItem(listing);
        const info = describeItem(item);
        const type = getListingType(listing);
        const mine = listing.sellerId === me.uid;
        const fulfil = type === 'trade' && !mine && canFulfill(listing);
        const owned = item.type === 'card' && (me.collection?.[item.cardId]?.quantity || 0) > 0;

        const tile = document.createElement('div');
        tile.className = `listing-tile ${type} ${mine ? 'mine' : ''} ${fulfil ? 'can-fulfill' : ''}`;
        const priceLine = type === 'auction'
            ? `<span class="listing-price"><span class="coin-icon"></span>${listing.currentPrice}</span>`
            : `<span class="listing-wanted">Contre ${(listing.wantedCardIds || []).map(id => `<img src="${findCard(id)?.image || ''}" alt="">`).join('')}</span>`;
        tile.innerHTML = `
            <span class="listing-type-chip">${type === 'auction' ? '💰 Enchère' : '🔄 Échange'}</span>
            ${itemVisual(item)}
            ${item.type === 'card' ? `<span class="ownership-badge ${owned ? 'owned' : 'not-owned'}">${owned ? 'Possédée' : 'Nouvelle'}</span>` : ''}
            <div class="listing-info">
                <strong class="listing-name">${escapeHtml(info.name)}</strong>
                ${priceLine}
                <span class="listing-meta">⏱ ${calculateTimeLeft(listing.endTime)} · ${mine ? 'Ton annonce' : escapeHtml(listing.sellerPseudo)}</span>
                ${fulfil ? '<span class="fulfil-hint">✓ Tu as une carte demandée</span>' : ''}
            </div>`;
        tile.addEventListener('click', () => openListingModal(listing.id));
        grid.appendChild(tile);
    }
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
            ${mine ? '' : `
            <div class="bid-form">
                <input type="number" id="bid-amount-input" min="${minBid}" value="${minBid}" inputmode="numeric">
                <button id="submit-bid-button">Miser</button>
            </div>
            <div class="quick-bids">${[1, 5, 10].map(n => `<button class="chip" data-add="${n}">+${n}</button>`).join('')}</div>
            <p class="hint">Tu as <strong>${me.coins || 0}</strong> pièces. Si quelqu'un mise plus que toi, tes pièces te sont rendues.</p>`}
            <div class="bid-history"><h4>Historique</h4><ul id="bid-history-list"><li>Chargement…</li></ul></div>`;
    } else {
        const wanted = (listing.wantedCardIds || []).map(id => {
            const card = findCard(id);
            const have = me.collection?.[id]?.quantity || 0;
            return `
                <div class="wanted-card ${have > 0 ? 'have' : ''}">
                    <div class="card ${rarityClass(card?.rarity)}"><img class="card-image" src="${card?.image || ''}" alt=""></div>
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
    body.querySelectorAll('.quick-bids .chip').forEach(btn => btn.addEventListener('click', () => {
        const input = document.getElementById('bid-amount-input');
        input.value = listing.currentPrice + Number(btn.dataset.add);
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
    } catch (e) {
        showToast('error', e.message || "Erreur lors de l'annulation.");
    }
}

// ---------- Création d'une annonce ----------

const draft = { itemType: 'card', cardId: null, boosterType: null, quantity: 1, mode: 'auction', price: 0, wanted: [], duration: 24, cardSearch: '', wantSearch: '' };

function openCreateModal(preset) {
    Object.assign(draft, { itemType: 'card', cardId: null, boosterType: null, quantity: 1, mode: 'auction', price: 0, wanted: [], duration: 24, cardSearch: '', wantSearch: '' });
    if (preset?.type === 'card') draft.cardId = preset.cardId;
    renderCreate();
    document.getElementById('create-modal').style.display = 'flex';
}
function closeCreateModal() {
    document.getElementById('create-modal').style.display = 'none';
}

function draftItem() {
    if (draft.itemType === 'booster') return draft.boosterType ? { type: 'booster', boosterType: draft.boosterType, quantity: draft.quantity } : null;
    return draft.cardId ? { type: 'card', cardId: draft.cardId, quantity: draft.quantity } : null;
}
function maxQuantity() {
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
                <img src="${c.image}" alt=""><span>${escapeHtml(cardLabel(c))}</span><small>x${me.collection[c.id].quantity}</small>
            </button>`).join('')}</div>`;

    const boosterPicker = `<div class="pick-row">${Object.entries(BOOSTER_INFO).map(([t, b]) => {
        const n = me.boosterInventory?.[t] || 0;
        return `<button class="pick-tile booster ${t} ${draft.boosterType === t ? 'selected' : ''}" data-booster="${t}" ${n ? '' : 'disabled'}>
            <img src="assets/booster/booster.png" alt=""><span>${b.name}</span><small>x${n}</small></button>`;
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
            </div>
            ${draft.itemType === 'card' ? cardPicker : boosterPicker}
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
            ` : `
                <span class="field-label">Cartes que tu acceptes en échange (1 à ${MAX_WANTED_CARDS}) — <strong>${draft.wanted.length} choisie(s)</strong></span>
                <input type="search" class="picker-search" id="want-search" placeholder="Chercher une carte…" value="${escapeHtml(draft.wantSearch)}">
                <div class="pick-grid wanted-picker">${wantList.map(c => {
                    const have = (me.collection?.[c.id]?.quantity || 0) > 0;
                    return `<button class="pick-tile ${draft.wanted.includes(c.id) ? 'selected' : ''}" data-want="${c.id}">
                        <img src="${c.image}" alt=""><span>${escapeHtml(cardLabel(c))}</span><small>${have ? 'possédée' : '<b>manquante</b>'}</small></button>`;
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
