// Génère toutes les cartes qui ont une image, dans out/, plus des planches de contrôle (10 cartes par planche).
// Usage : node build.mjs            (toutes)   |   node build.mjs V3_001 V3_004   (seulement celles-là)
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const only = process.argv.slice(2);
mkdirSync('out', { recursive: true });
const done = [], missing = [];
for (const f of readdirSync('cartes').filter(f => f.endsWith('.json')).sort()) {
    const card = JSON.parse(readFileSync(`cartes/${f}`, 'utf8'));
    if (only.length && !only.includes(card.id)) continue;
    if (!existsSync(card.art)) { missing.push(`${card.id} ${card.name}`); continue; }
    execFileSync(process.execPath, ['make-card.mjs', `cartes/${f}`, `out/${card.id}.png`]);
    done.push(card.id);
}
console.log(`${done.length} carte(s) générée(s). Sans image : ${missing.length}`);

// Planches : 5 colonnes x 2 lignes, cartes à 40 %
const s = 0.4, cw = 931 * s, ch = 1300 * s, gap = 16;
for (let p = 0; p * 10 < done.length; p++) {
    const ids = done.slice(p * 10, p * 10 + 10);
    const cols = Math.min(5, ids.length), rows = Math.ceil(ids.length / 5);
    const sheet = createCanvas(cols * (cw + gap) + gap, rows * (ch + gap) + gap), g = sheet.getContext('2d');
    g.fillStyle = '#10141c'; g.fillRect(0, 0, sheet.width, sheet.height);
    for (const [i, id] of ids.entries())
        g.drawImage(await loadImage(`out/${id}.png`), gap + (i % 5) * (cw + gap), gap + Math.floor(i / 5) * (ch + gap), cw, ch);
    writeFileSync(`out/planche-${p + 1}.png`, sheet.toBuffer('image/png'));
}
