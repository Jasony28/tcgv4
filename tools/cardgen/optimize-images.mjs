// Allège les images du jeu : conversion en WebP à une taille adaptée à l'écran, puis mise à jour des liens.
// Usage (depuis tools/cardgen) : node optimize-images.mjs
// Les cartes passent de 2-3 Mo à ~100 Ko chacune, sans différence visible à l'écran.
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const GAME = '../..';
const CARD_WIDTH = 720;   // assez net même en grand sur un téléphone à écran haute définition

async function toWebp(src, dest, maxWidth, quality = 80) {
    const img = await loadImage(src);
    const w = Math.min(maxWidth, img.width), h = Math.round(img.height * w / img.width);
    const canvas = createCanvas(w, h);
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    writeFileSync(dest, await canvas.encode('webp', quality));
    return [statSync(src).size, statSync(dest).size];
}
async function toPng(src, dest, size) {
    const img = await loadImage(src);
    const canvas = createCanvas(size, size);
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    writeFileSync(dest, canvas.toBuffer('image/png'));
}

let before = 0, after = 0;
const count = (b, a) => { before += b; after += a; };

// 1) Cartes V1 et V2 (PNG → WebP) ; V3 (déjà en WebP) redimensionnées
for (const dir of ['cards', 'cards2', 'cards3']) {
    for (const f of readdirSync(`${GAME}/assets/${dir}`)) {
        const src = `${GAME}/assets/${dir}/${f}`;
        if (f.endsWith('.png')) {
            count(...await toWebp(src, src.replace(/\.png$/, '.webp'), CARD_WIDTH));
            unlinkSync(src);
        } else if (f.endsWith('.webp')) {
            const tmp = src + '.tmp.webp';
            const [b, a] = await toWebp(src, tmp, CARD_WIDTH, 82);
            writeFileSync(src, readFileSync(tmp)); unlinkSync(tmp); count(b, a);
        }
    }
}
// 2) Booster, dos de carte, logo
count(...await toWebp(`${GAME}/assets/booster/booster.png`, `${GAME}/assets/booster/booster.webp`, 480));
count(...await toWebp(`${GAME}/assets/card-back/dos.png`, `${GAME}/assets/card-back/dos.webp`, 480));
count(...await toWebp(`${GAME}/assets/logo/logo.png`, `${GAME}/assets/logo/logo.webp`, 256));
await toPng(`${GAME}/assets/logo/logo.png`, `${GAME}/assets/logo/logo-192.png`, 192);
await toPng(`${GAME}/assets/logo/logo.png`, `${GAME}/assets/logo/logo-512.png`, 512);
for (const f of ['booster/booster.png', 'card-back/dos.png', 'logo/logo.png']) unlinkSync(`${GAME}/assets/${f}`);

// 3) Liens dans le code
const files = readdirSync(GAME).filter(f => /\.(js|html|css|json)$/.test(f));
for (const f of files) {
    const path = `${GAME}/${f}`;
    let s = readFileSync(path, 'utf8'), o = s;
    s = s.replace(/(assets\/cards2?\/[^'"`)\s]+)\.png/g, '$1.webp')
         .replace(/booster\/booster\.png/g, 'booster/booster.webp')
         .replace(/card-back\/dos\.png/g, 'card-back/dos.webp');
    // Icônes de l'application (le navigateur et iOS veulent du PNG) / logo affiché dans les pages (WebP)
    if (f === 'manifest.json') s = s.replace(/assets\/logo\/logo\.png/g, 'assets/logo/logo-512.png');
    else s = s.replace(/(rel="(?:apple-touch-icon|icon)" href=")assets\/logo\/logo\.png/g, '$1assets/logo/logo-192.png')
              .replace(/assets\/logo\/logo\.png/g, 'assets/logo/logo.webp');
    if (s !== o) writeFileSync(path, s);
}
const mb = (n) => (n / 1048576).toFixed(1) + ' Mo';
console.log(`Images : ${mb(before)} → ${mb(after)}`);
if (existsSync(`${GAME}/assets/logo/logo.png`)) console.log('⚠️ logo.png encore présent');
