// Fichier: booster-draws.js — contenu des boosters (réglages de l'économie)
import { allCards } from './cards.js';

// Nombre de boosters gratuits par jour (page Booster)
export const DAILY_BOOSTER_LIMIT = 3;

// Chance que la 5e carte d'un booster soit une légendaire, selon le type de booster.
// La V2 a 6 légendaires sur 11 cartes : à 10 %, finir l'album prenait plus de 2 mois.
export const LEGENDARY_CHANCE = { classic: 0.10, daily: 0.10, v2: 0.25, v3: 0.10 };
// Chance que la 5e carte soit une épique (sinon : une rare)
export const EPIC_CHANCE = 0.45;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Booster "classique" : 3 communes, 1 rare, puis une 5e carte légendaire / épique / rare.
 * Même composition pour V1, V2 et V3 : seuls le set de cartes et la chance de légendaire changent.
 */
export function drawClassicBoosterCards(cardSet = allCards, legendaryChance = LEGENDARY_CHANCE.classic) {
    const commons = cardSet.filter(c => c.rarity === 'Commune');
    const rares = cardSet.filter(c => c.rarity === 'Rare');
    const epics = cardSet.filter(c => c.rarity === 'epique');
    const legendaries = cardSet.filter(c => c.rarity === 'Légendaire');
    const drawn = [];
    for (let i = 0; i < 3; i++) drawn.push(pick(commons));
    drawn.push(pick(rares));
    const fifthCardRoll = Math.random();
    if (fifthCardRoll < legendaryChance) {
        drawn.push(pick(legendaries));
    } else if (fifthCardRoll < legendaryChance + EPIC_CHANCE) {
        drawn.push(pick(epics));
    } else {
        drawn.push(pick(rares));
    }
    return drawn;
}

/** Booster légendaire : 4 communes/rares + 1 légendaire garantie, dans le désordre. */
export function drawLegendaryBoosterCards(cardSet = allCards) {
    const commonAndRares = cardSet.filter(c => c.rarity === 'Commune' || c.rarity === 'Rare');
    const legendaries = cardSet.filter(c => c.rarity === 'Légendaire');
    const drawn = [];
    for (let i = 0; i < 4; i++) drawn.push(pick(commonAndRares));
    drawn.push(pick(legendaries));
    return drawn.sort(() => Math.random() - 0.5);
}
