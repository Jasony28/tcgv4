import { getAuth, GoogleAuthProvider, signInWithPopup, getAdditionalUserInfo } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

const googleLoginButton = document.getElementById('google-login-button');
const errorMessage = document.getElementById('error-message');

googleLoginButton.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const additionalUserInfo = getAdditionalUserInfo(result);
        if (additionalUserInfo.isNewUser) {
            console.log("Nouvel utilisateur via Google, création du profil...");
            await setDoc(doc(db, "users", user.uid), {
                pseudo: user.displayName, email: user.email, collection: {}, coins: 5,
                dailyBoosterOpenedCount: 0, lastBoosterResetDate: null, lastLoginQuestUpdate: null,
                lastBoosterOpenQuestUpdate: null,
                battlePass: { seasonId: 1, xp: 0, questProgress: {}, claimedRewards: {} },
                boosterInventory: { classic: 0, legendary: 0 }
            });
        }
        window.location.href = 'game.html';
    } catch (error) {
        errorMessage.textContent = `Erreur de connexion : ${error.message}`;
    }
});