// Fichier: sfx.js — bruitages du jeu, fabriqués en direct avec le moteur audio du navigateur
// (aucun fichier son à télécharger : l'appli reste légère et marche hors connexion),
// et réglages de l'appareil (sons, volume, vibrations, animation d'ouverture).

const SETTINGS_KEY = 'tcg-settings';
export const DEFAULT_SETTINGS = { sound: true, volume: 0.7, vibration: true, splash: true };

/** Réglages de cet appareil (enregistrés dans le téléphone, pas dans le compte) */
export function getSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULT_SETTINGS }; }
}
export function setSetting(key, value) {
    const s = { ...getSettings(), [key]: value };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
    if (master) master.gain.value = s.volume;
    return s;
}

// ---------- Moteur audio ----------
let ctx = null, master = null;
function audio() {
    if (!ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.connect(ctx.destination);
    }
    master.gain.value = getSettings().volume;
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

/** Note : fréquence, départ (s), durée, forme d'onde, volume, glissement de fréquence */
function tone(freq, { t = 0, dur = 0.15, type = 'sine', vol = 0.3, slide = 0, attack = 0.005 } = {}) {
    const start = ctx.currentTime + t;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
}

/** Bruit filtré (déchirure, souffle, scintillement) */
function noise({ t = 0, dur = 0.2, vol = 0.3, freq = 1500, to = freq, q = 1, type = 'bandpass' } = {}) {
    const start = ctx.currentTime + t;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buffer;
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + dur);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(start);
}

const notes = (freqs, opts, step = 0.08) => freqs.forEach((f, i) => tone(f, { ...opts, t: (opts.t || 0) + i * step }));

const SOUNDS = {
    tap: () => tone(700, { dur: 0.05, type: 'triangle', vol: 0.1 }),
    // Booster qui se déchire
    open: () => { noise({ dur: 0.45, vol: 0.35, freq: 700, to: 5000, q: 0.8 }); tone(160, { dur: 0.3, type: 'sawtooth', vol: 0.06, slide: -70 }); },
    // Suspense avant une épique / légendaire
    charge: () => { tone(200, { dur: 1.0, type: 'sine', vol: 0.12, slide: 500, attack: 0.3 }); noise({ dur: 1.0, vol: 0.05, freq: 400, to: 4000 }); },
    // Carte retournée
    flip: () => noise({ dur: 0.12, vol: 0.22, freq: 3200, to: 1400, q: 0.7 }),
    // Révélation selon la rareté
    common: () => tone(880, { dur: 0.2, type: 'triangle', vol: 0.16 }),
    rare: () => notes([988, 1319], { dur: 0.3, type: 'triangle', vol: 0.16 }),
    epic: () => { notes([659, 831, 988, 1319], { dur: 0.4, type: 'triangle', vol: 0.15 }, 0.07); noise({ t: 0.25, dur: 0.5, vol: 0.05, freq: 5000, type: 'highpass' }); },
    legendary: () => {
        tone(98, { dur: 0.8, type: 'sine', vol: 0.3, slide: -30 });
        notes([523, 659, 784, 1047, 1319, 1568], { dur: 1.0, type: 'triangle', vol: 0.13 }, 0.06);
        notes([1047, 1319, 1568], { t: 0.45, dur: 1.6, type: 'sine', vol: 0.09 }, 0);
        noise({ t: 0.35, dur: 1.4, vol: 0.07, freq: 6000, type: 'highpass' });
    },
    newcard: () => notes([1760, 2349], { dur: 0.15, type: 'sine', vol: 0.08 }, 0.06),
    coins: () => notes([1568, 2093, 2637], { dur: 0.18, type: 'square', vol: 0.045 }, 0.06),
    success: () => notes([784, 1047], { dur: 0.22, type: 'triangle', vol: 0.15 }, 0.09),
    error: () => notes([233, 175], { dur: 0.2, type: 'square', vol: 0.07 }, 0.11)
};

/** Joue un bruitage ('tap', 'open', 'flip', 'common', 'rare', 'epic', 'legendary', 'coins'…) */
export function play(name) {
    if (!getSettings().sound || !SOUNDS[name]) return;
    try { if (audio()) SOUNDS[name](); } catch { /* audio indisponible : on joue sans son */ }
}

/** Vibration (si le téléphone le permet et si elle est activée dans les paramètres) */
export function vibrate(pattern) {
    if (!getSettings().vibration || typeof navigator === 'undefined' || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch { /* ignoré */ }
}

// Petit « clic » sur les boutons et les onglets
if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerdown', (e) => {
        const el = e.target.closest?.('button, .nav-link, .dropdown-item, .profile-btn');
        if (el && !el.disabled && !el.closest('[data-silent]')) play('tap');
    }, { capture: true, passive: true });
}
