// Fichier: service-worker.js

const CACHE_NAME = 'tcg-gemini-cache-v5.1.0';

// Chemins relatifs à l'emplacement du service worker : fonctionne à la racine
// du domaine comme dans un sous-dossier (ex: GitHub Pages /TCG-jason/).
const urlsToCache = [
    './',
    './index.html',
    './game.html',
    './collection.html',
    './marche.html',
    './battlepass.html',
    './profil.html',
    './boutique.html',
    './boutique.js',
    './shop-config.js',
    './daily-utils.js',
    './achievements-config.js',
    './achievements.js',
    './main.css',
    './firebase-config.js',
    './cards.js',
    './cards1.js',
    './auth.js',
    './auth-manager.js',
    './header.js',
    './collection.js',
    './game.js',
    './marche.js',
    './profil.js',
    './battlepass.js',
    './battlepass-config.js',
    './quest-manager.js',
    './stats-manager.js',
    './toast.js',
    './assets/card-back/dos.png',
    './assets/logo/logo.png'
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
    }).then(() => self.clients.claim()));
});

// Réseau d'abord (pour toujours avoir la dernière version du jeu), cache en secours hors-ligne.
// Seules les requêtes GET de notre propre site passent par le cache (Firebase/Google restent directs).
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(request).then(response => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
            }
            return response;
        }).catch(() => caches.match(request))
    );
});
