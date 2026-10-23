// Fichier: scripts/close-auctions.mjs — lancé toutes les 10 minutes par GitHub Actions
// (voir .github/workflows/close-auctions.yml). La clé d'accès à Firebase vient du secret
// GitHub FIREBASE_SERVICE_ACCOUNT : elle n'est jamais écrite dans le code.
import admin from 'firebase-admin';
import { closeExpiredListings } from './close-logic.mjs';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
    console.error("Secret FIREBASE_SERVICE_ACCOUNT manquant : ajoute-le dans GitHub (Settings → Secrets and variables → Actions).");
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();

const results = await closeExpiredListings({
    db,
    FieldValue: admin.firestore.FieldValue,
    Timestamp: admin.firestore.Timestamp
});
const sold = results.filter(r => r.outcome === 'sold').length;
console.log(`Terminé : ${results.length} annonce(s) clôturée(s) (${sold} vendue(s), ${results.length - sold} rendue(s)).`);
process.exit(0);
