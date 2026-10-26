// Fichier: service-worker.js

const CACHE_NAME = 'tcg-gemini-cache-v9.4.0';
// Images (cartes, boosters…) : cache à part, conservé entre les mises à jour du jeu.
// Changer ce nom force le re-téléchargement des images (à faire si une image change sans changer de nom).
const IMAGE_CACHE = 'tcg-images-v2';

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
    './market-service.js',
    './trade-service.js',
    './main.css',
    './firebase-config.js',
    './cards.js',
    './cards1.js',
    './cards-v3.js',
    './booster-draws.js',
    './booster-animation.js',
    './shop-service.js',
    './inventory-service.js',
    './series-config.js',
    './auth.js',
    './auth-manager.js',
    './header.js',
    './splash.js',
    './inventaire.html',
    './sfx.js',
    './chat.js',
    './clan.html',
    './clan.js',
    './clan-service.js',
    './player-level.js',
    './settings.js',
    './assets/cards3/V3_010.webp',
    './assets/cards3/V3_021.webp',
    './assets/cards3/V3_034.webp',
    './collection.js',
    './game.js',
    './marche.js',
    './history-service.js',
    './profil.js',
    './battlepass.js',
    './battlepass-config.js',
    './quest-manager.js',
    './stats-manager.js',
    './toast.js',
    './assets/card-back/dos.webp',
    './assets/logo/logo.webp'
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
            cacheNames.filter(name => name !== CACHE_NAME && name !== IMAGE_CACHE).map(name => caches.delete(name))
        );
    }).then(() => self.clients.claim()));
});

// Seules les requêtes GET de notre propre site passent par le cache (Firebase/Google restent directs).
//  - Images : cache d'abord → affichage instantané, téléchargées une seule fois.
//  - Pages et code : réseau d'abord (toujours la dernière version), mais si le réseau met plus de
//    4 secondes on affiche la version en cache pour ne pas bloquer le joueur.
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    if (url.pathname.includes('/assets/')) {
        event.respondWith(caches.open(IMAGE_CACHE).then(cache => cache.match(request).then(hit => hit || fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
        }))));
        return;
    }

    const network = fetch(request).then(response => {
        if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
    });
    const slow = new Promise(resolve => setTimeout(resolve, 4000)).then(() => caches.match(request)).then(hit => hit || network);
    event.respondWith(Promise.race([network.catch(() => caches.match(request)), slow]));
});
