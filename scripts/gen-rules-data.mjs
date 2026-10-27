// Fichier: scripts/gen-rules-data.mjs — recopie les chiffres de econ-config.js et la liste des cartes / succès
// dans firestore.rules (entre les lignes « GÉNÉRÉ »). À relancer après un changement de cartes ou de valeurs :
//    node scripts/gen-rules-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DAILY_GAIN_LIMIT, CARD_VALUE, BOOSTER_VALUE, DISPLAY_VALUE, ECON_CARDS, RARITY_KEYS, achievementValue } from '../econ-config.js';
import { ACHIEVEMENTS } from '../achievements-config.js';
import { DAILY_BOOSTER_LIMIT, DAILY_V2_BOOSTER_LIMIT } from '../booster-draws.js';

const rulesPath = fileURLToPath(new URL('../firestore.rules', import.meta.url));
const START = '    // ----- GÉNÉRÉ par scripts/gen-rules-data.mjs : ne pas modifier à la main -----';
const END = '    // ----- FIN DU GÉNÉRÉ -----';

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const map = (obj) => `{${Object.entries(obj).map(([k, v]) => `${q(k)}: ${v}`).join(', ')}}`;

// Une expression régulière par rareté (une seule opération dans les règles, au lieu d'une grande table)
const idRegex = (cards) => {
    const bad = cards.find(c => !/^[A-Za-z0-9_]+$/.test(c.id));
    if (bad) throw new Error(`Identifiant de carte non pris en charge par les règles : ${bad.id}`);
    return `'^(${cards.map(c => c.id).join('|')})$'`;
};
const byRarity = (r) => ECON_CARDS.filter(c => c.rarity === r);
// Carte absente : l'accès échoue et la règle refuse (c'est voulu)
const has = (id) => `col[${q(id)}].quantity > 0`;
// econ.cards = { c, r, e, l } : une liste de cartes par rareté
const rarityLists = Object.entries(RARITY_KEYS).map(([r, k]) =>
    `    function ${k}Ids() { return [${byRarity(r).map(c => q(c.id)).join(', ')}]; }`).join('\n');
const gainTerms = Object.entries(RARITY_KEYS).map(([r, k]) => `${CARD_VALUE[r]} * cardSum(c0, c1, k.get('${k}', []))`).join('\n        + ');
const listChecks = Object.values(RARITY_KEYS).map(k => `(k.get('${k}', []).size() == 0 || k.get('${k}', []).toSet().hasOnly(${k}Ids()))`).join('\n        && ');

const achievementTerms = ACHIEVEMENTS.map(a =>
    `        : id == ${q(a.id)} ? (${a.cardIds.map(has).join('\n            && ')} ? ${achievementValue(a.reward)} : 0)`);

const block = `${START}
    function dailyGainLimit() { return ${DAILY_GAIN_LIMIT}; }
    function dailyBoosterLimit() { return ${DAILY_BOOSTER_LIMIT}; }
    function dailyV2BoosterLimit() { return ${DAILY_V2_BOOSTER_LIMIT}; }
    // Cartes de chaque rareté
${rarityLists}
    // Valeur des cartes gagnées ou perdues (k = cartes du reçu, c0 / c1 = collection avant / après)
    function cardsGain(c0, c1, k) {
      return ${gainTerms};
    }
    function rarityListsValid(k) {
      return ${listChecks};
    }
    // Toutes les cartes du jeu (pour vérifier une liste de cartes d'un coup)
    function allCardIds() { return [${ECON_CARDS.map(c => q(c.id)).join(', ')}]; }
    // Carte connue du jeu
    function isCard(id) { return id is string && id.matches(${idRegex(ECON_CARDS)}); }
    function boosterValues() { return ${map(BOOSTER_VALUE)}; }
    function displayValues() { return ${map(DISPLAY_VALUE)}; }
    // Succès « id » réclamé : valeur de sa récompense, si toutes ses cartes sont bien dans la collection
    function achievementBonus(id, col) {
      return false ? 0
${achievementTerms.join('\n')}
        : 0;
    }
${END}`;

const rules = readFileSync(rulesPath, 'utf8');
const i = rules.indexOf(START), j = rules.indexOf(END);
if (i < 0 || j < 0) throw new Error('Repères « GÉNÉRÉ » introuvables dans firestore.rules');
writeFileSync(rulesPath, rules.slice(0, i) + block + rules.slice(j + END.length));
console.log(`firestore.rules : ${ECON_CARDS.length} cartes, ${ACHIEVEMENTS.length} succès.`);
