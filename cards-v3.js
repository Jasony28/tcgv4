// Fichier: cards-v3.js (Collection V3 — 35 cartes : 9 communes, 10 rares, 9 épiques, 7 légendaires)
//
// Les cartes sont fabriquées avec tools/cardgen à partir des images et du fichier texte des cartes :
//    node import.mjs "<fichier texte>" "<dossier images>"  →  node build.mjs  →  node export.mjs
// export.mjs réécrit la liste ci-dessous. Une carte « upcoming » (image pas encore prête) apparaît
// dans l'album mais ne sort d'aucun booster, boutique ou récompense.
//
// 🚀 SORTIE : V3_RELEASED active la collection partout (boosters, boutique, marché, succès, Pass).
export const V3_RELEASED = true;

// --- LISTE GÉNÉRÉE (tools/cardgen/export.mjs) ---
export const allCardsV3 = [
    { id: 'V3_001', name: "Scarab-Octet", rarity: 'Commune', image: 'assets/cards3/V3_001.webp', version: 'v3' },
    { id: 'V3_002', name: "Drone-Skarab", rarity: 'Commune', image: 'assets/cards3/V3_002.webp', version: 'v3' },
    { id: 'V3_003', name: "Vipère-Fibre", rarity: 'Commune', image: 'assets/cards3/V3_003.webp', version: 'v3' },
    { id: 'V3_004', name: "Harpie-Sonar", rarity: 'Rare', image: 'assets/cards3/V3_004.webp', version: 'v3' },
    { id: 'V3_005', name: "Sentinelle-Arc", rarity: 'Rare', image: 'assets/cards3/V3_005.webp', version: 'v3' },
    { id: 'V3_006', name: "Chimère-Processeur", rarity: 'Rare', image: 'assets/cards3/V3_006.webp', version: 'v3' },
    { id: 'V3_007', name: "Minotaure V8", rarity: 'epique', image: 'assets/cards3/V3_007.webp', version: 'v3' },
    { id: 'V3_008', name: "Sphinx-Plasma", rarity: 'epique', image: 'assets/cards3/V3_008.webp', version: 'v3' },
    { id: 'V3_009', name: "Pégase-Hydraulique", rarity: 'epique', image: 'assets/cards3/V3_009.webp', version: 'v3' },
    { id: 'V3_010', name: "Fenrir Brise-Monde EX", rarity: 'Légendaire', image: 'assets/cards3/V3_010.webp', version: 'v3' },
    { id: 'V3_011', name: "Chronos-Titan EX", rarity: 'Légendaire', image: 'assets/cards3/V3_011.webp', version: 'v3' },
    { id: 'V3_012', name: "Médusolt", rarity: 'Commune', image: 'assets/cards3/V3_012.webp', version: 'v3' },
    { id: 'V3_013', name: "Crabe-Néon", rarity: 'Commune', image: 'assets/cards3/V3_013.webp', version: 'v3' },
    { id: 'V3_014', name: "Anguille-Abysse", rarity: 'Commune', image: 'assets/cards3/V3_014.webp', version: 'v3' },
    { id: 'V3_015', name: "Requin-Prisme", rarity: 'Rare', image: 'assets/cards3/V3_015.webp', version: 'v3' },
    { id: 'V3_016', name: "Raie-Manta Néon", rarity: 'Rare', image: 'assets/cards3/V3_016.webp', version: 'v3' },
    { id: 'V3_017', name: "Calamar-Sonar", rarity: 'Rare', image: 'assets/cards3/V3_017.webp', version: 'v3' },
    { id: 'V3_018', name: "Kraken Vortex", rarity: 'epique', image: 'assets/cards3/V3_018.webp', version: 'v3' },
    { id: 'V3_019', name: "Tortue-Abyssale EX", rarity: 'epique', image: 'assets/cards3/V3_019.webp', version: 'v3' },
    { id: 'V3_020', name: "Sirène des Abysses", rarity: 'epique', image: 'assets/cards3/V3_020.webp', version: 'v3' },
    { id: 'V3_021', name: "Léviathan du Nadir EX", rarity: 'Légendaire', image: 'assets/cards3/V3_021.webp', version: 'v3' },
    { id: 'V3_022', name: "Poséidon des Abysses EX", rarity: 'Légendaire', image: 'assets/cards3/V3_022.webp', version: 'v3' },
    { id: 'V3_023', name: "Louveteau d'Écorce", rarity: 'Commune', image: 'assets/cards3/V3_023.webp', version: 'v3' },
    { id: 'V3_024', name: "Champignon-Sporo", rarity: 'Commune', image: 'assets/cards3/V3_024.webp', version: 'v3' },
    { id: 'V3_025', name: "Ronce-Mordante", rarity: 'Commune', image: 'assets/cards3/V3_025.webp', version: 'v3' },
    { id: 'V3_026', name: "Cerf Braise-Ronce", rarity: 'Rare', image: 'assets/cards3/V3_026.webp', version: 'v3' },
    { id: 'V3_027', name: "Corbeau-Cendre", rarity: 'Rare', image: 'assets/cards3/V3_027.webp', version: 'v3' },
    { id: 'V3_028', name: "Sanglier-Basalte", rarity: 'Rare', image: 'assets/cards3/V3_028.webp', version: 'v3' },
    { id: 'V3_029', name: "Panthère-Roncière", rarity: 'Rare', image: 'assets/cards3/V3_029.webp', version: 'v3' },
    { id: 'V3_030', name: "Golem Cendre-Spore", rarity: 'epique', image: 'assets/cards3/V3_030.webp', version: 'v3' },
    { id: 'V3_031', name: "Chimère Sylvestre EX", rarity: 'epique', image: 'assets/cards3/V3_031.webp', version: 'v3' },
    { id: 'V3_032', name: "Dragon des Cendres", rarity: 'epique', image: 'assets/cards3/V3_032.webp', version: 'v3' },
    { id: 'V3_033', name: "Hydre Éther-Noir EX", rarity: 'Légendaire', image: 'assets/cards3/V3_033.webp', version: 'v3' },
    { id: 'V3_034', name: "Gaia Corrompue EX", rarity: 'Légendaire', image: 'assets/cards3/V3_034.webp', version: 'v3' },
    { id: 'V3_035', name: "Anacore-Apex le Dévoreur", rarity: 'Légendaire', image: 'assets/cards3/V3_035.webp', version: 'v3' }
];
// --- FIN DE LA LISTE GÉNÉRÉE ---

/** Cartes V3 obtenables en jeu (sans les cartes « à venir », et vide tant que la V3 n'est pas sortie). */
export const allCardsV3Released = V3_RELEASED ? allCardsV3.filter(c => !c.upcoming) : [];
