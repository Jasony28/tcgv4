// Fichier: server/worker.js — le serveur du jeu (Cloudflare Worker, gratuit)
// Le jeu envoie POST /api { action, params } avec le jeton Firebase du joueur (Authorization: Bearer …).
// Le serveur vérifie le jeton, puis exécute l'action avec les droits d'administrateur sur Firestore.
//
// Variables (Cloudflare → Workers → tcg-serveur → Settings → Variables) :
//   FIREBASE_SERVICE_ACCOUNT (secret) : la clé JSON du compte de service Firebase
//   FIREBASE_PROJECT_ID              : tcgjwbndr
import { configureFirestore } from './firestore-rest.js';
import { verifyIdToken, serviceAccountToken } from './auth.js';
import { runAction } from './actions.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

let configured = null;
function setup(env) {
    if (configured === env) return;
    if (env.FIRESTORE_EMULATOR_HOST) {
        // Tests uniquement : émulateur local, sans compte de service
        configureFirestore({ project: env.FIREBASE_PROJECT_ID, host: `http://${env.FIRESTORE_EMULATOR_HOST}`, getToken: async () => 'owner' });
    } else {
        configureFirestore({ project: env.FIREBASE_PROJECT_ID, getToken: () => serviceAccountToken(env.FIREBASE_SERVICE_ACCOUNT) });
    }
    configured = env;
}

// Une seule action à la fois par joueur sur cette instance (double clic, deux onglets)
const running = new Map();

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
        const url = new URL(request.url);
        if (url.pathname === '/' && request.method === 'GET') return json({ ok: true, service: 'tcg-serveur' });
        if (url.pathname !== '/api' || request.method !== 'POST') return json({ error: 'Introuvable' }, 404);
        setup(env);

        let uid;
        try {
            const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
            uid = env.TEST_AUTH === 'yes' && token.startsWith('test:') ? token.slice(5) : await verifyIdToken(token, env.FIREBASE_PROJECT_ID);
        } catch {
            return json({ error: 'Connexion expirée : recharge la page.' }, 401);
        }

        let body;
        try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

        const previous = running.get(uid) || Promise.resolve();
        const current = previous.catch(() => {}).then(() => runAction(uid, String(body?.action || ''), body?.params));
        running.set(uid, current);
        try {
            return json({ ok: true, ...(await current) });
        } catch (e) {
            // Erreur du jeu (« Pas assez de pièces ! ») : message pour le joueur ; erreur technique : message générique
            if (e?.status) {
                console.error('Firestore :', e.status, e.message);
                return json({ error: 'Le serveur est occupé, réessaie dans un instant.' }, 503);
            }
            return json({ error: e?.message || String(e) }, 400);
        } finally {
            if (running.get(uid) === current) running.delete(uid);
        }
    }
};
