// Fichier: service-worker.js (Version finale avec les bons chemins)

const CACHE_NAME = 'tcg-gemini-cache-v3.2.72'; // Version majeure, pour être sûr

// CORRECTION : On retire le préfixe du dossier. Les chemins doivent être absolus depuis la racine.
const urlsToCache = [
    '/', // La racine, qui sert généralement index.html
    '/index.html',
    '/game.html',
    '/collection.html',
    '/marche.html',
    '/battlepass.html',
    '/main.css',
    '/firebase-config.js',
    '/cards.js',
    '/auth.js',
    '/auth-manager.js',
    '/collection.js',
    '/game.js',
    '/marche.js',
    '/battlepass.js',
    '/battlepass-config.js',
    '/quest-manager.js',
    '/toast.js',
    '/assets/card-back/dos.png',
    '/assets/logo/logo.png'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Cache ouvert pour la version:', CACHE_NAME);
            return cache.addAll(urlsToCache);
        }).catch(err => {
            console.error("Échec de cache.addAll:", err);
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(cacheNames => {
        return Promise.all(
            cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
        );
    }));
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            // S'il y a une réponse en cache, on la sert, sinon on fait une requête réseau.
            return response || fetch(event.request);
        })
    );
});