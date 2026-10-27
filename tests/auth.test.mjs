// Tests de server/auth.js sans réseau : les serveurs de Google sont simulés avec des clés générées ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdToken, serviceAccountToken } from '../server/auth.js';

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const algo = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const keys = await crypto.subtle.generateKey({ ...algo, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'cle1', alg: 'RS256', use: 'sig' };

async function sign(payload, header = { alg: 'RS256', kid: 'cle1', typ: 'JWT' }) {
    const unsigned = `${enc(header)}.${enc(payload)}`;
    const sig = await crypto.subtle.sign(algo, keys.privateKey, new TextEncoder().encode(unsigned));
    return `${unsigned}.${Buffer.from(sig).toString('base64url')}`;
}

let tokenRequests = [];
globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'max-age=600' } });
    if (String(url) === 'https://oauth2.googleapis.com/token') {
        tokenRequests.push(String(opts.body));
        return new Response(JSON.stringify({ access_token: 'jeton-google', expires_in: 3600 }));
    }
    throw new Error(`URL inattendue ${url}`);
};

test('jeton du joueur : accepté s\'il est signé par Google pour ce projet', async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = { aud: 'tcgjwbndr', iss: 'https://securetoken.google.com/tcgjwbndr', sub: 'alice', iat: now - 10, exp: now + 3000 };
    assert.equal(await verifyIdToken(await sign(good), 'tcgjwbndr'), 'alice');
    await assert.rejects(verifyIdToken(await sign({ ...good, aud: 'autre' }), 'tcgjwbndr'));
    await assert.rejects(verifyIdToken(await sign({ ...good, exp: now - 5 }), 'tcgjwbndr'));
    await assert.rejects(verifyIdToken(await sign(good, { alg: 'none', kid: 'cle1' }), 'tcgjwbndr'));
    await assert.rejects(verifyIdToken(await sign(good, { alg: 'RS256', kid: 'inconnue' }), 'tcgjwbndr'));
    // Contenu modifié après signature (se faire passer pour quelqu'un d'autre)
    const [h, , s] = (await sign(good)).split('.');
    await assert.rejects(verifyIdToken(`${h}.${enc({ ...good, sub: 'admin' })}.${s}`, 'tcgjwbndr'));
    await assert.rejects(verifyIdToken('nimporte quoi', 'tcgjwbndr'));
});

test('compte de service : assertion signée avec la clé privée', async () => {
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
    const token = await serviceAccountToken(JSON.stringify({ client_email: 'sa@tcgjwbndr.iam.gserviceaccount.com', private_key: pem }));
    assert.equal(token, 'jeton-google');
    const assertion = new URLSearchParams(tokenRequests[0]).get('assertion');
    const [h, p, s] = assertion.split('.');
    const ok = await crypto.subtle.verify(algo, keys.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
    assert.ok(ok);
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'sa@tcgjwbndr.iam.gserviceaccount.com');
});
