// Met les cartes générées (out/) dans le jeu :
//  - convertit chaque carte en WebP (≈ 300 Ko au lieu de 2 Mo) dans assets/cards3/
//  - réécrit la liste des cartes de cards-v3.js (entre les marqueurs « LISTE GÉNÉRÉE »)
// Une carte sans image reste dans l'album en « à venir » : elle ne sort pas des boosters.
// Usage : node build.mjs && node export.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const GAME = '../..';
const cards = readdirSync('cartes').filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(readFileSync(`cartes/${f}`, 'utf8')));

const entries = [];
for (const c of cards) {
    const fullName = c.name + (c.suffix ? ' ' + c.suffix : '');
    const png = `out/${c.id}.png`;
    let image, upcoming = false;
    if (existsSync(png)) {
        const img = await loadImage(png);
        const canvas = createCanvas(img.width, img.height);
        canvas.getContext('2d').drawImage(img, 0, 0);
        writeFileSync(`${GAME}/assets/cards3/${c.id}.webp`, await canvas.encode('webp', 88));
        image = `assets/cards3/${c.id}.webp`;
    } else {
        image = `assets/cards3/${c.id}.svg`;
        upcoming = true;
    }
    entries.push(`    { id: '${c.id}', name: ${JSON.stringify(fullName)}, rarity: '${c.rarity}', image: '${image}', version: 'v3'${upcoming ? ', upcoming: true' : ''} }`);
}

const file = `${GAME}/cards-v3.js`;
const src = readFileSync(file, 'utf8');
const start = '// --- LISTE GÉNÉRÉE (tools/cardgen/export.mjs) ---';
const end = '// --- FIN DE LA LISTE GÉNÉRÉE ---';
const i = src.indexOf(start), j = src.indexOf(end);
if (i < 0 || j < 0) throw new Error('Marqueurs introuvables dans cards-v3.js');
writeFileSync(file, src.slice(0, i + start.length) + '\nexport const allCardsV3 = [\n' + entries.join(',\n') + '\n];\n' + src.slice(j));
const upcoming = entries.filter(e => e.includes('upcoming')).length;
console.log(`${entries.length} cartes dans cards-v3.js (${upcoming} à venir)`);
