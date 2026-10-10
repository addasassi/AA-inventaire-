// Diagnostic : cherche l'API d'historique d'un colis ZR (TN)
const FS = 'https://firestore.googleapis.com/v1/projects/aa-inventaire/databases/(default)/documents';
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const TN = process.env.TN;
if(TN === 'LIST'){
  const docs = []; let tok = '';
  do{ const r = await (await fetch(`${FS}/orders?pageSize=300&key=${KEY}${tok ? '&pageToken=' + tok : ''}`)).json(); (r.documents || []).forEach(d => docs.push(d)); tok = r.nextPageToken; }while(tok);
  const v = x => x == null ? null : ('stringValue' in x ? x.stringValue : 'booleanValue' in x ? x.booleanValue : 'integerValue' in x ? x.integerValue : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, y]) => [k, v(y)])) : null);
  docs.forEach(d => { const f = Object.fromEntries(Object.entries(d.fields).map(([k, y]) => [k, v(y)])); const z = f.zr || {};
    if(z.parcelId && z.stage !== 'delivered' && z.stage !== 'returned') if(!process.env.HIST) console.log('ORD', d.name.split('/').pop(), JSON.stringify({name: f.customer && f.customer.name, type: f.customer && f.customer.deliveryType, deferred: f.deferred, deferredDate: f.deferredDate, stage: z.stage, state: z.state, situation: z.situation, tn: z.tracking, upd: z.updatedAt, sitAt: z.situationAt, reportDate: z.reportDate, status: z.status, createdAt: f.createdAt}));
  });
  if(process.env.HIST){
    const meta = await (await fetch(`${FS}/meta/zr?key=${KEY}`)).json();
    const relay = meta.fields.url.stringValue.replace(/\/+$/, '');
    for(const d of docs){ const f = d.fields; const z = f.zr && f.zr.mapValue && f.zr.mapValue.fields || {};
      const st = z.stage && z.stage.stringValue; if(!(z.parcelId && z.parcelId.stringValue)) continue;
      if(!f.createdAt || f.createdAt.stringValue < '2026-10-06') continue;
      const id = d.name.split('/').pop();
      const h = await (await fetch(relay + '/history', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})})).json();
      (h.events || []).filter(e => /report/i.test(e.label) && String(e.at) >= '2026-10-09').forEach(e => console.log('REP', id, st, z.tracking && z.tracking.stringValue, e.at, e.label, e.date));
    }
  }
  process.exit(0);
}
const q = await fetch(`${FS}:runQuery?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({structuredQuery: {from: [{collectionId: 'orders'}], where: {fieldFilter: {field: {fieldPath: 'zr.tracking'}, op: 'EQUAL', value: {stringValue: TN}}}, limit: 1}})});
const rows = await q.json();
const doc = rows.find(r => r.document);
const id = doc.document.name.split('/').pop();
const meta = await (await fetch(`${FS}/meta/zr?key=${KEY}`)).json();
const relay = meta.fields.url.stringValue.replace(/\/+$/, '');
const r = await fetch(relay + '/raw', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, probe: ['/parcels/{id}/state-history']})});
const j = await r.json();
console.log('SITUATION', JSON.stringify(j.parcel && j.parcel.situation, null, 1));
const keys = Object.keys(j.parcel || {}).filter(k => /reason|motif|cause|comment|note|situation|attempt/i.test(k));
keys.forEach(k => console.log('KEY', k, JSON.stringify(j.parcel[k]).slice(0, 400)));
let h = []; try{ h = JSON.parse(j['/parcels/{id}/state-history']); }catch(e){}
h.forEach(e => (e.situations || []).forEach(x => console.log('HSIT', JSON.stringify(x))));
const t = await (await fetch(relay + '/track', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})})).json();
console.log('TRACK', JSON.stringify({situation: t.zr && t.zr.situation, situationNote: t.zr && t.zr.situationNote, reportDate: t.zr && t.zr.reportDate, reportedAt: t.zr && t.zr.reportedAt}));
