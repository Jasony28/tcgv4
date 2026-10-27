// Fichier: server/auth.js — identités côté serveur (Cloudflare Worker, WebCrypto)
//  - verifyIdToken : vérifie le jeton Firebase envoyé par le jeu (le joueur est bien connecté, et c'est bien lui)
//  - serviceAccountToken : jeton d'accès Google du compte de service (droits d'administrateur sur Firestore)

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
function fromB64url(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// ---------- Jeton du joueur ----------

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, until: 0 };

async function publicKey(kid) {
    if (!jwksCache.keys || Date.now() > jwksCache.until) {
        const res = await fetch(JWKS_URL);
        if (!res.ok) throw new Error('Clés Google indisponibles');
        const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
        jwksCache = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
    }
    const jwk = jwksCache.keys.find(k => k.kid === kid);
    if (!jwk) throw new Error('Clé de signature inconnue');
    return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/** Renvoie l'identifiant du joueur (uid) si le jeton est valide pour ce projet, sinon lève une erreur */
export async function verifyIdToken(token, projectId) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Jeton invalide');
    const header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (header.alg !== 'RS256') throw new Error('Jeton invalide');
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await publicKey(header.kid), fromB64url(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now = Math.floor(Date.now() / 1000);
    if (!ok) throw new Error('Signature invalide');
    if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Jeton d\'un autre projet');
    if (!(payload.exp > now) || !(payload.iat <= now + 300) || !payload.sub) throw new Error('Jeton expiré');
    return payload.sub;
}

// ---------- Compte de service ----------

let saCache = { token: null, until: 0 };

async function importPrivateKey(pem) {
    const der = fromB64url(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_'));
    return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Jeton d'accès OAuth (valable 1 h, gardé en cache) pour le compte de service JSON */
export async function serviceAccountToken(serviceAccountJson) {
    if (saCache.token && Date.now() < saCache.until) return saCache.token;
    const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
        iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
    })}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importPrivateKey(sa.private_key), new TextEncoder().encode(unsigned));
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(sig)}`
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Compte de service refusé : ${json.error_description || json.error}`);
    saCache = { token: json.access_token, until: Date.now() + (json.expires_in - 120) * 1000 };
    return saCache.token;
}
