// Diagnostic : affiche le colis brut ZR d'un n° de suivi (TN)
const FS = 'https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents';
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const TN = process.env.TN;
const q = await fetch(`${FS}:runQuery?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({structuredQuery: {from: [{collectionId: 'orders'}], where: {fieldFilter: {field: {fieldPath: 'zr.tracking'}, op: 'EQUAL', value: {stringValue: TN}}}, limit: 1}})});
const rows = await q.json();
const doc = rows.find(r => r.document);
if(!doc){ console.log('introuvable', JSON.stringify(rows).slice(0, 500)); process.exit(1); }
const id = doc.document.name.split('/').pop();
console.log('order', id);
const meta = await (await fetch(`${FS}/meta/zr?key=${KEY}`)).json();
const relay = meta.fields.url.stringValue.replace(/\/+$/, '');
const r = await fetch(relay + '/raw', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})});
console.log(r.status);
console.log(JSON.stringify(await r.json(), null, 1));
