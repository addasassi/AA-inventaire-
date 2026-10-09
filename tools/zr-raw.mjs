// Diagnostic : cherche l'API d'historique d'un colis ZR (TN)
const FS = 'https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents';
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const TN = process.env.TN;
for(const u of ['https://api.zrexpress.app/swagger/v1/swagger.json', 'https://api.zrexpress.app/openapi.json', 'https://api.zrexpress.app/swagger/index.html', 'https://api.zrexpress.app/api/v1/swagger.json', 'https://api.zrexpress.app/scalar/v1', 'https://api.zrexpress.app/openapi/v1.json', 'https://docs.zrexpress.app/']){
  try{ const r = await fetch(u); const t = await r.text(); console.log('DOC', u, r.status, t.length); if(r.ok && t.length > 1000){ const fs = await import('fs'); fs.writeFileSync('tools/debug/doc-' + u.replace(/\W+/g, '_').slice(-40) + '.txt', t); } }catch(e){ console.log('DOC', u, 'ERR', e.message); }
}
const q = await fetch(`${FS}:runQuery?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({structuredQuery: {from: [{collectionId: 'orders'}], where: {fieldFilter: {field: {fieldPath: 'zr.tracking'}, op: 'EQUAL', value: {stringValue: TN}}}, limit: 1}})});
const rows = await q.json();
const doc = rows.find(r => r.document);
const id = doc.document.name.split('/').pop();
const meta = await (await fetch(`${FS}/meta/zr?key=${KEY}`)).json();
const relay = meta.fields.url.stringValue.replace(/\/+$/, '');
const probe = ['/parcels/{id}/histories', '/parcels/{id}/state-histories', '/parcels/{id}/situation-histories', '/parcels/{id}/state-situation-histories', '/parcels/{id}/tracking', '/parcels/{id}/logs', '/parcels/{id}/activities', '/parcels/{id}/trackings', '/parcels/tracking/{tn}', '/parcels/{tn}/history', '/parcel-histories?parcelId={id}', '/state-histories?parcelId={id}', '/parcels/{id}/state-history', '/parcels/{id}/situations-history', '/tracking/{tn}', '/parcels/track/{tn}', 'POST /parcels/{id}/histories/search', 'POST /parcel-histories/search', 'POST /parcels/histories/search', '/parcels/{id}/statehistories'];
const r = await fetch(relay + '/raw', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, probe})});
const j = await r.json(); delete j.parcel;
for(const k in j) console.log('PROBE', k, '=>', String(j[k]).slice(0, 1500));
