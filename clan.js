// Fichier: clan.js — page des clans
// Sans clan : créer (avec emblème) ou rejoindre, classement des clans.
// Avec clan : membres (niveau, dons), demandes de cartes du jour, gestion par le chef.
import { doc, onSnapshot, collection, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { play } from './sfx.js';
import { callServer } from './api.js';
import { getDayKey } from './daily-utils.js';
import { ALL_CARDS, findCard } from './market-service.js';
import {
    CLAN_COST, MAX_MEMBERS, EMBLEMS, REQUEST_NEEDED, DONATION_REWARD, REQUEST_DURATION_MS,
    getMyClan, listClans, joinClan, leaveClan, kickMember, updateClanDescription, clanDetails,
    rankClans
} from './clan-service.js';

const root = document.getElementById('clan-root');
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isOnline = (t) => t?.toMillis && Date.now() - t.toMillis() < 5 * 60 * 1000;
const RARITY_LABEL = { 'Commune': 'Commune', 'Rare': 'Rare', 'epique': 'Épique', 'Légendaire': 'Légendaire' };
const rarityClass = (r) => `rarity-${String(r).replace(/é/g, 'e')}`;
let me = null, busy = false, requests = [], stopRequests = null, currentClanId = null, renderToken = 0;

async function act(fn, success) {
    if (busy) return;
    busy = true;
    try { const r = await fn(); if (success) showToast('success', typeof success === 'function' ? success(r) : success); }
    catch (e) { showToast('error', e.code === 'permission-denied' ? "Action refusée par la base de données." : e.message); }
    finally { busy = false; }
}

async function render() {
    const token = ++renderToken;
    const clan = await getMyClan(me);
    if (token !== renderToken) return;
    if (clan) return renderMyClan(clan, token);
    watchRequests(null);
    if (me.clanId) leaveClan(me.uid).catch(() => {}); // exclu du clan : on nettoie en silence
    return renderNoClan(token);
}

// ---------- Sans clan ----------
async function renderNoClan(token) {
    const ranked = await rankClans(await listClans());
    if (token !== renderToken) return;
    let emblem = EMBLEMS[0];
    root.innerHTML = `
        <section class="profile-block clan-create">
            <h3>Créer un clan <small>· ${CLAN_COST} 🪙</small></h3>
            <div class="emblem-picker">${EMBLEMS.map((e, i) => `<button class="emblem ${i ? '' : 'active'}" data-emblem="${e}">${e}</button>`).join('')}</div>
            <div class="clan-form">
                <input id="clan-name" maxlength="24" placeholder="Nom du clan (3 à 24 caractères)">
                <input id="clan-tag" maxlength="4" placeholder="Tag (ex : JWB)" class="clan-tag-input">
                <input id="clan-desc" maxlength="120" placeholder="Description (facultatif)">
                <button id="clan-create-btn" class="profile-btn primary">Créer le clan</button>
            </div>
        </section>
        <section class="profile-block">
            <h3>🏆 Classement des clans</h3>
            ${ranked.length ? `<div class="clan-list">${ranked.map((c, i) => `
                <div class="clan-row">
                    <span class="clan-rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1)}</span>
                    <span class="clan-emblem">${c.emblem || '🛡️'}</span>
                    <span class="clan-row-info"><strong>[${escapeHtml(c.tag)}] ${escapeHtml(c.name)}</strong><small>Niv. ${c.level} · ${c.xp} XP · ${c.members.length}/${MAX_MEMBERS} membres</small></span>
                    <button class="profile-btn small primary" data-join="${c.id}" ${c.members.length >= MAX_MEMBERS ? 'disabled' : ''}>${c.members.length >= MAX_MEMBERS ? 'Complet' : 'Rejoindre'}</button>
                </div>`).join('')}</div>` : '<p class="empty-msg">Aucun clan pour le moment : crée le premier !</p>'}
        </section>`;
    root.querySelectorAll('[data-emblem]').forEach(b => {
        b.onclick = () => { emblem = b.dataset.emblem; root.querySelectorAll('.emblem').forEach(x => x.classList.toggle('active', x === b)); };
    });
    document.getElementById('clan-tag').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    document.getElementById('clan-create-btn').onclick = () => act(() => callServer('createClan', { input: {
        name: document.getElementById('clan-name').value,
        tag: document.getElementById('clan-tag').value,
        description: document.getElementById('clan-desc').value,
        emblem
    } }), 'Clan créé ! Bienvenue chef 👑');
    root.querySelectorAll('[data-join]').forEach(b => { b.onclick = () => act(() => joinClan(me.uid, b.dataset.join), 'Tu as rejoint le clan !'); });
}

// ---------- Avec clan ----------
async function renderMyClan(clan, token) {
    const [d, ranked] = await Promise.all([clanDetails(clan), rankClans(await listClans())]);
    if (token !== renderToken) return;
    watchRequests(clan.id);
    const chief = clan.ownerId === me.uid;
    const rank = ranked.findIndex(c => c.id === clan.id) + 1;
    const requestedToday = me.lastClanRequestDay === getDayKey();
    root.innerHTML = `
        <section class="profile-block clan-head">
            <div class="clan-banner">
                <span class="clan-emblem big">${clan.emblem || '🛡️'}</span>
                <div><h3><span class="clan-tag">[${escapeHtml(clan.tag)}]</span> ${escapeHtml(clan.name)}</h3><p>${escapeHtml(clan.description || 'Pas de description')}</p></div>
            </div>
            <div class="stats-grid compact">
                <div class="stat-item"><span class="stat-value">${d.level}</span><span class="stat-label">Niveau du clan</span></div>
                <div class="stat-item"><span class="stat-value">${rank ? '#' + rank : '—'}</span><span class="stat-label">Classement</span></div>
                <div class="stat-item"><span class="stat-value">${clan.members.length}/${MAX_MEMBERS}</span><span class="stat-label">Membres</span></div>
                <div class="stat-item"><span class="stat-value">${d.members.filter(m => isOnline(m.lastOnline)).length}</span><span class="stat-label">En ligne</span></div>
            </div>
            <p class="hint">💬 Le chat du clan est dans la bulle de chat, onglet « Clan ».</p>
        </section>

        <section class="profile-block">
            <div class="section-head"><h3>📨 Demandes de cartes</h3>
                <button id="request-btn" class="profile-btn small primary" ${requestedToday ? 'disabled' : ''}>${requestedToday ? 'Demande du jour faite ✓' : 'Demander une carte'}</button></div>
            <p class="hint">1 demande par jour. Donne tes doubles aux autres : +${DONATION_REWARD.Commune} à +${DONATION_REWARD.epique} 🪙 et de l'XP par carte donnée.</p>
            <div id="request-list" class="request-list"></div>
        </section>

        <section class="profile-block">
            <h3>Membres</h3>
            <div class="clan-list">${d.members.map(m => `
                <div class="clan-row">
                    <span class="friend-status ${isOnline(m.lastOnline) ? 'online' : ''}"></span>
                    <span class="clan-row-info"><strong>${m.owner ? '👑 ' : ''}${escapeHtml(m.pseudo)}${m.uid === me.uid ? ' (toi)' : ''}</strong><small>Niveau ${m.level} · 🎁 ${m.donations} don${m.donations > 1 ? 's' : ''}</small></span>
                    ${chief && !m.owner ? `<button class="profile-btn small ghost" data-kick="${m.uid}" data-name="${escapeHtml(m.pseudo)}">Exclure</button>` : ''}
                </div>`).join('')}</div>
            ${chief ? `<div class="clan-form chief-tools"><input id="clan-desc" maxlength="120" value="${escapeHtml(clan.description || '')}" placeholder="Description"><button id="clan-desc-btn" class="profile-btn">Modifier</button></div>` : ''}
        </section>
        <button id="clan-leave-btn" class="button-secondary">Quitter le clan</button>`;

    renderRequests();
    document.getElementById('request-btn').onclick = () => openCardPicker(clan.id);
    document.getElementById('clan-desc-btn')?.addEventListener('click', () => act(() => updateClanDescription(me.uid, clan.id, document.getElementById('clan-desc').value), 'Description modifiée.'));
    root.querySelectorAll('[data-kick]').forEach(b => {
        b.onclick = async () => {
            if (await showConfirmDialog({ title: `Exclure ${b.dataset.name} ?`, message: 'Il ne fera plus partie du clan.', confirmText: 'Exclure', cancelText: 'Annuler' })) {
                act(() => kickMember(me.uid, clan.id, b.dataset.kick), `${b.dataset.name} a été exclu.`);
            }
        };
    });
    document.getElementById('clan-leave-btn').onclick = async () => {
        const last = clan.members.length === 1;
        const ok = await showConfirmDialog({
            title: 'Quitter le clan ?',
            message: last ? 'Tu es le dernier membre : le clan sera supprimé.' : chief ? 'Le membre le plus ancien deviendra chef.' : 'Tu pourras en rejoindre un autre.',
            confirmText: 'Quitter', cancelText: 'Rester'
        });
        if (ok) act(() => leaveClan(me.uid), 'Tu as quitté le clan.');
    };
}

// ---------- Demandes de cartes (en direct) ----------
function watchRequests(clanId) {
    if (clanId === currentClanId) return;
    currentClanId = clanId;
    stopRequests?.();
    stopRequests = null;
    requests = [];
    if (!clanId) return;
    stopRequests = onSnapshot(query(collection(db, 'clans', clanId, 'requests'), orderBy('createdAt', 'desc'), limit(40)), (snap) => {
        const now = Date.now();
        requests = snap.docs.map(x => ({ id: x.id, ...x.data() })).filter(r => now - (r.createdAt?.toMillis?.() || now) < REQUEST_DURATION_MS);
        renderRequests();
    }, () => { /* hors ligne */ });
}

function renderRequests() {
    const box = document.getElementById('request-list');
    if (!box) return;
    if (!requests.length) { box.innerHTML = '<p class="empty-msg">Aucune demande en cours. Demande une carte qui te manque !</p>'; return; }
    box.innerHTML = requests.map(r => {
        const card = findCard(r.cardId);
        const mine = r.uid === me.uid;
        const have = me.collection?.[r.cardId]?.quantity || 0;
        const done = r.received >= r.needed;
        const reward = DONATION_REWARD[card?.rarity] || 5;
        const hoursLeft = Math.max(0, Math.ceil((REQUEST_DURATION_MS - (Date.now() - (r.createdAt?.toMillis?.() || Date.now()))) / 3600000));
        const action = mine ? `<span class="request-state">${done ? '✓ Complète' : `Plus que ${hoursLeft} h`}</span>`
            : done ? '<span class="request-state">✓ Complète</span>'
            : have >= 2 ? `<button class="profile-btn small primary" data-donate="${r.id}">Donner · +${reward} 🪙</button>`
            : `<span class="request-state muted">${have ? 'Tu n’as pas de double' : 'Tu ne l’as pas'}</span>`;
        return `
            <div class="request-row ${mine ? 'mine' : ''} ${done ? 'done' : ''}">
                <div class="card ${rarityClass(card?.rarity)} request-card"><img loading="lazy" src="${card?.image || ''}" alt=""></div>
                <div class="request-info">
                    <strong>${escapeHtml(card?.name || r.cardId)}</strong>
                    <small>${mine ? 'Ta demande' : escapeHtml(r.pseudo)} · ${RARITY_LABEL[card?.rarity] || ''}</small>
                    <div class="xp-bar"><div class="xp-bar-fill" style="width:${Math.round(r.received / r.needed * 100)}%"></div></div>
                    <small>${r.received} / ${r.needed} reçue${r.needed > 1 ? 's' : ''}</small>
                </div>
                ${action}
            </div>`;
    }).join('');
    box.querySelectorAll('[data-donate]').forEach(b => {
        b.onclick = () => act(async () => { const { coins } = await callServer('donateCard', { clanId: currentClanId, requestId: b.dataset.donate }); play('coins'); return coins; }, (n) => `Carte donnée ! +${n} pièces 🎁`);
    });
}

/** Choisir la carte à demander : celles qui manquent d'abord, sans les légendaires */
function openCardPicker(clanId) {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    let filter = 'missing';
    const draw = () => {
        const cards = ALL_CARDS.filter(c => REQUEST_NEEDED[c.rarity] && !c.upcoming)
            .filter(c => filter === 'all' || !(me.collection?.[c.id]?.quantity > 0));
        overlay.innerHTML = `
            <div class="settings-sheet picker-sheet" role="dialog" aria-modal="true">
                <div class="settings-head"><h3>Demander une carte</h3><button class="settings-close" aria-label="Fermer">&times;</button></div>
                <div class="filter-chips"><button class="chip ${filter === 'missing' ? 'active' : ''}" data-f="missing">Manquantes</button><button class="chip ${filter === 'all' ? 'active' : ''}" data-f="all">Toutes</button></div>
                <p class="hint">Communes : 4 exemplaires · Rares : 2 · Épiques : 1. Les légendaires ne se demandent pas.</p>
                <div class="picker-grid">${cards.length ? cards.map(c => `
                    <button class="picker-card" data-card="${c.id}">
                        <div class="card ${rarityClass(c.rarity)}"><img loading="lazy" src="${c.image}" alt=""></div>
                        <span>${escapeHtml(c.name)}</span><small>${RARITY_LABEL[c.rarity]} · x${REQUEST_NEEDED[c.rarity]}</small>
                    </button>`).join('') : '<p class="empty-msg">Tu as déjà toutes ces cartes : regarde « Toutes ».</p>'}</div>
            </div>`;
        overlay.querySelector('.settings-close').onclick = () => overlay.remove();
        overlay.querySelectorAll('[data-f]').forEach(b => { b.onclick = () => { filter = b.dataset.f; draw(); }; });
        overlay.querySelectorAll('[data-card]').forEach(b => {
            b.onclick = () => { overlay.remove(); act(() => callServer('createCardRequest', { clanId, cardId: b.dataset.card }), 'Demande envoyée au clan ! 📨'); };
        });
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    draw();
    document.body.appendChild(overlay);
}

async function init() {
    const user = await protectPage();
    if (!user) return;
    me = user;
    // Compte et clan en direct : la page se met à jour quand quelqu'un rejoint, part, donne…
    let unsubClan = null, lastClanId;
    onSnapshot(doc(db, 'users', me.uid), (snap) => {
        me = { uid: me.uid, ...snap.data() };
        if (me.clanId !== lastClanId) {
            lastClanId = me.clanId;
            unsubClan?.();
            unsubClan = me.clanId ? onSnapshot(doc(db, 'clans', me.clanId), () => render()) : null;
        }
        render();
    });
}
init();
