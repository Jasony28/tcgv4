// Fichier: chat.js — chat général du jeu (bulle en bas à droite, sur toutes les pages)
// Les messages vont dans la collection Firestore « chat ». Le niveau affiché à côté du pseudo est
// recalculé depuis le profil de l'auteur (on ne fait pas confiance à un niveau écrit dans le message).
import { collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { db } from './firebase-config.js';
import { playerLevel } from './player-level.js';
import { play } from './sfx.js';

const MAX_LEN = 200, COOLDOWN_MS = 3000, HISTORY = 40;
const SEEN_KEY = 'chat-seen';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let me = null, panel = null, bubble = null, stopFull = null, lastSent = 0, messages = [];
const levels = new Map(); // uid → niveau (lu une fois par auteur)

function lastSeen() { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } }
function markSeen(ms) { try { localStorage.setItem(SEEN_KEY, String(ms)); } catch { /* ignoré */ } }
const msOf = (m) => m.createdAt?.toMillis?.() || Date.now();

async function levelOf(uid) {
    if (!levels.has(uid)) {
        levels.set(uid, getDoc(doc(db, 'users', uid)).then(s => playerLevel(s.data()).level).catch(() => null));
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
        <div class="chat-head"><strong>💬 Chat général</strong><button class="chat-close" aria-label="Fermer">&times;</button></div>
        <div class="chat-list" aria-live="polite"><p class="chat-empty">Chargement…</p></div>
        <form class="chat-form">
            <input type="text" maxlength="${MAX_LEN}" placeholder="Écris un message…" autocomplete="off" aria-label="Message">
            <button type="submit" aria-label="Envoyer">➤</button>
        </form>`;
    document.body.appendChild(panel);

    bubble.onclick = () => (panel.hidden ? open() : close());
    panel.querySelector('.chat-close').onclick = close;
    panel.querySelector('.chat-form').onsubmit = send;
}

function open() {
    panel.hidden = false;
    bubble.classList.add('open');
    // Historique complet seulement quand le chat est ouvert (moins de lectures)
    stopFull = onSnapshot(query(collection(db, 'chat'), orderBy('createdAt', 'desc'), limit(HISTORY)), (snap) => {
        messages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
        render();
        if (messages.length) markSeen(msOf(messages[messages.length - 1]));
        setUnread(false);
    }, () => { panel.querySelector('.chat-list').innerHTML = '<p class="chat-empty">Chat indisponible pour le moment.</p>'; });
    setTimeout(() => panel.querySelector('input').focus(), 50);
}

function close() {
    panel.hidden = true;
    bubble.classList.remove('open');
    stopFull?.();
    stopFull = null;
}

function setUnread(on) { bubble.querySelector('.chat-unread').hidden = !on; }

async function render() {
    const list = panel.querySelector('.chat-list');
    if (!messages.length) { list.innerHTML = '<p class="chat-empty">Aucun message. Dis bonjour ! 👋</p>'; return; }
    const lv = await Promise.all(messages.map(m => levelOf(m.uid)));
    const time = (m) => new Date(msOf(m)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    list.innerHTML = messages.map((m, i) => `
        <div class="chat-msg ${m.uid === me?.uid ? 'mine' : ''}">
            <div class="chat-meta"><strong>${escapeHtml(m.pseudo)}</strong>${lv[i] ? `<span class="chat-level">Nv ${lv[i]}</span>` : ''}<time>${time(m)}</time></div>
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
        await addDoc(collection(db, 'chat'), { uid: me.uid, pseudo: snap.data()?.pseudo || 'Joueur', text, createdAt: serverTimestamp() });
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
