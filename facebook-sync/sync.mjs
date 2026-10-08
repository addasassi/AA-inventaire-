/* =====================================================================
   Atelier Stock → Albums de la page Facebook (synchro automatique)
   - Lit les produits dans Firestore (même base que l'app).
   - Chaque pièce EN STOCK (photo de vitrine + chaque couleur, qty > 0)
     a une photo dans l'album Facebook de sa catégorie, avec nom, prix
     et code dans la légende.
   - Pièce épuisée / supprimée → sa photo est retirée de l'album.
   - Prix, nom, photo ou catégorie changés → la photo est remplacée.
   Les albums ne peuvent pas être créés par l'API Facebook : il faut un
   album par catégorie, créé une fois à la main, avec le même nom que
   la catégorie dans Atelier Stock.
   Tourne dans GitHub Actions (voir .github/workflows/facebook-sync.yml).
   ===================================================================== */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GRAPH = 'https://graph.facebook.com/v21.0';
const FIREBASE_PROJECT = 'aa-inventaire';
const FIREBASE_KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const STATE_FILE = new URL('./state.json', import.meta.url);
const MARK = '🔖 الكود:';            // repère des photos gérées par la synchro
const MAX_UPLOADS_PER_RUN = 60;       // le reste passe à la synchro suivante

const TOKEN = process.env.FB_PAGE_TOKEN;
if (!TOKEN) {
  console.log('FB_PAGE_TOKEN absent : synchro Facebook pas encore configurée.');
  process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const fbErr = j => (j && j.error) ? `${j.error.message} (code ${j.error.code})` : '';

/* ---------- Firestore (lecture REST) ---------- */
function fsValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return fsFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue);
  return null;
}
function fsFields(f) {
  const o = {};
  for (const k of Object.keys(f)) o[k] = fsValue(f[k]);
  return o;
}
async function readProducts() {
  const out = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/products`
      + `?pageSize=50&key=${FIREBASE_KEY}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('Firestore ' + r.status + ' ' + (await r.text()).slice(0, 300));
    const j = await r.json();
    (j.documents || []).forEach(d => out.push(fsFields(d.fields || {})));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  // le produit ne garde qu'une miniature : on remet la photo complète (photos/{imgId})
  const fnv = s => { s = String(s || ''); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); };
  for (const p of out) {
    for (const o of [p, ...(p.colors || []).filter(Boolean)]) {
      if (!(o.imgId && o.img && o.imgTh && fnv(o.img) === o.imgTh)) continue;
      try {
        const r = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/photos/${o.imgId}?key=${FIREBASE_KEY}`);
        if (r.ok) { const d = fsFields((await r.json()).fields || {}); if (d.d) o.img = d.d; }
      } catch (e) {}
    }
  }
  return out;
}

/* ---------- Pièces en stock attendues sur Facebook ---------- */
function money(n) {
  return Number(n || 0).toLocaleString('fr-FR').replace(/ | /g, ' ');
}
function caption(p, piece) {
  const title = piece.colorName ? `${p.name} — ${piece.colorName}` : p.name;
  return [
    `✨ ${title}`,
    `💰 السعر: ${money(piece.price)} دج`,
    `🚚 التوصيل لـ 58 ولاية — الدفع عند الاستلام`,
    `💌 للطلب: ابعثيلنا هاذ الصورة في المسنجر`,
    `${MARK} ${piece.code}`
  ].join('\n');
}
function expectedPieces(products) {
  const list = [];
  for (const p of products) {
    if (!p || !p.id || !p.cat) continue;
    const pieces = [{ img: p.img, qty: p.qty, price: p.price, code: p.code, colorName: p.colorName }];
    (p.colors || []).forEach((c, i) => {
      if (!c) return;
      pieces.push({
        img: c.img, qty: c.qty,
        price: (c.price != null && c.price !== '') ? c.price : p.price,
        code: c.code || `${p.id}-${i + 1}`,
        colorName: c.name || ''
      });
    });
    for (const piece of pieces) {
      if (!piece.img || !String(piece.img).startsWith('data:image') || (Number(piece.qty) || 0) <= 0) continue;
      const key = String(piece.code || '').trim();
      if (!key) continue;
      const cap = caption(p, piece);
      const imgHash = createHash('sha1').update(piece.img).digest('hex').slice(0, 16);
      list.push({ key, cat: p.cat, img: piece.img, caption: cap,
        sig: createHash('sha1').update(cap + '|' + imgHash + '|' + norm(p.cat)).digest('hex').slice(0, 16) });
    }
  }
  // un code peut exister deux fois par erreur : on garde la première pièce
  const seen = new Set();
  return list.filter(x => !seen.has(x.key) && seen.add(x.key));
}

/* ---------- Facebook ---------- */
async function fbGet(path) {
  const r = await fetch(`${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`);
  const j = await r.json();
  if (j.error) throw new Error(fbErr(j));
  return j;
}
async function fbGetAll(path) {
  let j = await fbGet(path);
  const out = [...(j.data || [])];
  while (j.paging && j.paging.next) {
    const r = await fetch(j.paging.next);
    j = await r.json();
    if (j.error) throw new Error(fbErr(j));
    out.push(...(j.data || []));
  }
  return out;
}
async function fbDelete(id) {
  const r = await fetch(`${GRAPH}/${id}?access_token=${encodeURIComponent(TOKEN)}`, { method: 'DELETE' });
  const j = await r.json().catch(() => ({}));
  // photo déjà supprimée à la main → on considère que c'est bon
  if (j.error && j.error.code !== 100) throw new Error(fbErr(j));
}
async function fbUpload(albumId, item) {
  const m = item.img.match(/^data:(image\/[a-z+]+);base64,(.*)$/s);
  if (!m) throw new Error('image invalide');
  const fd = new FormData();
  fd.append('source', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), item.key + '.jpg');
  fd.append('caption', item.caption);
  fd.append('no_story', 'true');      // ne pas inonder le fil d'actualité
  fd.append('access_token', TOKEN);
  const r = await fetch(`${GRAPH}/${albumId}/photos`, { method: 'POST', body: fd });
  const j = await r.json();
  if (j.error || !j.id) throw new Error(fbErr(j) || 'upload échoué');
  return j.id;
}

/* ---------- Synchro ---------- */
async function main() {
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { items: {} };
  state.items = state.items || {};
  const status = { lastRun: new Date().toISOString(), ok: true, added: 0, removed: 0, replaced: 0,
    pending: 0, inStock: 0, missingAlbums: [], errors: [] };

  const page = await fbGet('me?fields=id,name');
  status.page = page.name;
  const albums = await fbGetAll(`${page.id}/albums?fields=id,name&limit=100`);
  const albumByCat = cat => (albums.find(a => norm(a.name) === norm(cat)) || {}).id;

  const products = await readProducts();
  if (!products.length) throw new Error('Aucun produit lu dans Firestore — synchro annulée par sécurité');
  const wanted = expectedPieces(products);
  status.inStock = wanted.length;
  const wantedByKey = new Map(wanted.map(w => [w.key, w]));

  // 1) retirer ce qui n'est plus en stock / a changé
  for (const [key, rec] of Object.entries(state.items)) {
    const w = wantedByKey.get(key);
    const albumId = w && albumByCat(w.cat);
    if (w && albumId === rec.albumId && w.sig === rec.sig) continue;
    try {
      await fbDelete(rec.photoId);
      delete state.items[key];
      if (w) status.replaced++; else status.removed++;
    } catch (e) { status.errors.push(`suppression ${key}: ${e.message}`); }
    await sleep(300);
  }

  // 2) ajouter les pièces en stock qui manquent
  let uploads = 0;
  const missing = new Set();
  for (const w of wanted) {
    if (state.items[w.key]) continue;
    const albumId = albumByCat(w.cat);
    if (!albumId) { missing.add(w.cat); continue; }
    if (uploads >= MAX_UPLOADS_PER_RUN) { status.pending++; continue; }
    try {
      const photoId = await fbUpload(albumId, w);
      state.items[w.key] = { photoId, albumId, sig: w.sig };
      uploads++;
    } catch (e) { status.errors.push(`ajout ${w.key}: ${e.message}`); }
    await sleep(1200);
  }
  status.added = Math.max(0, uploads - status.replaced);
  status.missingAlbums = [...missing];

  // 3) nettoyage : photos marquées « 🔖 الكود » qui ne sont plus suivies (doublons, ancien état perdu)
  const tracked = new Set(Object.values(state.items).map(r => r.photoId));
  const managedAlbumIds = new Set(wanted.map(w => albumByCat(w.cat)).filter(Boolean));
  Object.values(state.items).forEach(r => managedAlbumIds.add(r.albumId));
  for (const albumId of managedAlbumIds) {
    try {
      const photos = await fbGetAll(`${albumId}/photos?fields=id,name&limit=100`);
      for (const ph of photos) {
        if (tracked.has(ph.id) || !String(ph.name || '').includes(MARK)) continue;
        await fbDelete(ph.id); status.removed++; await sleep(300);
      }
    } catch (e) { status.errors.push(`nettoyage album ${albumId}: ${e.message}`); }
  }

  if (status.errors.length) status.ok = false;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n');
  console.log(JSON.stringify(status, null, 1));
  if (status.missingAlbums.length) console.log('⚠️ Albums à créer sur la page : ' + status.missingAlbums.join(', '));
  if (!status.ok) process.exitCode = 1;   // erreurs visibles dans GitHub Actions
}

main().catch(e => {
  console.error('Synchro Facebook échouée :', e.message);
  process.exit(1);
});
