// Fichier: firebase-config.js (Version SÉCURISÉE - À NE PAS PARTAGER)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// VOS CLÉS DOIVENT RESTER PRIVÉES.
// Idéalement, utilisez les variables d'environnement pour ne pas les écrire directement dans le code.
// Je vous recommande de générer de nouvelles clés depuis votre console Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyBClVxwkJIwaWgR8aTEJHctHNU668uNKZI",
  authDomain: "tcgjwbndr.firebaseapp.com",
  projectId: "tcgjwbndr",
  storageBucket: "tcgjwbndr.firebasestorage.app",
  messagingSenderId: "617815082011",
  appId: "1:617815082011:web:edaab0fb6514fb900764be",
  measurementId: "G-TM31NC6Y8W"
};

// Initialisation de Firebase et des services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Exportation pour les utiliser dans les autres fichiers
export { auth, db };