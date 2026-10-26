// Fichier: chat.js — chat du jeu (bulle en bas à droite, sur toutes les pages) : onglets Général et Clan
// Les messages vont dans la collection Firestore « chat ». Le niveau affiché à côté du pseudo est
// recalculé depuis le profil de l'auteur (on ne fait pas confiance à un niveau écrit dans le message).
import { collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { db } from './firebase-config.js';
import { playerLevel } from './player-level.js';
import { getMyClan } from './clan-service.js';
import { play } from './sfx.js';

const MAX_LEN = 200, COOLDOWN_MS = 3000, HISTORY = 40;
const SEEN_KEY = 'chat-seen';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let me = null, panel = null, bubble = null, stopFull = null, lastSent = 0, messages = [];
let channel = 'general', myClan = null;
const levels = new Map(); // uid → { level, tag } (lu une fois par auteur)
const clanTags = new Map(); // clanId → tag

/** Messages du salon affiché : chat général, ou chat réservé au clan */
const channelRef = () => channel === 'clan' && myClan ? collection(db, 'clans', myClan.id, 'messages') : collection(db, 'chat');

function lastSeen() { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } }
function markSeen(ms) { try { localStorage.setItem(SEEN_KEY, String(ms)); } catch { /* ignoré */ } }
const msOf = (m) => m.createdAt?.toMillis?.() || Date.now();

/** Niveau et tag de clan de l'auteur (le tag n'apparaît que s'il est vraiment membre) */
async function authorOf(uid) {
    if (!levels.has(uid)) {
        levels.set(uid, getDoc(doc(db, 'users', uid)).then(async (s) => {
            const u = s.data() || {};
            let tag = null;
            if (u.clanId) {
                if (!clanTags.has(u.clanId)) clanTags.set(u.clanId, getDoc(doc(db, 'clans', u.clanId)).then(c => c.exists() ? c.data() : null).catch(() => null));
                const clan = await clanTags.get(u.clanId);
                if (clan?.members?.includes(uid)) tag = clan.tag;
            }
            return { level: playerLevel(u).level, tag };
        }).catch(() => ({ level: null, tag: null })));
    }
    return levels.get(uid);
}

function buildUi() {
    bubble = document.createElement('button');
    bubble.className = 'chat-bubble';
    bubble.setAttribute('aria-label', 'Ouvrir le chat');
    bubble.innerHTML = '💬<span class="chat-unread" hidden></span>';
    document.body.appendChild(bubble);

    panel = document.createElement('section');
    panel.className = 'chat-panel';
    panel.hidden = true;
    panel.innerHTML = `
        <div class="chat-head">
            <div class="chat-tabs"><button class="chat-tab active" data-channel="general">💬 Général</button><button class="chat-tab" data-channel="clan">🛡️ Clan</button></div>
            <button class="chat-close" aria-label="Fermer">&times;</button>
        </div>
        <div class="chat-list" aria-live="polite"><p class="chat-empty">Chargement…</p></div>
        <form class="chat-form">
            <input type="text" maxlength="${MAX_LEN}" placeholder="Écris un message…" autocomplete="off" aria-label="Message">
            <button type="submit" aria-label="Envoyer">➤</button>
        </form>`;
    document.body.appendChild(panel);

    bubble.onclick = () => (panel.hidden ? open() : close());
    panel.querySelector('.chat-close').onclick = close;
    panel.querySelectorAll('.chat-tab').forEach(t => { t.onclick = () => switchChannel(t.dataset.channel); });
    panel.querySelector('.chat-form').onsubmit = send;
    const input = panel.querySelector('input');
    input.addEventListener('focus', () => setTimeout(fitToKeyboard, 250));
    input.addEventListener('blur', () => setTimeout(fitToKeyboard, 250));
    window.visualViewport?.addEventListener('resize', fitToKeyboard);
    window.visualViewport?.addEventListener('scroll', fitToKeyboard);
}

/**
 * Clavier du téléphone ouvert : le chat se place juste au-dessus et prend la hauteur visible
 * (visualViewport = la partie de l'écran que le clavier ne cache pas).
 */
function fitToKeyboard() {
    const vv = window.visualViewport;
    if (!panel || panel.hidden || !vv) return;
    const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const typing = keyboard > 80 || document.activeElement === panel.querySelector('input') && vv.height < window.screen.height * 0.7;
    panel.classList.toggle('keyboard', typing);
    if (typing) {
        panel.style.bottom = `${keyboard + 8}px`;
        panel.style.height = `${Math.min(480, vv.height - 16)}px`;
    } else {
        panel.style.bottom = '';
        panel.style.height = '';
    }
    const list = panel.querySelector('.chat-list');
    list.scrollTop = list.scrollHeight;
}

async function open() {
    panel.hidden = false;
    bubble.classList.add('open');
    myClan = await getMyClan({ uid: me.uid, ...(await getDoc(doc(db, 'users', me.uid))).data() }).catch(() => null);
    listen();
    setTimeout(() => panel.querySelector('input').focus(), 50);
}

function switchChannel(next) {
    channel = next;
    panel.querySelectorAll('.chat-tab').forEach(t => t.classList.toggle('active', t.dataset.channel === next));
    listen();
}

// Historique complet seulement quand le chat est ouvert (moins de lectures)
function listen() {
    stopFull?.();
    stopFull = null;
    const list = panel.querySelector('.chat-list');
    const form = panel.querySelector('.chat-form');
    if (channel === 'clan' && !myClan) {
        form.hidden = true;
        list.innerHTML = '<p class="chat-empty">Tu n\'es dans aucun clan.<br><a href="clan.html">🛡️ Créer ou rejoindre un clan</a></p>';
        return;
    }
    form.hidden = false;
    list.innerHTML = '<p class="chat-empty">Chargement…</p>';
    stopFull = onSnapshot(query(channelRef(), orderBy('createdAt', 'desc'), limit(HISTORY)), (snap) => {
        messages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
        render();
        if (channel === 'general') {
            if (messages.length) markSeen(msOf(messages[messages.length - 1]));
            setUnread(false);
        }
    }, () => { list.innerHTML = '<p class="chat-empty">Chat indisponible pour le moment.</p>'; });
}

function close() {
    panel.hidden = true;
    panel.classList.remove('keyboard');
    panel.style.bottom = panel.style.height = '';
    bubble.classList.remove('open');
    stopFull?.();
    stopFull = null;
}

function setUnread(on) { bubble.querySelector('.chat-unread').hidden = !on; }

async function render() {
    const list = panel.querySelector('.chat-list');
    if (!messages.length) { list.innerHTML = '<p class="chat-empty">Aucun message. Dis bonjour ! 👋</p>'; return; }
    const authors = await Promise.all(messages.map(m => authorOf(m.uid)));
    const time = (m) => new Date(msOf(m)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    list.innerHTML = messages.map((m, i) => `
        <div class="chat-msg ${m.uid === me?.uid ? 'mine' : ''}">
            <div class="chat-meta">${authors[i].tag && channel === 'general' ? `<span class="chat-clan">[${escapeHtml(authors[i].tag)}]</span>` : ''}<strong>${escapeHtml(m.pseudo)}</strong>${authors[i].level ? `<span class="chat-level">Nv ${authors[i].level}</span>` : ''}<time>${time(m)}</time></div>
            <p>${escapeHtml(m.text)}</p>
        </div>`).join('');
    list.scrollTop = list.scrollHeight;
}

async function send(e) {
    e.preventDefault();
    const input = panel.querySelector('input');
    const text = input.value.trim().slice(0, MAX_LEN);
    if (!text || !me) return;
    if (Date.now() - lastSent < COOLDOWN_MS) return; // anti-spam
    lastSent = Date.now();
    input.value = '';
    try {
        const snap = await getDoc(doc(db, 'users', me.uid));
        await addDoc(channelRef(), { uid: me.uid, pseudo: snap.data()?.pseudo || 'Joueur', text, createdAt: serverTimestamp() });
        levels.delete(me.uid);
        play('tap');
    } catch {
        input.value = text;
        play('error');
    }
}

function start(user) {
    me = user;
    buildUi();
    // Pastille « nouveau message » : on n'écoute que le dernier message tant que le chat est fermé
    onSnapshot(query(collection(db, 'chat'), orderBy('createdAt', 'desc'), limit(1)), (snap) => {
        const last = snap.docs[0]?.data();
        if (!last || !panel.hidden) return;
        if (last.uid !== me.uid && msOf(last) > lastSeen()) setUnread(true);
    }, () => { /* chat indisponible : pas de pastille */ });
}

if (typeof document !== 'undefined' && document.querySelector?.('.main-header')) {
    const unsub = onAuthStateChanged(getAuth(), (user) => { if (user && !me) { unsub?.(); start(user); } });
}
