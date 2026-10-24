// Fichier: auth-manager.js (Version centralisée et finale)
import { onAuthStateChanged, signOut, getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { doc, getDoc, onSnapshot, updateDoc, serverTimestamp, collection, query, where, arrayRemove } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { db } from './firebase-config.js';
import { updateQuestProgress } from './quest-manager.js';
import { getAchievementsStatus } from './achievements-config.js';
import { showToast } from './toast.js';

const auth = getAuth();

/**
 * Pastille sur le bouton Profil quand un succès est prêt, + une notification la 1re fois
 * qu'il se débloque (mémorisée sur l'appareil pour ne pas la répéter à chaque page).
 */
function checkAchievements(uid, userData) {
    const ready = getAchievementsStatus(userData).filter(a => a.unlocked && !a.claimed);
    const requests = userData.friendRequests || [];
    // Pastille sur le profil : succès à réclamer OU demande d'ami en attente
    document.getElementById('profil-link')?.classList.toggle('has-dot', ready.length > 0 || requests.length > 0);

    const fresh = notifyOnce(`ach-notified-${uid}`, ready.map(a => a.id));
    for (const a of ready.filter(x => fresh.includes(x.id))) {
        showToast('success', `🏅 Succès débloqué : ${a.title} ! Réclame ta récompense dans ton profil.`, 5000);
    }
    if (notifyOnce(`fr-notified-${uid}`, requests).length) {
        showToast('info', `👥 Nouvelle demande d'ami ! Va sur ton profil pour l'accepter.`, 5000);
    }
}

/** Renvoie les identifiants pas encore signalés sur cet appareil, et les mémorise. */
function notifyOnce(key, ids) {
    let notified = [];
    try { notified = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* stockage indisponible */ }
    const fresh = ids.filter(id => !notified.includes(id));
    if (fresh.length) {
        try { localStorage.setItem(key, JSON.stringify([...notified, ...fresh])); } catch { /* ignoré */ }
    }
    return fresh;
}

/**
 * Cadeaux envoyés à tous les joueurs (GitHub Actions → « Cadeau à tous les joueurs ») :
 * les objets sont déjà dans le compte, on affiche le message une fois puis on vide la boîte.
 */
const shownGifts = new Set();
function showGifts(uid, userData) {
    const fresh = (userData.giftInbox || []).filter(g => g?.id && !shownGifts.has(g.id));
    if (!fresh.length) return;
    fresh.forEach(g => shownGifts.add(g.id));
    for (const g of fresh) showToast('success', `🎁 Cadeau reçu : ${g.message} (${g.text})`, 8000);
    updateDoc(doc(db, "users", uid), { giftInbox: arrayRemove(...fresh) }).catch(() => { /* réessayé à la prochaine page */ });
}

/** Hors de la page profil : prévient quand un ami propose un échange. */
function listenToTradeInvites(uid) {
    if (location.pathname.endsWith('profil.html')) return; // le profil affiche déjà sa propre fenêtre
    const q = query(collection(db, "tradeRequests"), where("to", "==", uid), where("status", "==", "pending"));
    onSnapshot(q, (snap) => {
        snap.docChanges().forEach(async (change) => {
            if (change.type !== 'added') return;
            const data = change.doc.data();
            const created = data.createdAt?.toDate?.().getTime() || Date.now();
            if (Date.now() - created > 60 * 1000) return;
            const from = await getDoc(doc(db, "users", data.from)).catch(() => null);
            showToast('info', `🔄 ${from?.data()?.pseudo || 'Un ami'} veut échanger avec toi ! Ouvre ton profil (1 min).`, 6000);
        });
    }, () => { /* index manquant ou hors ligne : pas grave */ });
}

// Un seul écouteur temps réel par page (protectPage peut être appelée plusieurs fois)
let userDataUnsubscribe = null;

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
    if (userDataUnsubscribe) return;
    listenToTradeInvites(uid);
    const userDocRef = doc(db, "users", uid);
    // onSnapshot met à jour l'UI automatiquement dès qu'une donnée change dans Firestore
    userDataUnsubscribe = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
            updateHeaderUI(doc.data());
            checkAchievements(uid, doc.data());
            showGifts(uid, doc.data());
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
                    // Présence (affichée dans la liste d'amis) + quête "connecte-toi X jours"
                    updateDoc(userDocRef, { lastOnline: serverTimestamp() }).catch(console.error);
                    await updateQuestProgress('daily_login_streak');
                    const freshDoc = await getDoc(userDocRef);
                    const userData = { uid: user.uid, ...freshDoc.data() };
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
