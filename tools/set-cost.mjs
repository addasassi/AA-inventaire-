// Ponctuel : coût d'achat = 600 DA pour tous les produits et couleurs,
// et bénéfice recalculé pour les commandes enregistrées sans coût.
const KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const DB = 'projects/aa-inventaire/databases/(default)';
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`;
const COST = 600;
const iv = n => ({ integerValue: String(Math.round(n)) });
const num = v => v ? Number(v.integerValue ?? v.doubleValue ?? 0) : 0;
async function listAll(col){ const out=[]; let t=''; do{ const r=await fetch(`${BASE}/${col}?pageSize=50&key=${KEY}`+(t?`&pageToken=${encodeURIComponent(t)}`:'')); const j=await r.json(); out.push(...(j.documents||[])); t=j.nextPageToken||''; }while(t); return out; }
async function getDoc(name){ const r=await fetch(`https://firestore.googleapis.com/v1/${name}?key=${KEY}`); return r.ok ? r.json() : null; }
async function commit(writes){ const r=await fetch(`https://firestore.googleapis.com/v1/${DB}/documents:commit?key=${KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes})}); const t=await r.text(); if(!r.ok){ const e=new Error(t.slice(0,200)); e.retry=/FAILED_PRECONDITION/.test(t); throw e; } }
async function retry(doc, fn){ for(let i=0;i<6;i++){ try{ return await fn(doc); }catch(e){ if(!e.retry||i===5) throw e; await new Promise(r=>setTimeout(r,1500)); doc = await getDoc(doc.name); } } }
const rep = {products:0, colors:0, orders:0, errors:[]};
for(const d of await listAll('products')){
  try{ await retry(d, async doc => {
    const f = doc.fields || {};
    f.cost = iv(COST);
    const cols = f.colors && f.colors.arrayValue && f.colors.arrayValue.values;
    (cols || []).forEach(v => { if(v && v.mapValue){ v.mapValue.fields = v.mapValue.fields || {}; v.mapValue.fields.cost = iv(COST); rep.colors++; } });
    const paths = ['cost']; const upd = {cost: f.cost};
    if(f.colors){ paths.push('colors'); upd.colors = f.colors; }
    await commit([{update:{name:doc.name, fields:upd}, updateMask:{fieldPaths:paths}, currentDocument:{updateTime:doc.updateTime}}]);
  }); rep.products++; }catch(e){ rep.errors.push('p '+d.name.split('/').pop()+': '+e.message); }
}
for(const d of await listAll('orders')){
  try{ await retry(d, async doc => {
    const f = doc.fields || {};
    if(num(f.costTotal) > 0) return;
    const items = (f.items && f.items.arrayValue && f.items.arrayValue.values) || [];
    let costTotal = 0;
    items.forEach(v => { const it = v.mapValue && v.mapValue.fields; if(!it) return; it.cost = iv(COST); costTotal += COST * (num(it.qty) || 0); });
    const total = num(f.total);
    await commit([{update:{name:doc.name, fields:{items:f.items, costTotal:iv(costTotal), profit:iv(total - costTotal)}}, updateMask:{fieldPaths:['items','costTotal','profit']}, currentDocument:{updateTime:doc.updateTime}}]);
    rep.orders++;
  }); }catch(e){ rep.errors.push('o '+d.name.split('/').pop()+': '+e.message); }
}
await commit([{update:{name:`${DB}/documents/meta/costReport`, fields:{data:{stringValue:JSON.stringify(rep)}, at:{stringValue:new Date().toISOString()}}}}]);
console.log(JSON.stringify(rep));
