// Remplace firebase-config.js sur le serveur : la base passe par l'API REST (firestore-rest.js)
export { db } from './firestore-rest.js';
export const auth = null;
