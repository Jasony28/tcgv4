// Fichier: boutique.js — interface de la boutique (la logique est dans shop-service.js)
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { updateQuestProgress } from './quest-manager.js';
import { updateUserStats } from './stats-manager.js';
import { getDayKey, msUntilNextDay, formatDuration } from './daily-utils.js';
import {
    getDailyShop, SHOP_RARITY_ODDS, SHOP_BOOSTERS, SHOP_DISPLAYS, SHOP_PACKS, GIFT_CALENDAR, MYSTERY_TABLE,
    RARITY_LABELS, getDailyDeal, boosterPriceToday, displaySaving, describeBoosters
} from './shop-config.js';
import {
    getShopState, getGiftStatus, packAvailability,
    buyCard, buyBooster, buyDisplay, buyPack, claimGift
} from './shop-service.js';
import { isBoosterProduced, seriesAnnouncements } from './series-config.js';

const $ = (id) => document.getElementById(id);
let userData;
let currentDay = getDayKey();
let busy = false;

const rarityClass = (rarity) => `rarity-${rarity.replace(/é/g, 'e')}`;
const priceButton = (price, { disabled = false, label = null, oldPrice = null } = {}) => `
    <button class="price-button" ${disabled ? 'disabled' : ''}>
        ${label ?? `${oldPrice ? `<s>${oldPrice}</s>` : ''}<span class="coin-icon"></span>${price}`}
    </button>`;

// ---------- Affichage ----------

function renderGift() {
    const status = getGiftStatus(userData, currentDay);
    $('gift-streak').textContent = `Série : jour ${status.day} / ${GIFT_CALENDAR.length}`;
    $('gift-days').innerHTML = GIFT_CALENDAR.map((reward, i) => {
        const day = i + 1;
        const state = day < status.day || (day === status.day && status.claimedToday) ? 'done'
            : (day === status.day ? 'today' : 'next');
        return `
            <div class="gift-day ${state} ${reward.boosters ? 'big' : ''}">
                <span class="gift-day-label">J${day}</span>
                <span class="gift-day-icon">${reward.boosters ? '🎁' : '🪙'}</span>
                <span class="gift-day-reward">${reward.coins}${reward.boosters ? ' +V2' : ''}</span>
            </div>`;
    }).join('');
    const btn = $('gift-button');
    btn.disabled = status.claimedToday;
    btn.textContent = status.claimedToday
        ? 'Récupéré ✓ — reviens demain'
        : `Récupérer : +${status.reward.coins} pièces${status.reward.boosters ? ' + ' + describeBoosters(status.reward.boosters) : ''}`;
}

function renderDeal() {
    const deal = getDailyDeal(currentDay);
    $('daily-deal').hidden = !deal.type;
    if (!deal.type) return; // aucune série en cours
    const def = SHOP_BOOSTERS[deal.type];
    const state = getShopState(userData, currentDay);
    const soldOut = state.boosters[deal.type] >= def.dailyLimit;
    const price = boosterPriceToday(deal.type, currentDay);
    $('daily-deal').innerHTML = `
        <span class="deal-tag">⚡ Offre du jour · -${Math.round(deal.discount * 100)} %</span>
        <div class="booster-item ${deal.type} deal">
            <img src="assets/booster/booster.png" alt="">
            <div class="booster-item-info">
                <strong>${def.name}</strong>
                <span>${def.description}</span>
                <span class="booster-stock">Change à minuit</span>
            </div>
            ${priceButton(price, { oldPrice: def.price, disabled: soldOut || (userData.coins || 0) < price, label: soldOut ? 'Épuisé' : null })}
        </div>`;
    if (!soldOut) $('daily-deal').querySelector('.price-button').onclick = () => onBuyBooster(deal.type);
}

function renderPacks() {
    $('shop-packs').innerHTML = '';
    for (const [id, pack] of Object.entries(SHOP_PACKS)) {
        const avail = packAvailability(userData, id);
        const el = document.createElement('div');
        el.className = `pack-item pack-${id} ${avail.available ? '' : 'sold'}`;
        el.innerHTML = `
            <div class="pack-icon">${pack.icon}</div>
            <div class="pack-info">
                <strong>${pack.name}</strong>
                <span>${pack.description}</span>
                <span class="pack-limit">${{ once: 'Une seule fois', daily: '1 par jour', weekend: 'Samedi et dimanche uniquement' }[pack.limit]}</span>
            </div>
            ${priceButton(pack.price, { disabled: !avail.available || (userData.coins || 0) < pack.price, label: avail.available ? null : avail.reason })}
        `;
        if (avail.available) el.querySelector('.price-button').onclick = () => onBuyPack(id);
        if (id === 'mystery') {
            el.querySelector('.pack-info').insertAdjacentHTML('beforeend',
                `<span class="pack-odds">${MYSTERY_TABLE.map(e => `${e.chance} % ${describeBoosters(e.contents)}`).join(' · ')}</span>`);
        }
        $('shop-packs').appendChild(el);
    }
}

function renderDisplays() {
    const state = getShopState(userData, currentDay);
    $('shop-displays').innerHTML = '';
    for (const [type, d] of Object.entries(SHOP_DISPLAYS)) {
        if (!isBoosterProduced(d.boosterType, currentDay)) continue; // série terminée : plus en vente
        const soldOut = state.displays[type] >= d.dailyLimit;
        const el = document.createElement('div');
        el.className = `booster-item display-item ${d.boosterType} ${soldOut ? 'sold' : ''}`;
        el.innerHTML = `
            <div class="display-visual ${d.boosterType}">
                <img src="assets/booster/booster.png" alt=""><img src="assets/booster/booster.png" alt=""><img src="assets/booster/booster.png" alt="">
            </div>
            <div class="booster-item-info">
                <strong>${d.name}</strong>
                <span>${d.boosters} boosters <b class="bonus">+${d.bonus} offerts</b></span>
                <span class="booster-stock">-${displaySaving(type)} % par booster · 1 par jour</span>
            </div>
            ${priceButton(d.price, { disabled: soldOut || (userData.coins || 0) < d.price, label: soldOut ? 'Épuisé' : null })}
        `;
        if (!soldOut) el.querySelector('.price-button').onclick = () => onBuyDisplay(type);
        $('shop-displays').appendChild(el);
    }
}

function renderCards() {
    const state = getShopState(userData, currentDay);
    const coins = userData.coins || 0;
    $('shop-cards').innerHTML = '';
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
            ${priceButton(price, { disabled: bought || coins < price, label: bought ? 'Achetée ✓' : null })}
        `;
        if (!bought) item.querySelector('.price-button').onclick = () => onBuyCard(offer);
        $('shop-cards').appendChild(item);
    }
}

function renderBoosters() {
    const state = getShopState(userData, currentDay);
    const deal = getDailyDeal(currentDay);
    $('shop-boosters').innerHTML = '';
    for (const [type, def] of Object.entries(SHOP_BOOSTERS)) {
        if (!isBoosterProduced(type, currentDay)) continue; // série terminée : plus en vente
        const boughtToday = state.boosters[type];
        const soldOut = boughtToday >= def.dailyLimit;
        const price = boosterPriceToday(type, currentDay);
        const item = document.createElement('div');
        item.className = `booster-item ${type} ${soldOut ? 'sold' : ''}`;
        item.innerHTML = `
            <img src="assets/booster/booster.png" alt="${def.name}">
            <div class="booster-item-info">
                <strong>${def.name}${deal.type === type ? ' <span class="deal-mini">-30 %</span>' : ''}</strong>
                <span>${def.description}</span>
                <span class="booster-stock">${boughtToday}/${def.dailyLimit} achetés aujourd'hui</span>
            </div>
            ${priceButton(price, { oldPrice: deal.type === type ? def.price : null, disabled: soldOut || (userData.coins || 0) < price, label: soldOut ? 'Épuisé' : null })}
        `;
        if (!soldOut) item.querySelector('.price-button').onclick = () => onBuyBooster(type);
        $('shop-boosters').appendChild(item);
    }
}

function renderAnnouncements() {
    const news = seriesAnnouncements(currentDay);
    $('series-banner').hidden = news.length === 0;
    $('series-banner').innerHTML = news.map(n => `<span class="series-news ${n.kind}">${n.text}</span>`).join('');
}

function render() {
    renderAnnouncements();
    renderGift();
    renderDeal();
    renderPacks();
    renderDisplays();
    renderCards();
    renderBoosters();
}

function renderOdds() {
    $('odds-panel').innerHTML = `
        <p>Chaque emplacement tire une rareté au hasard :</p>
        <ul>${SHOP_RARITY_ODDS.map(o => `<li><span class="rarity-chip ${rarityClass(o.rarity)}">${o.label}</span><strong>${o.chance}%</strong></li>`).join('')}</ul>
        <p>Maximum une légendaire par jour. La boutique change tous les jours à minuit.</p>
    `;
}

function tick() {
    $('shop-countdown').textContent = formatDuration(msUntilNextDay());
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

// ---------- Actions ----------

/** Confirmation + achat + rafraîchissement, avec verrou anti double-clic */
async function purchase({ title, message, action, success }) {
    if (busy) return;
    const ok = await showConfirmDialog({ title, message, confirmText: 'Acheter', cancelText: 'Annuler' });
    if (!ok) return;
    busy = true;
    try {
        const result = await action();
        showToast('success', success(result), 4500);
        await updateQuestProgress('shop_buy');
        return result;
    } catch (e) {
        showToast('error', e.message || "Achat impossible.");
    } finally {
        busy = false;
        await refreshUser();
    }
}

function onBuyCard(offer) {
    const { card, price } = offer;
    purchase({
        title: 'Acheter cette carte ?',
        message: `${card.name} (${RARITY_LABELS[card.rarity]}) pour ${price} pièces.`,
        action: async () => {
            await buyCard(userData.uid, offer);
            await updateUserStats(userData.uid, { bestPurchase: { cardId: card.id, price } });
            await updateQuestProgress('obtain_10_diff_cards_24h', 1, { cardId: card.id });
        },
        success: () => `${card.name} ajoutée à ta collection !`
    });
}

function onBuyBooster(type) {
    const def = SHOP_BOOSTERS[type];
    const price = boosterPriceToday(type, currentDay);
    purchase({
        title: 'Acheter un booster ?',
        message: `${def.name} pour ${price} pièces. Il ira dans ton inventaire (page Booster).`,
        action: () => buyBooster(userData.uid, type),
        success: () => `${def.name} ajouté à ton inventaire !`
    });
}

function onBuyDisplay(type) {
    const d = SHOP_DISPLAYS[type];
    purchase({
        title: `Acheter la ${d.name} ?`,
        message: `${d.boosters + d.bonus} boosters (dont ${d.bonus} offerts) pour ${d.price} pièces. Ouvre-la quand tu veux depuis ton inventaire.`,
        action: () => buyDisplay(userData.uid, type),
        success: () => `${d.name} rangée dans ton inventaire (page Booster) !`
    });
}

function onBuyPack(id) {
    const pack = SHOP_PACKS[id];
    purchase({
        title: `Acheter le ${pack.name} ?`,
        message: `${pack.description} pour ${pack.price} pièces.`,
        action: () => buyPack(userData.uid, id),
        success: (r) => `${r.label ? (r.label === 'JACKPOT' ? '💥 JACKPOT ! ' : `${r.label} ! `) : ''}Tu reçois : ${describeBoosters(r.contents)}${r.coins ? ` + ${r.coins} pièces` : ''}. Tout est dans ton inventaire !`
    });
}

async function onClaimGift() {
    if (busy) return;
    busy = true;
    $('gift-button').disabled = true;
    try {
        const status = await claimGift(userData.uid);
        const boosters = describeBoosters(status.reward.boosters);
        const extra = boosters ? ` + ${boosters}` : '';
        showToast('success', `Jour ${status.day} : +${status.reward.coins} pièces${extra} ! Reviens demain.`);
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

    $('gift-button').addEventListener('click', onClaimGift);
    $('odds-toggle').addEventListener('click', () => {
        const panel = $('odds-panel');
        panel.hidden = !panel.hidden;
        $('odds-toggle').setAttribute('aria-expanded', String(!panel.hidden));
    });

    renderOdds();
    render();
    tick();
    setInterval(tick, 1000);
}

initializeShop();
