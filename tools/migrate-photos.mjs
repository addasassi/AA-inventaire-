/* =====================================================================
   Migration ponctuelle des photos (lancée une fois par GitHub Actions)
   1) Sauvegarde : copie de chaque produit et commande dans backup_*_20261008
   2) Produits : chaque grande photo → photos/{id} (vérifiée), le produit garde
      une miniature + imgId / imgTh / imgH (même format que l'app).
   3) Commandes : les photos des articles deviennent des miniatures (affichage seul).
   Chaque écriture est conditionnée à la date de mise à jour du document :
   si quelqu'un le modifie entre-temps, on relit et on recommence ce document.
   Le rapport (chiffres seulement) est écrit dans meta/photoMigration.
   ===================================================================== */
import sharp from 'sharp';
import { createHash } from 'node:crypto';

const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const DB = 'projects/aa-inventaire/databases/(default)';
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`;
const TAG = '20261008';
const fnv = s => { s = String(s || ''); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); };
const str = v => v && v.stringValue;
const sv = s => ({ stringValue: s });

async function listAll(col) {
  const out = []; let tok = '';
  do {
    const r = await fetch(`${BASE}/${col}?pageSize=50&key=${KEY}` + (tok ? `&pageToken=${encodeURIComponent(tok)}` : ''));
    if (!r.ok) throw new Error(col + ' ' + r.status);
    const j = await r.json(); out.push(...(j.documents || [])); tok = j.nextPageToken || '';
  } while (tok);
  return out;
}
async function getDoc(path) {
  const r = await fetch(`${BASE}/${path}?key=${KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}
async function commit(writes) {
  const r = await fetch(`https://firestore.googleapis.com/v1/${DB}/documents:commit?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) });
  const t = await r.text();
  if (!r.ok) { const e = new Error('commit ' + r.status + ' ' + t.slice(0, 200)); e.status = r.status; e.body = t; throw e; }
  return JSON.parse(t);
}
const idOf = d => d.name.split('/').pop();

async function thumb(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/[a-z+]+;base64,(.*)$/s);
  const buf = Buffer.from(m[1], 'base64');
  for (const q of [72, 60, 50]) {
    const out = await sharp(buf).rotate().resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: q }).toBuffer();
    const d = 'data:image/webp;base64,' + out.toString('base64');
    if (d.length < 44000 || q === 50) return d;
  }
}
const isBig = s => typeof s === 'string' && s.startsWith('data:image') && s.length > 45000;
const hasRef = f => f && str(f.imgId) && str(f.img) && str(f.imgTh) && fnv(str(f.img)) === str(f.imgTh);

const report = { startedAt: new Date().toISOString(), products: 0, photosMoved: 0, productsUpdated: 0, ordersThumbed: 0,
  itemsThumbed: 0, sizeBefore: 0, sizeAfter: 0, ordersBefore: 0, ordersAfter: 0, errors: [] };

async function saveReport(done) {
  report.done = !!done; report.at = new Date().toISOString();
  await commit([{ update: { name: `${DB}/documents/meta/photoMigration`, fields: { data: sv(JSON.stringify(report)) } } }]);
}

// photo complète → photos/{id}, vérifiée en la relisant
async function storePhoto(full) {
  const id = 'm' + createHash('sha1').update(full).digest('hex').slice(0, 24);
  const ex = await getDoc('photos/' + id);
  if (!(ex && str(ex.fields && ex.fields.d) === full)) {
    await commit([{ update: { name: `${DB}/documents/photos/${id}`, fields: { d: sv(full), at: { integerValue: String(Date.now()) } } } }]);
    const chk = await getDoc('photos/' + id);
    if (!(chk && str(chk.fields && chk.fields.d) === full)) throw new Error('vérification photo échouée');
  }
  return id;
}

async function migrateProduct(doc) {
  const f = doc.fields || {};
  const slots = [f];
  const colArr = f.colors && f.colors.arrayValue && f.colors.arrayValue.values;
  (colArr || []).forEach(v => { if (v && v.mapValue) { v.mapValue.fields = v.mapValue.fields || {}; slots.push(v.mapValue.fields); } });
  let changed = false;
  for (const s of slots) {
    const img = str(s.img);
    if (!isBig(img) || hasRef(s)) continue;
    const id = await storePhoto(img);
    const th = await thumb(img);
    s.img = sv(th); s.imgId = sv(id); s.imgTh = sv(fnv(th)); s.imgH = sv(fnv(img));
    report.photosMoved++; changed = true;
  }
  if (!changed) return 'same';
  const fieldPaths = ['img', 'imgId', 'imgTh', 'imgH'].filter(k => f[k]);
  if (f.colors) fieldPaths.push('colors');
  const upd = {}; fieldPaths.forEach(k => upd[k] = f[k]);
  await commit([{ update: { name: doc.name, fields: upd }, updateMask: { fieldPaths }, currentDocument: { updateTime: doc.updateTime } }]);
  return 'updated';
}

async function migrateOrder(doc) {
  const f = doc.fields || {};
  const items = f.items && f.items.arrayValue && f.items.arrayValue.values;
  let n = 0;
  for (const v of (items || [])) {
    const it = v && v.mapValue && v.mapValue.fields;
    if (it && isBig(str(it.img))) { it.img = sv(await thumb(str(it.img))); n++; }
  }
  if (!n) return 0;
  await commit([{ update: { name: doc.name, fields: { items: f.items } }, updateMask: { fieldPaths: ['items'] }, currentDocument: { updateTime: doc.updateTime } }]);
  return n;
}

async function withRetry(col, doc, fn) {
  for (let i = 0; i < 5; i++) {
    try { return await fn(doc); }
    catch (e) {
      if (!/FAILED_PRECONDITION|412|400/.test(String(e.status) + e.body) || i === 4) throw e;
      doc = await getDoc(col + '/' + idOf(doc));   // modifié entre-temps : on relit
      if (!doc) return 'gone';
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function main() {
  const products = await listAll('products');
  const orders = await listAll('orders');
  if (!products.length) throw new Error('aucun produit lu');
  report.products = products.length; report.orders = orders.length;
  report.sizeBefore = products.reduce((t, d) => t + JSON.stringify(d.fields).length, 0);
  report.ordersBefore = orders.reduce((t, d) => t + JSON.stringify(d.fields).length, 0);

  // 1) sauvegarde complète (dans Firestore, pas dans le dépôt public)
  for (const d of products) await commit([{ update: { name: `${DB}/documents/backup_products_${TAG}/${idOf(d)}`, fields: d.fields } }]);
  for (const d of orders) await commit([{ update: { name: `${DB}/documents/backup_orders_${TAG}/${idOf(d)}`, fields: d.fields } }]);
  report.backup = `backup_products_${TAG} (${products.length}) + backup_orders_${TAG} (${orders.length})`;
  await saveReport(false);

  // 2) produits
  for (const d of products) {
    try { if (await withRetry('products', d, migrateProduct) === 'updated') report.productsUpdated++; }
    catch (e) { report.errors.push('produit ' + idOf(d) + ': ' + e.message.slice(0, 150)); }
  }
  // 3) commandes
  for (const d of orders) {
    try { const n = await withRetry('orders', d, migrateOrder); if (n > 0) { report.ordersThumbed++; report.itemsThumbed += n; } }
    catch (e) { report.errors.push('commande ' + idOf(d) + ': ' + e.message.slice(0, 150)); }
  }
  report.sizeAfter = (await listAll('products')).reduce((t, d) => t + JSON.stringify(d.fields).length, 0);
  report.ordersAfter = (await listAll('orders')).reduce((t, d) => t + JSON.stringify(d.fields).length, 0);
  await saveReport(true);
  console.log(`produits ${report.productsUpdated}/${report.products}, photos ${report.photosMoved}, commandes ${report.ordersThumbed}, erreurs ${report.errors.length}`);
}
main().catch(async e => { report.errors.push('FATAL ' + e.message.slice(0, 200)); try { await saveReport(true); } catch (x) {} console.error(e.message); process.exit(1); });
