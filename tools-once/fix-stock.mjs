// Correction ponctuelle : annule le +1 remis en stock par la suppression d'une commande d'essai (08/10/2026).
// N'agit que si la quantité actuelle est encore celle d'après la suppression (aucun double retrait).
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const FS = 'https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents/products/';
const FIX = [
  ['p1789442870073243', '428700738749', 8],
  ['p1790250857767115', '508577685745', 1],
  ['p1790250972773399', '509727736633', 5],
  ['p1790251199419381', '511994192348', 5],
  ['p1790252431403864', '524314035266', 2]
];
const num = v => v ? Number(v.integerValue ?? v.doubleValue ?? 0) : 0;
const str = v => v ? (v.stringValue ?? (v.integerValue != null ? String(v.integerValue) : '')) : '';
let ok = 0;
for (const [id, code, expected] of FIX) {
  const r = await fetch(FS + id + '?key=' + KEY);
  const doc = await r.json();
  const f = doc.fields || {};
  let mask, body;
  if (str(f.code) === code) {
    const q = num(f.qty);
    if (q !== expected) { console.log(id, code, 'ignoré : qty =', q); continue; }
    mask = 'qty'; body = { qty: { integerValue: String(q - 1) } };
  } else {
    const cols = (f.colors && f.colors.arrayValue && f.colors.arrayValue.values) || [];
    const c = cols.find(x => str(x.mapValue && x.mapValue.fields && x.mapValue.fields.code) === code);
    if (!c) { console.log(id, code, 'pièce introuvable'); continue; }
    const q = num(c.mapValue.fields.qty);
    if (q !== expected) { console.log(id, code, 'ignoré : qty =', q); continue; }
    c.mapValue.fields.qty = { integerValue: String(q - 1) };
    mask = 'colors'; body = { colors: f.colors };
  }
  const w = await fetch(FS + id + '?updateMask.fieldPaths=' + mask + '&currentDocument.updateTime=' + encodeURIComponent(doc.updateTime) + '&key=' + KEY,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: body }) });
  console.log(id, code, w.ok ? 'OK : ' + expected + ' -> ' + (expected - 1) : 'ÉCHEC ' + w.status + ' ' + (await w.text()).slice(0, 200));
  if (w.ok) ok++;
}
console.log('Corrigés :', ok, '/', FIX.length);
