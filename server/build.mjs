// Fichier: server/build.mjs — assemble le serveur en un seul fichier (dist/worker.js) avec esbuild.
// Le code du jeu (services) est réutilisé tel quel : le SDK Firebase du navigateur est remplacé par
// firestore-rest.js, et firebase-config.js par db.js.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js';

const swap = {
    name: 'serveur',
    setup(b) {
        b.onResolve({ filter: /^https:\/\/www\.gstatic\.com\// }, (args) => {
            if (args.path === FIRESTORE_SDK) return { path: here('./firestore-rest.js') };
            return { errors: [{ text: `Module navigateur interdit sur le serveur : ${args.path} (importé par ${args.importer})` }] };
        });
        b.onResolve({ filter: /^\.\.?\/firebase-config\.js$/ }, () => ({ path: here('./db.js') }));
        b.onResolve({ filter: /^\.\/(toast|sfx)\.js$/ }, (args) => ({ errors: [{ text: `Module d'interface interdit sur le serveur : ${args.path} (importé par ${args.importer})` }] }));
    }
};

await build({
    entryPoints: [here('./worker.js')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    outfile: here('./dist/worker.js'),
    plugins: [swap],
    logLevel: 'info'
});
