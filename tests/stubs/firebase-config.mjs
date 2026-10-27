// Base de test : changée par les tests selon le joueur connecté (useDb)
export let db = null;
export function useDb(next) { db = next; }
