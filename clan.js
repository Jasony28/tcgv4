// Fichier: clan.js — page des clans (sans clan : liste + création ; avec clan : membres, niveau, gestion)
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { protectPage } from './auth-manager.js';
import { showToast, showConfirmDialog } from './toast.js';
import { CLAN_COST, MAX_MEMBERS, getMyClan, listClans, createClan, joinClan, leaveClan, kickMember, updateClanDescription, clanDetails } from './clan-service.js';

const root = document.getElementById('clan-root');
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isOnline = (t) => t?.toMillis && Date.now() - t.toMillis() < 5 * 60 * 1000;
let me = null, busy = false;

async function act(fn, success) {
    if (busy) return;
    busy = true;
    try { await fn(); if (success) showToast('success', success); }
    catch (e) { showToast('error', e.code === 'permission-denied' ? "Action refusée par la base de données." : e.message); }
    finally { busy = false; }
}

async function render() {
    const clan = await getMyClan(me);
    if (clan) return renderMyClan(clan);
    if (me.clanId) { /* exclu du clan : on nettoie en silence */ leaveClan(me.uid).catch(() => {}); }
    return renderNoClan();
}

async function renderNoClan() {
    const clans = await listClans();
    root.innerHTML = `
        <section class="profile-block clan-create">
            <h3>Créer un clan <small>· ${CLAN_COST} 🪙</small></h3>
            <div class="clan-form">
                <input id="clan-name" maxlength="24" placeholder="Nom du clan (3 à 24 caractères)">
                <input id="clan-tag" maxlength="4" placeholder="Tag (ex : JWB)" class="clan-tag-input">
                <input id="clan-desc" maxlength="120" placeholder="Description (facultatif)">
                <button id="clan-create-btn" class="profile-btn primary">Créer le clan</button>
            </div>
        </section>
        <section class="profile-block">
            <h3>Rejoindre un clan</h3>
            ${clans.length ? `<div class="clan-list">${clans.map(c => `
                <div class="clan-row">
                    <span class="clan-tag">[${escapeHtml(c.tag)}]</span>
                    <span class="clan-row-info"><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(c.description || '')}</small></span>
                    <span class="clan-count">${c.members.length}/${MAX_MEMBERS}</span>
                    <button class="profile-btn small primary" data-join="${c.id}" ${c.members.length >= MAX_MEMBERS ? 'disabled' : ''}>Rejoindre</button>
                </div>`).join('')}</div>` : '<p class="empty-msg">Aucun clan pour le moment : crée le premier !</p>'}
        </section>`;
    document.getElementById('clan-tag').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    document.getElementById('clan-create-btn').onclick = () => act(async () => {
        await createClan(me.uid, {
            name: document.getElementById('clan-name').value,
            tag: document.getElementById('clan-tag').value,
            description: document.getElementById('clan-desc').value
        });
    }, 'Clan créé ! Bienvenue chef 👑');
    root.querySelectorAll('[data-join]').forEach(b => { b.onclick = () => act(() => joinClan(me.uid, b.dataset.join), 'Tu as rejoint le clan !'); });
}

async function renderMyClan(clan) {
    const d = await clanDetails(clan);
    const chief = clan.ownerId === me.uid;
    root.innerHTML = `
        <section class="profile-block clan-head">
            <div class="clan-banner">
                <span class="clan-tag big">[${escapeHtml(clan.tag)}]</span>
                <div><h3>${escapeHtml(clan.name)}</h3><p>${escapeHtml(clan.description || 'Pas de description')}</p></div>
            </div>
            <div class="stats-grid compact">
                <div class="stat-item"><span class="stat-value">${d.level}</span><span class="stat-label">Niveau du clan</span></div>
                <div class="stat-item"><span class="stat-value">${d.xp}</span><span class="stat-label">XP totale</span></div>
                <div class="stat-item"><span class="stat-value">${clan.members.length}/${MAX_MEMBERS}</span><span class="stat-label">Membres</span></div>
                <div class="stat-item"><span class="stat-value">${d.members.filter(m => isOnline(m.lastOnline)).length}</span><span class="stat-label">En ligne</span></div>
            </div>
            <p class="hint">💬 Le chat du clan est dans la bulle de chat, onglet « Clan ».</p>
            ${chief ? `<div class="clan-form"><input id="clan-desc" maxlength="120" value="${escapeHtml(clan.description || '')}" placeholder="Description"><button id="clan-desc-btn" class="profile-btn">Modifier</button></div>` : ''}
        </section>
        <section class="profile-block">
            <h3>Membres</h3>
            <div class="clan-list">${d.members.map(m => `
                <div class="clan-row">
                    <span class="friend-status ${isOnline(m.lastOnline) ? 'online' : ''}"></span>
                    <span class="clan-row-info"><strong>${m.owner ? '👑 ' : ''}${escapeHtml(m.pseudo)}${m.uid === me.uid ? ' (toi)' : ''}</strong><small>Niveau ${m.level} · ${m.xp} XP</small></span>
                    ${chief && !m.owner ? `<button class="profile-btn small ghost" data-kick="${m.uid}" data-name="${escapeHtml(m.pseudo)}">Exclure</button>` : ''}
                </div>`).join('')}</div>
        </section>
        <button id="clan-leave-btn" class="button-secondary">Quitter le clan</button>`;
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

async function init() {
    const user = await protectPage();
    if (!user) return;
    me = user;
    // Compte et clan en direct : la page se met à jour quand quelqu'un rejoint, part, etc.
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
