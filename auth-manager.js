// Fichier: auth-manager.js (Version centralisée et finale)
import { onAuthStateChanged, signOut, getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';

const auth = getAuth();

/**
 * Met à jour le header (pseudo, pièces) et attache l'événement de déconnexion.
 * Cette fonction est la source de vérité pour le header.
 * @param {object} userData - Les données de l'utilisateur.
 */
function updateHeaderUI(userData) {
    const pseudoEl = document.getElementById('user-pseudo');
    const coinAmountEl = document.getElementById('coin-amount');
    const logoutButton = document.getElementById('logout-button');

    if (pseudoEl && userData?.pseudo) {
        pseudoEl.textContent = userData.pseudo;
    }
    if (coinAmountEl && userData?.coins !== undefined) {
        coinAmountEl.textContent = userData.coins;
    }
    
    // Logique de déconnexion centralisée
    if (logoutButton) {
        // Astuce pour éviter d'ajouter plusieurs écouteurs si la fonction est appelée plusieurs fois
        const newLogoutButton = logoutButton.cloneNode(true);
        logoutButton.parentNode.replaceChild(newLogoutButton, logoutButton);
        
        newLogoutButton.addEventListener('click', () => {
            signOut(auth).then(() => {
                console.log('Utilisateur déconnecté');
                window.location.href = 'index.html';
            }).catch((error) => {
                console.error('Erreur de déconnexion', error);
            });
        });
    }
}

/**
 * Écoute les changements en temps réel sur les données de l'utilisateur
 * et met à jour l'interface.
 * @param {string} uid - L'ID de l'utilisateur.
 */
function listenToUserData(uid) {
    const userDocRef = doc(db, "users", uid);
    // onSnapshot met à jour l'UI automatiquement dès qu'une donnée change dans Firestore
    onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
            updateHeaderUI(doc.data());
        }
    });
}

/**
 * Protège une page en vérifiant si l'utilisateur est connecté.
 * Récupère les données initiales et lance l'écouteur de mises à jour.
 * @returns {Promise<object|null>} Une promesse qui résout avec les données de l'utilisateur ou null.
 */
export function protectPage() {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            unsubscribe(); // On se désabonne pour ne pas déclencher la fonction plusieurs fois
            if (user) {
                const userDocRef = doc(db, "users", user.uid);
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists()) {
                    const userData = { uid: user.uid, ...userDoc.data() };
                    // On ne lance la mise à jour et l'écouteur QUE depuis cet endroit
                    updateHeaderUI(userData); 
                    listenToUserData(user.uid); 
                    resolve(userData);
                } else {
                    // Si l'utilisateur existe dans Auth mais pas dans Firestore (cas rare), on le déconnecte
                    await signOut(auth);
                    window.location.href = 'index.html';
                    resolve(null);
                }
            } else {
                // Si pas d'utilisateur, redirection vers la page de connexion
                window.location.href = 'index.html';
                resolve(null);
            }
        });
    });
}