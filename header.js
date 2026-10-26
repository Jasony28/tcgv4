// Fichier: header.js (Version avec création dynamique du header)
import { openSettings } from './settings.js';
import './chat.js';

// Icônes SVG (trait, couleur = currentColor)
const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
    booster: icon('<path d="M7 2.5h10l1.5 3-1 16h-11l-1-16z"/><path d="M5.5 5.5h13"/><path d="M12 9.5l2.2 3.2L12 16l-2.2-3.3z"/>'),
    collection: icon('<rect x="3" y="6" width="12" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>'),
    market: icon('<path d="M3.5 9 5 4h14l1.5 5"/><path d="M4.5 9v11h15V9"/><path d="M3 9h18"/><path d="M9.5 20v-5.5h5V20"/>'),
    pass: icon('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
    profile: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    shop: icon('<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    logout: icon('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/>')
};

// Barre du haut (dans <header class="main-header">)
const headerHTML = `
    <a href="game.html" class="brand">
        <img src="assets/logo/logo.webp" alt="">
        <h1 class="game-title-small">JWBnDr</h1>
    </a>
    <div class="topbar-user">
        <a href="profil.html" class="pseudo-chip" id="profil-link">${icons.profile}<span id="user-pseudo">...</span><span class="level-chip" id="user-level" hidden></span></a>
        <div id="coin-balance"><span class="coin-icon"></span><span id="coin-amount">--</span></div>
        <button id="settings-button" class="round-icon-button" title="Paramètres" aria-label="Paramètres">${icons.settings}</button>
        <button id="logout-button" title="Déconnexion" aria-label="Déconnexion">${icons.logout}</button>
    </div>
`;

// Barre d'onglets du bas (mobile / PWA)
const tabbarHTML = `
    <a href="game.html" class="nav-link" id="nav-game">${icons.booster}<span>Booster</span></a>
    <a href="boutique.html" class="nav-link" id="nav-boutique">${icons.shop}<span>Boutique</span></a>
    <div class="nav-dropdown">
        <a href="#" class="nav-link dropdown-toggle" id="collection-dropdown-btn">${icons.collection}<span>Collection</span></a>
        <div class="dropdown-menu" id="collection-dropdown-menu">
            <a href="collection.html?set=v1" class="dropdown-item">Collection V1</a>
            <a href="collection.html?set=v2" class="dropdown-item">Collection V2</a>
            <a href="collection.html?set=v3" class="dropdown-item">Collection V3 <span class="soon-tag">Nouveau</span></a>
        </div>
    </div>
    <a href="marche.html" class="nav-link" id="nav-marche">${icons.market}<span>Marché</span></a>
    <a href="battlepass.html" class="nav-link" id="nav-battlepass">${icons.pass}<span>Pass</span></a>
`;

function loadHeader() {
    const headerElement = document.querySelector('.main-header');
    if (headerElement) {
        headerElement.innerHTML = headerHTML;

        const tabbar = document.createElement('nav');
        tabbar.className = 'tabbar';
        tabbar.innerHTML = tabbarHTML;
        document.body.appendChild(tabbar);
        document.getElementById('settings-button').addEventListener('click', openSettings);

        // Logique pour le menu déroulant
        const dropdownBtn = document.getElementById('collection-dropdown-btn');
        const dropdownMenu = document.getElementById('collection-dropdown-menu');

        if (dropdownBtn && dropdownMenu) {
            dropdownBtn.addEventListener('click', (event) => {
                event.preventDefault(); 
                event.stopPropagation(); 
                dropdownMenu.classList.toggle('show');
            });

            window.addEventListener('click', () => {
                if (dropdownMenu.classList.contains('show')) {
                    dropdownMenu.classList.remove('show');
                }
            });
        }
    }
}

// Détermine la page active et ajoute la classe 'active' au bon lien
function setActiveNavLink() {
    const currentPage = window.location.pathname.split('/').pop();
    
    if (currentPage === 'game.html' || currentPage === 'inventaire.html') document.getElementById('nav-game')?.classList.add('active');
    if (currentPage === 'boutique.html') document.getElementById('nav-boutique')?.classList.add('active');
    if (currentPage === 'marche.html') document.getElementById('nav-marche')?.classList.add('active');
    if (currentPage === 'battlepass.html') document.getElementById('nav-battlepass')?.classList.add('active');
    if (currentPage === 'collection.html') document.getElementById('collection-dropdown-btn')?.classList.add('active');
    if (currentPage === 'profil.html') document.getElementById('profil-link')?.classList.add('active');
}


// Exécute les fonctions dès que le DOM est prêt. Les scripts "module" s'exécutent après
// l'analyse du HTML : on insère le header tout de suite, sinon auth-manager pouvait écrire
// le pseudo/les pièces avant que le header existe (il restait alors sur "..." / "--").
function initHeader() {
    loadHeader();
    setActiveNavLink();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeader);
} else {
    initHeader();
}