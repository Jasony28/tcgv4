// Carte "illustration alternative" : art pleine carte, panneau en verre dépoli, effets holo.
// Usage : node make-card-alt.mjs card.json sortie.png
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'C:/Windows/Fonts/';
GlobalFonts.registerFromPath(F + 'seguibl.ttf', 'Black');
GlobalFonts.registerFromPath(F + 'seguibli.ttf', 'BlackItalic');
GlobalFonts.registerFromPath(F + 'segoeuib.ttf', 'Bold');
GlobalFonts.registerFromPath(F + 'seguisb.ttf', 'Semi');
GlobalFonts.registerFromPath(F + 'seguisbi.ttf', 'SemiItalic');
GlobalFonts.registerFromPath(F + 'segoeui.ttf', 'Text');

const card = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const W = 931, H = 1300, B = 16; // B = épaisseur du cadre
const c = createCanvas(W, H), g = c.getContext('2d');

// --- Thèmes ---
const TYPES = {
    foudre:   { a: '#fff6a0', b: '#f2b705', ink: '#3a2a00', glow: '#ffd84a', glyph: 'bolt' },
    feu:      { a: '#ffc49a', b: '#e8492a', ink: '#fff', glow: '#ff7a3d', glyph: 'flame' },
    eau:      { a: '#bfe6ff', b: '#2a8de0', ink: '#fff', glow: '#5cc3ff', glyph: 'drop' },
    plante:   { a: '#c8f5a8', b: '#3aa83a', ink: '#fff', glow: '#7be36b', glyph: 'leaf' },
    psy:      { a: '#f0c4ff', b: '#9b45c9', ink: '#fff', glow: '#d27cff', glyph: 'eye' },
    combat:   { a: '#f2c79a', b: '#b8612d', ink: '#fff', glow: '#ff9a52', glyph: 'fist' },
    tenebres: { a: '#9aa6b5', b: '#2b3644', ink: '#fff', glow: '#8aa0ff', glyph: 'moon' },
    incolore: { a: '#ffffff', b: '#c9ced4', ink: '#5a5f66', glow: '#ffffff', glyph: 'star' },
    acier:    { a: '#e3e8ee', b: '#6b7886', ink: '#1f2933', glow: '#cfe3ff', glyph: 'gear' },
    plasma:   { a: '#ffc2f7', b: '#c026d3', ink: '#fff', glow: '#ff5cf0', glyph: 'orbit' },
    vent:     { a: '#d9fff4', b: '#2fae8c', ink: '#fff', glow: '#7dffe0', glyph: 'swirl' },
    cristal:  { a: '#e6f9ff', b: '#3fa7d6', ink: '#fff', glow: '#a8ecff', glyph: 'diamond' },
    roche:    { a: '#ecd9b5', b: '#8a6a3d', ink: '#fff', glow: '#e0b070', glyph: 'rock' },
    abysses:  { a: '#86d8ee', b: '#123a6b', ink: '#fff', glow: '#3ad0ff', glyph: 'wave' },
    dragon:   { a: '#f2d27a', b: '#5a3fa0', ink: '#fff', glow: '#b08cff', glyph: 'fang' },
    glace:    { a: '#f0fdff', b: '#6fbfe3', ink: '#fff', glow: '#c9f4ff', glyph: 'snow' },
    lumiere:  { a: '#fffbe0', b: '#eab308', ink: '#5a3d00', glow: '#fff2a0', glyph: 'sun' }
};
const ALIASES = { electrique: 'foudre', ombre: 'tenebres', normal: 'incolore' };
export const typeKey = (t) => { const k = String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); return ALIASES[k] || k; };
const FRAMES = { // couleur du cadre selon la rareté
    'Commune':    ['#f2f4f6', '#9ea6ae', '#e9edf0', '#7d858d', '#d9dde1'],
    'Rare':       ['#e6f3ff', '#6f9ccc', '#dceeff', '#4c77a8', '#cfe6ff'],
    'epique':     ['#f6e6ff', '#9d6cc9', '#f0dcff', '#6f3f9c', '#e6ccff'],
    'Légendaire': ['#fff5cc', '#c99a2e', '#ffeaa0', '#8f6512', '#f7d978']
};
const T = TYPES[typeKey(card.type)] || TYPES.incolore;
const FR = FRAMES[card.rarity] || FRAMES['Légendaire'];

// Hasard déterministe (même carte = même rendu)
let seed = [...card.name].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// --- Outils ---
function rr(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function metal(x0, y0, x1, y1, stops = FR) {
    const s = g.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((col, i) => s.addColorStop(i / (stops.length - 1), col));
    return s;
}
function glyph(kind, x, y, r, ink) {
    g.save(); g.translate(x, y); g.fillStyle = ink; g.strokeStyle = ink; g.beginPath();
    const poly = (p) => { p.forEach(([a, b], i) => i ? g.lineTo(a * r, b * r) : g.moveTo(a * r, b * r)); g.closePath(); g.fill(); };
    if (kind === 'bolt') poly([[0.18, -0.78], [-0.46, 0.08], [-0.04, 0.08], [-0.2, 0.78], [0.46, -0.14], [0.04, -0.14], [0.24, -0.78]]);
    else if (kind === 'star') { for (let i = 0; i < 10; i++) { const q = i % 2 ? r * 0.3 : r * 0.7, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); } g.fill(); }
    else if (kind === 'moon') { g.arc(0, 0, r * 0.6, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(r * 0.28, -r * 0.2, r * 0.5, 0, 7); g.fill(); }
    else if (kind === 'drop') { g.moveTo(0, -r * 0.72); g.bezierCurveTo(r * 0.6, 0, r * 0.55, r * 0.66, 0, r * 0.66); g.bezierCurveTo(-r * 0.55, r * 0.66, -r * 0.6, 0, 0, -r * 0.72); g.fill(); }
    else if (kind === 'flame') { g.moveTo(0, -r * 0.76); g.bezierCurveTo(r * 0.72, -r * 0.1, r * 0.56, r * 0.7, 0, r * 0.7); g.bezierCurveTo(-r * 0.56, r * 0.7, -r * 0.62, 0, -r * 0.1, -r * 0.26); g.bezierCurveTo(-r * 0.04, -r * 0.04, r * 0.06, -r * 0.42, 0, -r * 0.76); g.fill(); }
    else if (kind === 'leaf') { g.moveTo(-r * 0.56, r * 0.56); g.bezierCurveTo(-r * 0.6, -r * 0.4, r * 0.2, -r * 0.7, r * 0.62, -r * 0.62); g.bezierCurveTo(r * 0.6, r * 0.1, r * 0.1, r * 0.6, -r * 0.56, r * 0.56); g.fill(); }
    else if (kind === 'eye') { g.ellipse(0, 0, r * 0.66, r * 0.4, 0, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, r * 0.2, 0, 7); g.fill(); }
    else if (kind === 'fist') { for (let i = 0; i < 16; i++) { const q = i % 2 ? r * 0.32 : r * 0.72, a = -Math.PI / 2 + i * Math.PI / 8; g.lineTo(Math.cos(a) * q, Math.sin(a) * q); } g.closePath(); g.fill(); }
    else if (kind === 'gear') { g.arc(0, 0, r * 0.42, 0, 7); g.fill(); for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4); g.fillRect(-r * 0.11, -r * 0.66, r * 0.22, r * 0.3); g.restore(); } g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, 0, r * 0.17, 0, 7); g.fill(); }
    else if (kind === 'orbit') { g.lineWidth = r * 0.12; g.save(); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, r * 0.68, r * 0.28, 0, 0, 7); g.stroke(); g.rotate(1); g.beginPath(); g.ellipse(0, 0, r * 0.68, r * 0.28, 0, 0, 7); g.stroke(); g.restore(); g.beginPath(); g.arc(0, 0, r * 0.18, 0, 7); g.fill(); }
    else if (kind === 'swirl') { g.lineWidth = r * 0.14; g.lineCap = 'round'; [[-0.3, 0.42], [0, 0.3], [0.28, 0.2]].forEach(([yy, k]) => { g.beginPath(); g.moveTo(-r * 0.62, yy * r); g.bezierCurveTo(-r * 0.1, yy * r - r * k, r * 0.4, yy * r + r * k, r * 0.62, yy * r - r * 0.1); g.stroke(); }); }
    else if (kind === 'diamond') poly([[0, -0.72], [0.5, -0.12], [0, 0.72], [-0.5, -0.12]]);
    else if (kind === 'rock') poly([[-0.6, 0.45], [-0.42, -0.2], [-0.1, -0.55], [0.35, -0.45], [0.62, 0.05], [0.45, 0.5]]);
    else if (kind === 'wave') { g.lineWidth = r * 0.14; g.lineCap = 'round'; [-0.25, 0.2].forEach(yy => { g.beginPath(); for (let i = 0; i <= 20; i++) { const xx = -0.62 + i * 0.062; const fy = yy + Math.sin(i / 20 * Math.PI * 2) * 0.16; i ? g.lineTo(xx * r, fy * r) : g.moveTo(xx * r, fy * r); } g.stroke(); }); }
    else if (kind === 'fang') poly([[-0.55, -0.6], [0.55, -0.6], [0.18, 0.72], [0, 0.1], [-0.18, 0.72]]);
    else if (kind === 'snow') { g.lineWidth = r * 0.13; g.lineCap = 'round'; for (let i = 0; i < 3; i++) { g.save(); g.rotate(i * Math.PI / 3); g.beginPath(); g.moveTo(0, -r * 0.68); g.lineTo(0, r * 0.68); g.stroke(); g.restore(); } }
    else if (kind === 'sun') { g.arc(0, 0, r * 0.34, 0, 7); g.fill(); for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4); g.fillRect(-r * 0.07, -r * 0.72, r * 0.14, r * 0.24); g.restore(); } }
    else if (kind === 'pin') { g.arc(0, -r * 0.25, r * 0.45, Math.PI, 0); g.lineTo(0, r * 0.75); g.closePath(); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(0, -r * 0.25, r * 0.18, 0, 7); g.fill(); }
    g.restore();
}
function energy(type, x, y, r, glow = false) {
    const t = TYPES[typeKey(type)] || TYPES.incolore;
    g.save();
    if (glow) { g.shadowColor = t.glow; g.shadowBlur = r * 0.9; }
    else { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 6; g.shadowOffsetY = 2; }
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = metal(x - r, y - r, x + r, y + r, ['#ffffff', '#c9ced4', '#ffffff']); g.fill();
    g.restore();
    const rg = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.05, x, y, r * 0.86);
    rg.addColorStop(0, t.a); rg.addColorStop(1, t.b);
    g.beginPath(); g.arc(x, y, r * 0.84, 0, 7); g.fillStyle = rg; g.fill();
    // reflet
    g.save(); g.beginPath(); g.arc(x, y, r * 0.84, 0, 7); g.clip();
    const sh = g.createLinearGradient(0, y - r, 0, y); sh.addColorStop(0, 'rgba(255,255,255,.55)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.beginPath(); g.ellipse(x, y - r * 0.45, r * 0.7, r * 0.45, 0, 0, 7); g.fill(); g.restore();
    glyph(t.glyph, x, y, r * 0.8, t.ink);
}
// Texte "titre" : dégradé + contour épais + halo
function title(text, x, y, size, opts = {}) {
    const { font = 'Black', align = 'left', fill = ['#ffffff', '#e9eef3', '#b9c2cc'], stroke = '#0a0e18', sw = size * 0.16, glow = T.glow } = opts;
    g.save(); g.font = `${size}px ${font}`; g.textAlign = align; g.lineJoin = 'round';
    const w = g.measureText(text).width, x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    if (glow) { g.shadowColor = glow; g.shadowBlur = size * 0.45; g.strokeStyle = glow; g.lineWidth = sw * 1.2; g.strokeText(text, x, y); }
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4; g.shadowOffsetY = 3;
    g.strokeStyle = stroke; g.lineWidth = sw; g.strokeText(text, x, y);
    g.shadowColor = 'transparent';
    const fg = g.createLinearGradient(0, y - size * 0.8, 0, y);
    fill.forEach((col, i) => fg.addColorStop(i / (fill.length - 1), col));
    g.fillStyle = fg; g.fillText(text, x, y);
    g.restore();
    return { w, x0 };
}
function text(t, x, y, size, opts = {}) {
    const { font = 'Text', color = '#fff', align = 'left', shadow = true } = opts;
    g.save(); g.font = `${size}px ${font}`; g.textAlign = align; g.fillStyle = color;
    if (shadow) { g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 6; g.shadowOffsetY = 1; }
    g.fillText(t, x, y); g.restore();
}
function wrap(t, x, y, maxW, lh, size, font = 'Text') {
    g.font = `${size}px ${font}`; const lines = []; let line = '';
    for (const w of t.split(' ')) { const tt = line ? line + ' ' + w : w; if (g.measureText(tt).width > maxW && line) { lines.push(line); line = w; } else line = tt; }
    if (line) lines.push(line);
    lines.forEach((l, i) => text(l, x, y + i * lh, size, { font }));
    return y + (lines.length - 1) * lh;
}
function divider(x0, x1, y) {
    const lg = g.createLinearGradient(x0, 0, x1, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.2, T.glow); lg.addColorStop(0.8, T.glow); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.globalAlpha = 0.75; g.fillStyle = lg; g.fillRect(x0, y, x1 - x0, 2); g.restore();
    g.save(); g.translate((x0 + x1) / 2, y + 1); g.rotate(Math.PI / 4); g.fillStyle = T.glow; g.shadowColor = T.glow; g.shadowBlur = 8; g.fillRect(-4, -4, 8, 8); g.restore();
}
function sparkle(x, y, s, alpha) {
    g.save(); g.globalAlpha = alpha; g.translate(x, y); g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = s * 2;
    g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(0, 0, s, 0); g.quadraticCurveTo(0, 0, 0, s); g.quadraticCurveTo(0, 0, -s, 0); g.quadraticCurveTo(0, 0, 0, -s); g.fill();
    g.restore();
}

// ===================== RENDU =====================
const art = await loadImage(card.art);
const LEG = card.rarity === 'Légendaire';
const FULL = LEG || card.rarity === 'epique';   // épique + légendaire = illustration pleine carte
const STARS = { 'Commune': 0, 'Rare': 1, 'epique': 2, 'Légendaire': 3 }[card.rarity] ?? 3;
if (!FULL) { await (await import('./window-layout.mjs')).renderWindow({ g, card, art, T, FR, W, H, B, rand, helpers: { rr, metal, glyph, energy, title, text, wrap, divider, sparkle, TYPES } }); finish(); }

async function renderFull() {
const ix = B, iy = B, iw = W - 2 * B, ih = H - 2 * B;
const sc = Math.max(iw / art.width, ih / art.height) * (card.zoom || 1);
const dw = art.width * sc, dh = art.height * sc;
const ax = ix + (iw - dw) / 2 + (card.offsetX || 0), ay = iy + (ih - dh) / 2 + (card.offsetY || 0);

// 1) Cadre métallique de rareté + texture brossée
g.save(); rr(0, 0, W, H, 36); g.clip();
g.fillStyle = metal(0, 0, W, H); g.fillRect(0, 0, W, H);
g.globalAlpha = 0.12;
for (let i = -H; i < W; i += 6) { g.strokeStyle = i % 12 ? '#000' : '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke(); }
g.restore();

// 2) Illustration plein cadre
g.save(); rr(ix, iy, iw, ih, 22); g.clip();
g.drawImage(art, ax, ay, dw, dh);

// 3) Effets holo : arc-en-ciel diagonal, gravure fine, éclat lumineux
g.globalCompositeOperation = 'overlay';
const rb = g.createLinearGradient(0, 0, W, H);
['#ff3cac', '#784ba0', '#2b86c5', '#3cffd0', '#fff95b', '#ff3cac'].forEach((col, i, a) => rb.addColorStop(i / (a.length - 1), col));
g.globalAlpha = LEG ? 0.18 : 0.09; g.fillStyle = rb; g.fillRect(ix, iy, iw, ih);
g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.05; g.strokeStyle = '#fff'; g.lineWidth = 1;
for (let i = -H; i < W; i += 5) { g.beginPath(); g.moveTo(i, iy); g.lineTo(i + H * 0.6, H); g.stroke(); }
g.globalAlpha = 1;
const sweep = g.createLinearGradient(W * 0.1, 0, W * 0.9, H);
sweep.addColorStop(0.35, 'rgba(255,255,255,0)'); sweep.addColorStop(0.47, 'rgba(255,255,255,.16)'); sweep.addColorStop(0.5, 'rgba(255,255,255,.26)');
sweep.addColorStop(0.53, 'rgba(255,255,255,.16)'); sweep.addColorStop(0.65, 'rgba(255,255,255,0)');
g.fillStyle = sweep; g.fillRect(ix, iy, iw, ih);
g.globalCompositeOperation = 'source-over';
// paillettes
for (let i = 0; i < (LEG ? 160 : 0); i++) { const s = 1.5 + rand() ** 3 * 9; sparkle(ix + rand() * iw, iy + rand() * ih, s, 0.25 + rand() * 0.6); }

// 4) Voile haut (lisibilité du nom) et vignette
let v = g.createLinearGradient(0, iy, 0, iy + 230); v.addColorStop(0, 'rgba(4,8,20,.72)'); v.addColorStop(1, 'rgba(4,8,20,0)');
g.fillStyle = v; g.fillRect(ix, iy, iw, 230);
const vig = g.createRadialGradient(W / 2, H * 0.42, H * 0.3, W / 2, H * 0.5, H * 0.75);
vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.45)');
g.fillStyle = vig; g.fillRect(ix, iy, iw, ih);

// 5) Panneau en verre dépoli (bas)
const px = 34, pw = W - 68, py = card.panelY || 740, ph = 1168 - py;
g.save(); rr(px, py, pw, ph, 26); g.clip();
g.filter = 'blur(16px)'; g.drawImage(art, ax, ay, dw, dh); g.filter = 'none';
const glass = g.createLinearGradient(0, py, 0, py + ph);
glass.addColorStop(0, 'rgba(10,14,30,.42)'); glass.addColorStop(1, 'rgba(6,8,18,.72)');
g.fillStyle = glass; g.fillRect(px, py, pw, ph);
const tint = g.createRadialGradient(px + pw * 0.8, py, 10, px + pw * 0.8, py, pw);
tint.addColorStop(0, T.glow + '33'); tint.addColorStop(1, 'rgba(0,0,0,0)');
g.fillStyle = tint; g.fillRect(px, py, pw, ph);
g.restore();
g.save(); rr(px, py, pw, ph, 26);
const edge = g.createLinearGradient(px, py, px + pw, py + ph);
edge.addColorStop(0, 'rgba(255,255,255,.85)'); edge.addColorStop(0.3, T.glow); edge.addColorStop(0.7, 'rgba(255,255,255,.25)'); edge.addColorStop(1, T.glow);
g.strokeStyle = edge; g.lineWidth = 2.5; g.shadowColor = T.glow; g.shadowBlur = 14; g.stroke(); g.restore();
g.restore(); // fin du clip de l'illustration

// liseré intérieur du cadre
g.save(); rr(ix, iy, iw, ih, 22); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 3; g.stroke();
rr(ix - 5, iy - 5, iw + 10, ih + 10, 26); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5; g.stroke(); g.restore();

// ===================== EN-TÊTE =====================
// étiquette de stade
g.save(); g.beginPath(); g.moveTo(40, 36); g.lineTo(178, 36); g.lineTo(160, 70); g.lineTo(40, 70); g.closePath();
g.fillStyle = metal(40, 36, 178, 70); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 8; g.fill();
g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.shadowColor = 'transparent'; g.stroke(); g.restore();
text(card.stage || 'BASE', 102, 62, 23, { font: 'BlackItalic', color: '#2a2108', align: 'center', shadow: false });

// nom + suffixe (rétréci pour ne pas toucher les PV)
let nameSize = card.nameSize || 70;
const nameW = (sz) => { g.font = sz + 'px Black'; let w = g.measureText(card.name).width; if (card.suffix) { g.font = (sz * 0.82) + 'px BlackItalic'; w += 14 + g.measureText(card.suffix).width; } return w; };
while (nameW(nameSize) > 540 && nameSize > 40) nameSize--;
const nm = title(card.name, 44, 146, nameSize);
if (card.suffix) title(card.suffix, 44 + nm.w + 14, 146, nameSize * 0.82, { font: 'BlackItalic', fill: ['#fffbe6', T.a, T.b], stroke: '#140f02' });

// PV + type
const hp = String(card.hp);
energy(card.type, 852, 90, 40, true);
if (card.type2) energy(card.type2, 812, 122, 20, true);
const hpR = card.type2 ? 784 : 800;
const hpm = title(hp, hpR, 112, 74, { align: 'right', glow: null });
title('PV', hpR - hpm.w - 8, 108, 26, { align: 'right', glow: null, font: 'Black' });

// sous-titre : ville
g.save(); g.font = '24px SemiItalic'; const cityW = g.measureText(card.city).width; g.restore();
g.save(); rr(44, 168, cityW + 64, 38, 19); g.fillStyle = 'rgba(8,12,26,.55)'; g.fill();
g.strokeStyle = T.glow; g.globalAlpha = 0.8; g.lineWidth = 1.5; g.stroke(); g.restore();
glyph('pin', 68, 188, 22, T.glow);
text(card.city, 88, 195, 24, { font: 'SemiItalic', color: '#fff' });

// ===================== CORPS =====================
let y = py + 52;
if (card.ability) {
    g.save(); g.beginPath(); g.moveTo(px + 30, y - 32); g.lineTo(px + 210, y - 32); g.lineTo(px + 190, y + 10); g.lineTo(px + 16, y + 10); g.closePath();
    const rg = g.createLinearGradient(0, y - 32, 0, y + 10); rg.addColorStop(0, '#ff7a6b'); rg.addColorStop(0.5, '#e0252f'); rg.addColorStop(1, '#a10f18');
    g.fillStyle = rg; g.shadowColor = '#ff3b3b'; g.shadowBlur = 14; g.fill();
    g.shadowColor = 'transparent'; g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.stroke(); g.restore();
    text('Talent', px + 113, y - 1, 28, { font: 'BlackItalic', align: 'center' });
    title(card.ability.name, px + 228, y + 2, 38, { font: 'Black', glow: null, sw: 6 });
    y = wrap(card.ability.text, px + 30, y + 46, pw - 60, 36, 28) + 30;
    divider(px + 40, px + pw - 40, y); y += 22;
}
for (const atk of card.attacks) {
    y += 40;
    const n = Math.max(3, atk.cost.length);
    atk.cost.forEach((t, i) => energy(t, px + 52 + i * 52, y - 13, 23));
    const nx = px + 52 + n * 52 - 8;
    g.font = '58px Black'; const dmgW = g.measureText(String(atk.damage)).width;
    let fs = 40; g.font = `${fs}px Black`;
    while (g.measureText(atk.name).width > px + pw - 30 - dmgW - 24 - nx && fs > 24) { fs--; g.font = `${fs}px Black`; }
    title(atk.name, nx, y, fs, { glow: null, sw: 6 });
    title(String(atk.damage), px + pw - 30, y + 4, 58, { align: 'right', fill: ['#fffbe6', '#ffe27a', '#e0a412'], stroke: '#1a1204', glow: T.glow });
    if (atk.text) y = wrap(atk.text, px + 30, y + 46, pw - 60, 36, 28);
    y += 26;
}

// faiblesse / résistance / retraite (pastilles)
const sy = py + ph - 46;
divider(px + 40, px + pw - 40, sy - 26);
function chip(label, x, w, draw) {
    g.save(); rr(x, sy - 20, w, 40, 20); g.fillStyle = 'rgba(255,255,255,.08)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; g.stroke(); g.restore();
    text(label, x + 16, sy + 8, 20, { font: 'Semi', color: '#d9e2ec' });
    draw(x + 16 + (g.measureText(label).width, 0));
}
g.font = '20px Semi';
const chips = [
    ['faiblesse', card.weakness ? (x) => { energy(card.weakness, x + 14, sy, 14); text('×2', x + 34, sy + 8, 20, { font: 'Black' }); } : null],
    ['résistance', card.resistance ? (x) => { energy(card.resistance, x + 14, sy, 14); text('-30', x + 34, sy + 8, 20, { font: 'Black' }); } : (x) => text('—', x + 8, sy + 8, 20, { font: 'Black', color: '#9aa4b0' })],
    ['retraite', (x) => { for (let i = 0; i < (card.retreat || 0); i++) energy('incolore', x + 14 + i * 32, sy, 13); }]
];
let cx = px + 26;
for (const [label, draw] of chips) {
    g.font = '20px Semi'; const lw = g.measureText(label).width; const w = lw + 32 + 80;
    g.save(); rr(cx, sy - 20, w, 40, 20); g.fillStyle = 'rgba(255,255,255,.08)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; g.stroke(); g.restore();
    text(label, cx + 16, sy + 7, 20, { font: 'Semi', color: '#d9e2ec' });
    if (draw) draw(cx + 16 + lw + 8);
    cx += w + 12;
}

// ===================== RÈGLE + PIED =====================
if (card.flavor) {
    g.font = '19px SemiItalic'; const ls = []; let l = '';
    for (const w of card.flavor.split(' ')) { const tt = l ? l + ' ' + w : w; if (g.measureText(tt).width > W - 120 && l) { ls.push(l); l = w; } else l = tt; }
    ls.push(l);
    ls.slice(0, 2).forEach((s, i) => text(s, W / 2, (ls.length > 1 ? 1192 : 1204) + i * 23, 19, { font: 'SemiItalic', align: 'center', color: '#eef2f8' }));
}
else if (card.ruleText) text(card.ruleText || "Règle Légendaire : quand cette carte est mise K.O., l'adversaire récupère 2 cartes Récompense.",
    W / 2, 1200, 18, { font: 'SemiItalic', align: 'center', color: '#e9eef5' });

// gauche : illustrateur
text(`Illus. ${card.illustrator || 'jason'}`, 46, 1250, 18, { font: 'SemiItalic', color: '#e9eef5' });
// droite : symbole de série + numéro + rareté
const fx = W - 46;
const stars = STARS;
for (let i = 0; i < stars; i++) {
    const sx = fx - 12 - i * 26;
    g.save(); g.shadowColor = '#ffcc33'; g.shadowBlur = 10; glyph('star', sx, 1243, 18, '#ffd23f'); g.restore();
}
const numX = fx - stars * 26 - 10;
g.font = '22px Black'; const numW = g.measureText(card.number).width;
text(card.number, numX, 1251, 22, { font: 'Black', align: 'right' });
// symbole de série (hexagone)
const hx = numX - numW - 30, hy = 1243;
g.save(); g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(hx + Math.cos(a) * 20, hy + Math.sin(a) * 20); } g.closePath();
g.fillStyle = metal(hx - 20, hy - 20, hx + 20, hy + 20); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6; g.fill(); g.restore();
text(card.set || 'V3', hx, hy + 7, 17, { font: 'Black', align: 'center', color: '#2a2108', shadow: false });

}
function finish() { writeFileSync(process.argv[3], c.toBuffer('image/png')); console.log('OK', process.argv[3]); process.exit(0); }
await renderFull(); finish();
