// Fichier: header.js (Version avec création dynamique du header)

const headerHTML = `
    <h1 class="game-title-small">JWBnDr</h1>
    <nav>
        <a href="game.html" class="nav-link" id="nav-game">Booster</a>
        <div class="nav-dropdown">
            <a href="#" class="nav-link dropdown-toggle" id="collection-dropdown-btn">Collection</a>
            <div class="dropdown-menu" id="collection-dropdown-menu">
                <a href="collection.html?set=v1" class="dropdown-item">Collection V1</a>
                <a href="collection.html?set=v2" class="dropdown-item">Collection V2</a>
            </div>
        </div>
        <a href="marche.html" class="nav-link" id="nav-marche">Marché</a>
        <a href="battlepass.html" class="nav-link" id="nav-battlepass">Battle Pass</a>
    </nav>
    <div class="user-info">
      <a href="profil.html" id="profil-link"><span id="user-pseudo">...</span></a>
        <div id="coin-balance"><span id="coin-amount">--</span> 🪙</div>
        <button id="logout-button">Déconnexion</button>
    </div>
`;

function loadHeader() {
    const headerElement = document.querySelector('.main-header');
    if (headerElement) {
        headerElement.innerHTML = headerHTML;
        
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
    
    if (currentPage === 'game.html') document.getElementById('nav-game')?.classList.add('active');
    if (currentPage === 'marche.html') document.getElementById('nav-marche')?.classList.add('active');
    if (currentPage === 'battlepass.html') document.getElementById('nav-battlepass')?.classList.add('active');
    if (currentPage === 'collection.html') document.getElementById('collection-dropdown-btn')?.classList.add('active');
    if (currentPage === 'profil.html') document.getElementById('profil-link')?.classList.add('active');
}


// Exécute les fonctions au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    loadHeader();
    setActiveNavLink();
});