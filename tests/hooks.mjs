// Fait tourner le code du jeu dans Node : les modules Firebase du CDN sont remplacés par le paquet npm,
// et la connexion / l'interface (firebase-config, auth, toast, sons) par des bouchons de test.
const FIRESTORE = 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';
const AUTH = 'https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js';
const STUBS = { 'firebase-config.js': 'firebase-config.mjs', 'toast.js': 'toast.mjs', 'sfx.js': 'sfx.mjs' };

export async function resolve(specifier, context, next) {
    if (specifier === FIRESTORE) return next('firebase/firestore', { ...context, parentURL: import.meta.url });
    if (specifier === AUTH) return { url: new URL('./stubs/auth.mjs', import.meta.url).href, shortCircuit: true };
    const name = specifier.startsWith('./') && specifier.slice(2);
    if (name && STUBS[name] && !context.parentURL?.includes('/tests/')) {
        return { url: new URL(`./stubs/${STUBS[name]}`, import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
}
