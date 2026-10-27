# Mettre en ligne le serveur anti-triche (Cloudflare, gratuit)

Depuis cette version, **toute l'économie du jeu est calculée par un serveur** (dossier `server/`) :
tirage des cartes des boosters, prix de la boutique, ventes à la console, récompenses du Pass et des succès,
quêtes, marché, échanges et dons de clan. Les règles Firestore interdisent aux joueurs de modifier
eux-mêmes leurs pièces, cartes, boosters, quêtes ou statistiques : même en bidouillant le jeu dans le
navigateur, il n'y a plus rien à tricher.

Le serveur tourne sur **Cloudflare Workers** : gratuit (100 000 actions par jour), sans carte bancaire.

## 1. Créer le compte Cloudflare (5 minutes, une seule fois)

1. Va sur <https://dash.cloudflare.com/sign-up> et crée un compte (adresse e-mail + mot de passe).
2. Dans le menu de gauche : **Workers & Pages**. Cloudflare te demande de choisir un sous-domaine
   (par exemple `jwbndr`) : ton serveur aura l'adresse `https://tcg-serveur.jwbndr.workers.dev`.
3. Note l'**Account ID** affiché à droite de la page Workers & Pages.
4. En haut à droite : ton profil → **My Profile** → **API Tokens** → **Create Token** →
   modèle **Edit Cloudflare Workers** → **Use template** → **Continue to summary** → **Create Token**.
   Copie le jeton (il ne s'affiche qu'une fois).

## 2. Donner ces deux informations à GitHub

Dépôt `tcgv4` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** :

| Nom | Valeur |
|---|---|
| `CLOUDFLARE_API_TOKEN` | le jeton de l'étape 1.4 |
| `CLOUDFLARE_ACCOUNT_ID` | l'Account ID de l'étape 1.3 |

(`FIREBASE_SERVICE_ACCOUNT` existe déjà : le serveur l'utilise pour écrire dans Firestore.)

## 3. Déployer le serveur

Dépôt `tcgv4` → onglet **Actions** → **Serveur du jeu** → **Run workflow** (choisir la branche) → **Run workflow**.
À la fin, le résumé affiche **l'adresse du serveur**. Recopie-la dans `server-config.js` :

```js
export const SERVER_URL = 'https://tcg-serveur.jwbndr.workers.dev';
```

## 4. Mettre le jeu à jour

Fusionne la branche dans `main` : GitHub met en ligne le jeu, et le workflow **Règles Firestore**
teste puis publie les nouvelles règles (il refuse de les publier tant que `server-config.js` n'a pas
la vraie adresse, pour ne pas bloquer le jeu). Demande ensuite aux joueurs de recharger la page.

## Pour tester ou modifier

- Tests (émulateur Firebase, Java nécessaire) : `cd tests && npm install && npm test`
- Les prix, tirages et récompenses restent réglés dans les mêmes fichiers qu'avant
  (`shop-config.js`, `booster-draws.js`, `battlepass-config.js`, `achievements-config.js`…) :
  le serveur réutilise ce code. Après une modification sur `main`, il se redéploie tout seul.
