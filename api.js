// Fichier: api.js — le jeu demande au serveur (server/worker.js) de faire les actions qui touchent à l'économie :
// acheter, ouvrir un booster, vendre, réclamer une récompense… Le serveur décide des prix et des tirages,
// et seul lui peut modifier les pièces et les cartes (règles Firestore).
import { auth } from './firebase-config.js';
import { SERVER_URL } from './server-config.js';
import { showToast } from './toast.js';

/**
 * @param {string} action - ex. 'buyBooster'
 * @param {object} params - ex. { type: 'v3' }
 * @returns {Promise<any>} le résultat de l'action ; lève une Error avec un message lisible sinon
 */
export async function callServer(action, params = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error("Tu n'es pas connecté.");
    let res;
    try {
        res = await fetch(`${SERVER_URL}/api`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, params })
        });
    } catch {
        throw new Error("Serveur injoignable : vérifie ta connexion internet.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Le serveur n'a pas répondu, réessaie.");
    for (const q of data.quests || []) {
        showToast('success', `Quête terminée : ${q.description} (+${q.xp} XP${q.coins ? `, +${q.coins} pièces` : ''})`, 4000);
    }
    if (data.levelUp) showToast('info', `Niveau ${data.levelUp} atteint ! Récupère ta récompense dans le Pass.`, 4500);
    return data.result;
}
