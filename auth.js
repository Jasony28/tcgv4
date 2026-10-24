import {
    GoogleAuthProvider, signInWithPopup, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

const googleLoginButton = document.getElementById('google-login-button');
const errorMessage = document.getElementById('error-message');
const sessionCheck = document.getElementById('session-check');

// --- Rester connecté ---
// L'application (et l'icône sur l'écran d'accueil) démarre sur cette page. Avant, elle affichait
// toujours « Se connecter avec Google », même si la session Firebase était encore valide :
// on avait l'impression d'avoir été déconnecté. Maintenant, si la session existe, on entre direct.
let redirecting = false;
googleLoginButton.disabled = true;
onAuthStateChanged(auth, async (user) => {
    if (redirecting) return;
    if (user) {
        try {
            const profile = await getDoc(doc(db, "users", user.uid));
            if (profile.exists()) {
                redirecting = true;
                window.location.replace('game.html');
                return;
            }
        } catch (e) {
            console.error("Vérification de la session impossible :", e);
        }
    }
    // Pas de session (ou profil pas encore créé) : on montre le bouton
    sessionCheck.hidden = true;
    googleLoginButton.hidden = false;
    googleLoginButton.disabled = false;
});

googleLoginButton.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' }); // choix du compte Google
    try {
        // Session gardée sur cet appareil, jusqu'au clic sur « Déconnexion »
        await setPersistence(auth, browserLocalPersistence);
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        // On vérifie l'existence du profil plutôt que "isNewUser" : si la création avait échoué
        // la première fois, le joueur restait bloqué (déconnecté en boucle par protectPage).
        const userRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
            console.log("Nouvel utilisateur via Google, création du profil...");
            await setDoc(userRef, {
                pseudo: user.displayName, email: user.email, collection: {}, coins: 50,
                dailyBoosterOpenedCount: 0, dailyV2BoosterOpenedCount: 0, dailyLastReset: null,
                lastLoginQuestUpdate: null, lastBoosterOpenQuestUpdate: null,
                // Le Battle Pass est initialisé à la 1re connexion par quest-manager (normalizeBattlePass)
                battlePass: { seasonId: null, xp: 0, questProgress: {}, claimedRewards: {} },
                boosterInventory: { classic: 0, legendary: 0, v2: 0, v3: 0 }
            });
        }
        redirecting = true;
        window.location.replace('game.html');
    } catch (error) {
        errorMessage.textContent = `Erreur de connexion : ${error.message}`;
    }
});
