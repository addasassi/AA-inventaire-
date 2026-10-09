// Diagnostic : cherche l'API d'historique d'un colis ZR (TN)
const FS = 'https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents';
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const TN = process.env.TN;
const q = await fetch(`${FS}:runQuery?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({structuredQuery: {from: [{collectionId: 'orders'}], where: {fieldFilter: {field: {fieldPath: 'zr.tracking'}, op: 'EQUAL', value: {stringValue: TN}}}, limit: 1}})});
const rows = await q.json();
const doc = rows.find(r => r.document);
const id = doc.document.name.split('/').pop();
const meta = await (await fetch(`${FS}/meta/zr?key=${KEY}`)).json();
const relay = meta.fields.url.stringValue.replace(/\/+$/, '');
const r = await fetch(relay + '/history', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})});
console.log(r.status, JSON.stringify(await r.json(), null, 1));
