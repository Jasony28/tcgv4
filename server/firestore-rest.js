// Fichier: server/firestore-rest.js — Firestore pour le serveur (Cloudflare Worker), par l'API REST.
// Imite les fonctions du SDK Firebase utilisées par les services du jeu (doc, runTransaction, increment…) :
// le même code (shop-service.js, market-service.js…) tourne ainsi sur le serveur, avec les droits
// d'administrateur (compte de service), sans passer par les règles de sécurité.

const MAX_TRANSACTION_TRIES = 5;

// ---------- Connexion ----------

let conn = null; // { base: 'https://…/documents', root: 'projects/p/databases/(default)/documents', token: async () => string }

/** Configure la base : project, getToken (jeton OAuth du compte de service), host (émulateur pour les tests) */
export function configureFirestore({ project, getToken, host = 'https://firestore.googleapis.com' }) {
    const root = `projects/${project}/databases/(default)/documents`;
    conn = { root, base: `${host}/v1/${root}`, host, getToken };
}

async function api(path, body) {
    if (!conn) throw new Error('Firestore non configuré');
    const url = path.startsWith('http') ? path : `${conn.host}/v1/${path}`;
    const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${await conn.getToken()}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
        const err = new Error(json.error?.message || `Firestore ${res.status}`);
        err.status = json.error?.status || res.status;
        throw err;
    }
    return json;
}

// ---------- Références ----------

class DocRef {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); this.type = 'document'; }
    get name() { return `${conn.root}/${this.path}`; }
}
class CollRef {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); this.type = 'collection'; }
}
const AUTO_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function autoId() {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes, b => AUTO_ID[b % AUTO_ID.length]).join('');
}

/** doc(db, 'users', uid) · doc(collectionRef) (identifiant automatique) · doc(collectionRef, id) */
export function doc(parent, ...segments) {
    if (parent instanceof CollRef) return new DocRef(`${parent.path}/${segments.length ? segments.join('/') : autoId()}`);
    return new DocRef(segments.join('/'));
}
export function collection(parent, ...segments) {
    if (parent instanceof DocRef) return new CollRef(`${parent.path}/${segments.join('/')}`);
    return new CollRef(segments.join('/'));
}

// ---------- Valeurs spéciales ----------

class Sentinel { constructor(kind, value) { this.kind = kind; this.value = value; } }
export const increment = (n) => new Sentinel('increment', n);
export const serverTimestamp = () => new Sentinel('serverTimestamp');
export const arrayUnion = (...v) => new Sentinel('arrayUnion', v);
export const arrayRemove = (...v) => new Sentinel('arrayRemove', v);
export const deleteField = () => new Sentinel('delete');

export class Timestamp {
    constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
    static now() { return Timestamp.fromMillis(Date.now()); }
    static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)); }
    static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
    toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
    toDate() { return new Date(this.toMillis()); }
    isEqual(o) { return o instanceof Timestamp && o.seconds === this.seconds && o.nanoseconds === this.nanoseconds; }
    valueOf() { return String(this.toMillis()).padStart(16, '0'); }
}

// ---------- Conversion JS ⇄ Firestore ----------

function encode(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (v instanceof Timestamp) return { timestampValue: v.toDate().toISOString() };
    if (v instanceof Date) return { timestampValue: v.toISOString() };
    if (v instanceof DocRef) return { referenceValue: v.name };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
    if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
    throw new Error(`Valeur non prise en charge : ${v}`);
}
function encodeFields(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (!(v instanceof Sentinel)) out[k] = encode(v);
    return out;
}
function decode(v) {
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('stringValue' in v) return v.stringValue;
    if ('timestampValue' in v) return Timestamp.fromMillis(Date.parse(v.timestampValue));
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
    if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
    if ('referenceValue' in v) return new DocRef(v.referenceValue.split('/documents/')[1]);
    return null;
}
function decodeFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = decode(v);
    return out;
}

class Snapshot {
    constructor(ref, raw) { this.ref = ref; this.id = ref.id; this._raw = raw || null; }
    exists() { return this._raw !== null; }
    // Nouvelle copie à chaque appel (comme le SDK), avec de vrais Timestamp
    data() { return this._raw === null ? undefined : decodeFields(this._raw.fields || {}); }
}

// Chemin de champ : chaque morceau qui n'est pas un identifiant simple est entre accents graves
const quote = (seg) => /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(seg) ? seg : '`' + seg.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
const fieldPath = (dotted) => dotted.split('.').map(quote).join('.');

/** Valeurs spéciales (increment…) d'une valeur, avec leur chemin complet */
function collectTransforms(prefix, value, out) {
    if (value instanceof Sentinel) {
        if (value.kind !== 'delete') out.push([prefix, value]);
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Timestamp) && !(value instanceof Date) && !(value instanceof DocRef)) {
        for (const [k, v] of Object.entries(value)) collectTransforms(`${prefix}.${quote(k)}`, v, out);
    }
    return out;
}
function transformOf(path, s) {
    if (s.kind === 'increment') return { fieldPath: path, increment: encode(s.value) };
    if (s.kind === 'serverTimestamp') return { fieldPath: path, setToServerValue: 'REQUEST_TIME' };
    if (s.kind === 'arrayUnion') return { fieldPath: path, appendMissingElements: { values: s.value.map(encode) } };
    return { fieldPath: path, removeAllFromArray: { values: s.value.map(encode) } };
}

/** Mise à jour partielle (update) : clés « a.b.c » comme dans le SDK */
function updateWrite(ref, data) {
    const fields = {};
    const mask = [];
    const transforms = [];
    for (const [key, value] of Object.entries(data)) {
        const path = fieldPath(key);
        if (value instanceof Sentinel && value.kind !== 'delete') { transforms.push(transformOf(path, value)); continue; }
        mask.push(path);
        if (value instanceof Sentinel) continue; // deleteField : dans le masque, absent des champs → supprimé
        // Construit l'arbre a → b → c = valeur
        const segs = key.split('.');
        let node = fields;
        for (let i = 0; i < segs.length - 1; i++) {
            node[segs[i]] = node[segs[i]] || { mapValue: { fields: {} } };
            node = node[segs[i]].mapValue.fields;
        }
        node[segs[segs.length - 1]] = encode(value);
        for (const [p, s] of collectTransforms(path, value, [])) if (p !== path) transforms.push(transformOf(p, s));
    }
    return {
        update: { name: ref.name, fields },
        updateMask: { fieldPaths: mask },
        ...(transforms.length ? { updateTransforms: transforms } : {}),
        currentDocument: { exists: true }
    };
}
/** Écriture complète (set), ou fusion (set … { merge: true }) */
function setWrite(ref, data, options = {}) {
    if (options.merge) {
        const w = updateWrite(ref, flatten(data));
        delete w.currentDocument;
        return w;
    }
    const transforms = [];
    for (const [k, v] of Object.entries(data)) for (const t of collectTransforms(quote(k), v, [])) transforms.push(transformOf(...t));
    return { update: { name: ref.name, fields: encodeFields(data) }, ...(transforms.length ? { updateTransforms: transforms } : {}) };
}
function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Sentinel) && !(v instanceof Timestamp) && !(v instanceof Date)) flatten(v, key, out);
        else out[key] = v;
    }
    return out;
}

// ---------- Lectures ----------

// Lecture par batchGet (la lecture simple GET ?transaction=… ne répond pas dans l'émulateur)
async function readDoc(ref, transaction) {
    const rows = await api(`${conn.base}:batchGet`, { documents: [ref.name], ...(transaction ? { transaction } : {}) });
    const row = rows.find(r => r.found || r.missing);
    return new Snapshot(ref, row?.found || null);
}
export const getDoc = (ref) => readDoc(ref);

// Requêtes : query(collection, where(...), orderBy(...), limit(n))
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = (n) => ({ kind: 'limit', n });
export const query = (coll, ...parts) => ({ coll, parts });

const OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS', 'in': 'IN', 'array-contains-any': 'ARRAY_CONTAINS_ANY' };

export async function getDocs(q) {
    const { coll, parts } = q instanceof CollRef ? { coll: q, parts: [] } : q;
    const segs = coll.path.split('/');
    const collectionId = segs.pop();
    const parent = segs.length ? `${conn.base}/${segs.join('/')}` : conn.base;
    const filters = parts.filter(p => p.kind === 'where').map(p => ({
        fieldFilter: { field: { fieldPath: fieldPath(p.field) }, op: OPS[p.op], value: encode(p.value) }
    }));
    const structuredQuery = { from: [{ collectionId }] };
    if (filters.length === 1) structuredQuery.where = filters[0];
    if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    const orders = parts.filter(p => p.kind === 'orderBy');
    if (orders.length) structuredQuery.orderBy = orders.map(o => ({ field: { fieldPath: fieldPath(o.field) }, direction: o.dir === 'desc' ? 'DESCENDING' : 'ASCENDING' }));
    const lim = parts.find(p => p.kind === 'limit');
    if (lim) structuredQuery.limit = lim.n;
    const rows = await api(`${parent}:runQuery`, { structuredQuery });
    const docs = rows.filter(r => r.document).map(r => new Snapshot(new DocRef(r.document.name.split('/documents/')[1]), r.document));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

// ---------- Écritures ----------

const commit = (writes, transaction) => api(`${conn.base}:commit`, { writes, ...(transaction ? { transaction } : {}) });

export const updateDoc = (ref, data) => commit([updateWrite(ref, data)]);
export const setDoc = (ref, data, options) => commit([setWrite(ref, data, options)]);
export async function addDoc(coll, data) {
    const ref = doc(coll);
    await commit([setWrite(ref, data)]);
    return ref;
}

export function writeBatch() {
    const writes = [];
    return {
        set(ref, data, options) { writes.push(setWrite(ref, data, options)); return this; },
        update(ref, data) { writes.push(updateWrite(ref, data)); return this; },
        delete(ref) { writes.push({ delete: ref.name }); return this; },
        commit: () => writes.length ? commit(writes) : Promise.resolve()
    };
}

/** Transaction : lectures verrouillées, écritures envoyées ensemble à la fin ; rejouée si conflit */
export async function runTransaction(_db, fn) {
    for (let attempt = 1; ; attempt++) {
        const { transaction } = await api(`${conn.base}:beginTransaction`, { options: { readWrite: {} } });
        const writes = [];
        const t = {
            get: (ref) => readDoc(ref, transaction),
            set(ref, data, options) { writes.push(setWrite(ref, data, options)); return t; },
            update(ref, data) { writes.push(updateWrite(ref, data)); return t; },
            delete(ref) { writes.push({ delete: ref.name }); return t; }
        };
        let result;
        try {
            result = await fn(t);
        } catch (e) {
            await api(`${conn.base}:rollback`, { transaction }).catch(() => {});
            if (e.status === 'ABORTED' && attempt < MAX_TRANSACTION_TRIES) continue;
            throw e;
        }
        try {
            await commit(writes, transaction);
            return result;
        } catch (e) {
            if (e.status !== 'ABORTED' || attempt >= MAX_TRANSACTION_TRIES) throw e;
        }
    }
}

/** L'objet « db » attendu par les services (firebase-config.js) */
export const db = { type: 'firestore-rest' };
