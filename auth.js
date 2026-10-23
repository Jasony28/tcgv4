import { GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

const googleLoginButton = document.getElementById('google-login-button');
const errorMessage = document.getElementById('error-message');

googleLoginButton.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
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
                dailyBoosterOpenedCount: 0, dailyLastReset: null, lastLoginQuestUpdate: null,
                lastBoosterOpenQuestUpdate: null,
                // Le Battle Pass est initialisé à la 1re connexion par quest-manager (normalizeBattlePass)
                battlePass: { seasonId: null, xp: 0, questProgress: {}, claimedRewards: {} },
                boosterInventory: { classic: 0, legendary: 0, v2: 0 }
            });
        }
        window.location.href = 'game.html';
    } catch (error) {
        errorMessage.textContent = `Erreur de connexion : ${error.message}`;
    }
});
