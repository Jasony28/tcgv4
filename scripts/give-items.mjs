// Fichier: scripts/give-items.mjs — lancé à la main par GitHub Actions (.github/workflows/give-items.yml).
// Les champs du formulaire arrivent en variables d'environnement GIFT_*.
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';
import { parseGift, giveToAllPlayers, readCardIds } from './give-logic.mjs';

const knownCardIds = readCardIds(['cards.js', 'cards1.js', 'cards-v3.js']
    .map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')));

let gift;
try {
    gift = parseGift({
        coins: process.env.GIFT_COINS,
        boosters: process.env.GIFT_BOOSTERS,
        displays: process.env.GIFT_DISPLAYS,
        cards: process.env.GIFT_CARDS,
        message: process.env.GIFT_MESSAGE
    }, knownCardIds);
} catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
    console.error("Secret FIREBASE_SERVICE_ACCOUNT manquant : ajoute-le dans GitHub (Settings → Secrets and variables → Actions).");
    process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });

await giveToAllPlayers({
    db: admin.firestore(),
    FieldValue: admin.firestore.FieldValue,
    gift,
    dryRun: process.env.GIFT_DRY_RUN === 'true'
});
process.exit(0);
