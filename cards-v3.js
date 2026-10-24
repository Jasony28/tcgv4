// Fichier: cards-v3.js (Collection V3 — 50 cartes)
//
// ⚠️ CARTES PROVISOIRES : remplace les noms et les images quand les illustrations sont prêtes.
//    Les images vont dans assets/cards3/ (les .svg actuels sont des cartes "à venir" générées).
//    Tu peux garder les mêmes noms de fichier, ou changer le champ "image" (ex: 'assets/cards3/Raph.png').
//
// 🚀 SORTIE : tant que V3_RELEASED vaut false, l'album V3 est visible en aperçu mais ses cartes
//    ne sortent nulle part (boutique, boosters, marché, succès). Passe-le à true pour tout activer.
export const V3_RELEASED = false;

// Répartition : 22 communes, 14 rares, 8 épiques, 6 légendaires = 50 cartes
const DISTRIBUTION = [
    { rarity: 'Commune', prefix: 'C', label: 'Commune', count: 22 },
    { rarity: 'Rare', prefix: 'R', label: 'Rare', count: 14 },
    { rarity: 'epique', prefix: 'E', label: 'Épique', count: 8 },
    { rarity: 'Légendaire', prefix: 'L', label: 'Légendaire', count: 6 }
];

// Cartes terminées : remplacent la carte provisoire du même id
const FINISHED = {
    V3_L01: { name: 'Fenrir', image: 'assets/cards3/Fenrir.png' }
};

export const allCardsV3 = DISTRIBUTION.flatMap(({ rarity, prefix, label, count }) =>
    Array.from({ length: count }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return {
            id: `V3_${prefix}${n}`,
            name: `${label} V3 n°${n}`,            // ← à remplacer par le vrai nom
            rarity,
            image: `assets/cards3/V3_${prefix}${n}.svg`, // ← à remplacer par la vraie image
            version: 'v3',
            ...FINISHED[`V3_${prefix}${n}`]
        };
    })
);

/** Cartes V3 obtenables en jeu (vide tant que la V3 n'est pas sortie). */
export const allCardsV3Released = V3_RELEASED ? allCardsV3 : [];
