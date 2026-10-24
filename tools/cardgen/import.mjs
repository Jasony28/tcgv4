// Transforme le fichier texte des cartes en fiches JSON (une par carte) dans cartes/.
// Usage : node import.mjs "C:/Users/jason/Desktop/Cartev3/Details des cartes.txt" "C:/Users/jason/Desktop/Cartev3"
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [src, imagesDir] = process.argv.slice(2);
const lines = readFileSync(src, 'utf8').split(/\r?\n/).map(l => l.trim());
const RARITY = { commune: 'Commune', rare: 'Rare', 'épique': 'epique', 'légendaire': 'Légendaire' };

// « Pokémon » → « créature » pour rester dans l'univers du jeu
const clean = (t) => t.replace(/un Pokémon/g, 'une créature').replace(/vos Pokémon/g, 'vos créatures').replace(/Pokémon/g, 'créature');

// Coût en énergie selon les dégâts : type principal, puis second type, puis incolore
function cost(damage, t1, t2) {
    const n = damage <= 20 ? 1 : damage <= 40 ? 2 : damage <= 120 ? 3 : 4;
    return [[t1], [t1, 'incolore'], [t1, t2 || t1, 'incolore'], [t1, t1, t2 || t1, 'incolore']][n - 1];
}

const cards = [];
let theme = '', card = null;
for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    let m;
    if ((m = l.match(/^Thème \d+ : (.+?)(?: \(.*\))?$/))) { theme = m[1]; continue; }
    const next = lines.slice(i + 1).find(Boolean) || '';
    if (next.startsWith('Rareté')) {
        const ex = / EX$/.test(l);
        card = { name: ex ? l.replace(/ EX$/, '') : l, suffix: ex ? 'EX' : null, city: theme, set: 'V3', stage: 'BASE', attacks: [] };
        cards.push(card);
        continue;
    }
    if (!card) continue;
    if ((m = l.match(/^Rareté : (\S+) .*\| Type : ([^|]+)\| PV : (\d+)/))) {
        card.rarity = RARITY[m[1].toLowerCase()];
        [card.type, card.type2] = m[2].split('/').map(s => s.trim());
        if (!card.type2) delete card.type2;
        card.hp = Number(m[3]);
    } else if ((m = l.match(/^Talent – (.+?) : (.+)$/))) {
        card.ability = { name: m[1], text: clean(m[2]) };
    } else if ((m = l.match(/^Attaque(?: \d)? – (.+?) \((\d+) dégâts?\) : (.+)$/))) {
        const damage = Number(m[2]);
        const atk = { name: m[1], damage: damage || '', cost: cost(damage, card.type, card.type2) };
        if (!/^Aucun effet/.test(m[3])) atk.text = clean(m[3]);
        card.attacks.push(atk);
    } else if ((m = l.match(/^Description : (.+)$/))) {
        card.flavor = m[1];
    } else if ((m = l.match(/^Faiblesse : (\S+) \(x2\) \| Retraite : (\d+) \| Numéro : (\S+)/))) {
        card.weakness = m[1]; card.retreat = Number(m[2]); card.number = m[3];
    }
}

mkdirSync('cartes', { recursive: true });
for (const c of cards) {
    c.id = 'V3_' + c.number.split('/')[0];
    c.art = `${imagesDir}/${c.name}${c.suffix ? ' ' + c.suffix : ''}.jpg`;
    writeFileSync(`cartes/${c.id}.json`, JSON.stringify(c, null, 2));
}
const count = (r) => cards.filter(c => c.rarity === r).length;
console.log(`${cards.length} cartes : ${count('Commune')} C, ${count('Rare')} R, ${count('epique')} E, ${count('Légendaire')} L`);
