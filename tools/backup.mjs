// Sauvegarde quotidienne de Firestore (chiffrée AES-256-GCM) → dossier backup/ de la branche « backups »
// Clé : meta/backup.key (créée au premier passage) — visible dans l'app (Statistiques → Sauvegardes).
import fs from 'fs';
import crypto from 'crypto';
const FS = 'https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents';
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const OUT = process.argv[2] || 'out';
async function list(col){
  const docs = []; let tok = '';
  for(let i = 0; i < 200; i++){
    const r = await fetch(`${FS}/${col}?pageSize=300&key=${KEY}${tok ? '&pageToken=' + encodeURIComponent(tok) : ''}`);
    if(!r.ok) throw new Error(col + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const j = await r.json(); (j.documents || []).forEach(d => docs.push(d));
    tok = j.nextPageToken; if(!tok) break;
  }
  return docs;
}
async function getKey(){
  const r = await fetch(`${FS}/meta/backup?key=${KEY}`);
  if(r.ok){ const j = await r.json(); const k = j.fields && j.fields.key && j.fields.key.stringValue; if(k) return k; }
  const k = crypto.randomBytes(32).toString('base64url');
  const w = await fetch(`${FS}/meta/backup?key=${KEY}&updateMask.fieldPaths=key&updateMask.fieldPaths=createdAt`, {method: 'PATCH', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({fields: {key: {stringValue: k}, createdAt: {stringValue: new Date().toISOString()}}})});
  if(!w.ok) throw new Error('clé : ' + w.status);
  return k;
}
function enc(buf, k){
  const key = crypto.createHash('sha256').update(k).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from('AAB1'), iv, c.getAuthTag(), data]);
}
const k = await getKey();
fs.mkdirSync(OUT + '/backup', {recursive: true}); fs.mkdirSync(OUT + '/backup/photos', {recursive: true});
const day = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const dump = {at: new Date().toISOString()};
const counts = {};
for(const col of ['products', 'orders', 'customers', 'meta', 'users']){
  try{ dump[col] = await list(col); counts[col] = dump[col].length; }catch(e){ console.log('⚠️', e.message); counts[col] = 'ERR'; }
}
if(!(counts.products > 0)) { console.log('Aucun produit lu — sauvegarde annulée', counts); process.exit(1); }
fs.writeFileSync(`${OUT}/backup/${day}.enc`, enc(Buffer.from(JSON.stringify(dump)), k));
// photos (une seule fois chacune : elles ne changent pas)
let newPhotos = 0;
try{
  for(const d of await list('photos')){
    const id = d.name.split('/').pop(), f = `${OUT}/backup/photos/${id}.enc`;
    if(fs.existsSync(f)) continue;
    fs.writeFileSync(f, enc(Buffer.from(JSON.stringify(d)), k)); newPhotos++;
  }
}catch(e){ console.log('⚠️ photos', e.message); }
// garder 14 jours
for(const f of fs.readdirSync(`${OUT}/backup`)){
  const m = f.match(/^(\d{4}-\d{2}-\d{2})\.enc$/);
  if(m && Date.now() - Date.parse(m[1]) > 14 * 86400e3) fs.unlinkSync(`${OUT}/backup/${f}`);
}
fs.writeFileSync(`${OUT}/backup/last.json`, JSON.stringify({day, at: dump.at, counts, newPhotos}, null, 1));
await fetch(`${FS}/meta/backup?key=${KEY}&updateMask.fieldPaths=last`, {method: 'PATCH', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({fields: {last: {mapValue: {fields: {day: {stringValue: day}, at: {stringValue: dump.at}, counts: {stringValue: JSON.stringify(counts)}}}}}})}).catch(() => {});
console.log('✅', day, counts, 'photos +' + newPhotos);
