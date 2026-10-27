// Fichier: booster-draws.js — contenu des boosters (réglages de l'économie)
import { allCards } from './cards.js';
import { allCardsV2 } from './cards1.js';
import { allCardsV3Released } from './cards-v3.js';
import { mainDailyBoosterType } from './series-config.js';

// Boosters gratuits par jour (page Booster) : chaque collection a son propre compteur
export const DAILY_BOOSTER_LIMIT = 3;     // booster principal : V1, puis V3 une fois la V1 terminée
export const DAILY_V2_BOOSTER_LIMIT = 2;  // boosters V2

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

/**
 * Tire les cartes d'un booster (sur le serveur : le joueur ne peut pas choisir ses cartes).
 * @param {string} boosterType - 'daily' / 'daily_v2' (gratuits du jour) ou un type de l'inventaire
 */
export function drawBooster(boosterType) {
    // Boosters gratuits du jour : principal (V1 puis V3) et V2, chacun son compteur
    const type = { daily: mainDailyBoosterType(), daily_v2: 'v2' }[boosterType] || boosterType;
    if (type === 'legendary') return drawLegendaryBoosterCards();
    if (type === 'v3_legendary') return drawLegendaryBoosterCards(allCardsV3Released);
    if (type === 'v3') return drawClassicBoosterCards(allCardsV3Released, LEGENDARY_CHANCE.v3);
    if (type === 'v2') return drawClassicBoosterCards(allCardsV2, LEGENDARY_CHANCE.v2);
    return drawClassicBoosterCards();
}
