/* =====================================================================
   Atelier Stock ⇄ ZR Express (nouvelle plateforme api.zrexpress.app)
   Cloudflare Worker — à coller dans un Worker nommé « atelier-zr ».

   Secrets à ajouter dans Cloudflare (Settings → Variables and Secrets) :
     ZR_API_KEY  = la clé API (Secret Key) de ZR Express
     ZR_TENANT   = le Tenant ID de ZR Express
   Déclencheur Cron (Settings → Triggers → Cron) : toutes les 10 minutes

   Ce que fait le Worker :
   - POST /send   {id}  → crée le colis ZR d'une commande (une seule fois)
   - POST /label  {id}  → lien PDF de l'étiquette
   - POST /track  {id}  → met à jour l'état du colis tout de suite
   - POST /test         → vérifie les identifiants ZR
   - Toutes les 10 min : envoie les commandes reportées arrivées à date,
     réessaie les envois ratés, et met à jour l'état des colis en cours.
   Les identifiants ZR restent ici : ils ne sont jamais dans l'application.
   ===================================================================== */

const ZR = 'https://api.zrexpress.app/api/v1';
const FS_PROJECT = 'aa-inventaire';
const FS_KEY = 'AIzaSyAfMIEi1MynF82Jp1j1J1BFQM5w8182JTo';
const FS = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
const TRACK_EVERY_MS = 30 * 60 * 1000;   // état des colis : toutes les 30 min
const MAX_ATTEMPTS = 5;

const WILAYAS = ["Adrar","Chlef","Laghouat","Oum El Bouaghi","Batna","Bejaia","Biskra","Bechar","Blida","Bouira",
  "Tamanrasset","Tebessa","Tlemcen","Tiaret","Tizi Ouzou","Alger","Djelfa","Jijel","Setif","Saida","Skikda",
  "Sidi Bel Abbes","Annaba","Guelma","Constantine","Medea","Mostaganem","MSila","Mascara","Ouargla","Oran",
  "El Bayadh","Illizi","Bordj Bou Arreridj","Boumerdes","El Tarf","Tindouf","Tissemsilt","El Oued","Khenchela",
  "Souk Ahras","Tipaza","Mila","Ain Defla","Naama","Ain Temouchent","Ghardaia","Relizane","El MGhair",
  "El Meniaa","Ouled Djellal","Bordj Badji Mokhtar","Beni Abbes","Timimoun","Touggourt","Djanet","In Salah","In Guezzam"];

/* ---------- États ZR → étape simple pour l'app ---------- */
const STAGES = {
  livre:'delivered', 'livre au client':'delivered', encaisse:'delivered', recouvert:'delivered',
  retour_sous_traitant:'returned', colis_recupere:'returned', attente_recuperation_fournisseur:'returned',
  reinjecte_dans_stock:'returned', recupere_par_fournisseur:'returned', remboursement_reinjecte:'returned',
  en_livraison:'out_for_delivery', sortie_en_livraison:'out_for_delivery',
  commande_recue:'created', en_traitement:'created', appel_confirmation:'created', commande_confirmee:'created',
  en_preparation:'created', pret_a_expedier:'created',
  confirme_au_bureau:'in_transit', confirme_chez_partenaire:'in_transit', dispatch:'in_transit', vers_wilaya:'in_transit'
};
const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '');
const norm = s => strip(s).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
function stageOf(state){
  if(!state) return null;
  for(const v of [state.name, state.description]){
    if(!v) continue;
    const k = strip(v).toLowerCase().trim();
    if(STAGES[k]) return STAGES[k];
    if(STAGES[k.replace(/\s+/g, '_')]) return STAGES[k.replace(/\s+/g, '_')];
  }
  return null;
}

/* ---------- Situation de livraison (Ne répond pas 1/2/3, Commune erronée, SMS envoyé…) ----------
   ZR la donne à part de l'état. On cherche tout champ « situation » du colis
   (texte, objet {name/description/label} ou liste → la dernière). */
const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
function txt(v){
  if(!v) return '';
  if(typeof v === 'string') return isUuid(v) ? '' : v;
  if(Array.isArray(v)) return v.length ? txt(v[v.length - 1]) : '';
  if(typeof v === 'object') return txt(v.description || v.label || v.title || v.name || v.situation || v.value || '');
  return '';
}
function situationOf(p){
  if(!p || typeof p !== 'object') return '';
  // ZR : situation = {id, name} ; on ignore les identifiants (situationId, UUID…)
  const keys = Object.keys(p).filter(k => /situation/i.test(k) && !/id$/i.test(k)).sort((a, b) => (a === 'situation' ? -1 : 0) - (b === 'situation' ? -1 : 0));
  for(const k of keys){ const t = txt(p[k]); if(t) return t; }
  for(const k of ['lastAttempt', 'deliveryAttempt', 'attempt', 'lastEvent']){
    if(p[k] && typeof p[k] === 'object'){ const t = situationOf(p[k]); if(t) return t; }
  }
  return '';
}
// date à laquelle le colis est reporté (champ du colis ou date écrite dans la situation / le commentaire)
function toIsoDay(v){
  if(!v || typeof v !== 'string') return '';
  let m = v.match(/(\d{4})-(\d{2})-(\d{2})/); if(m) return m[1] + '-' + m[2] + '-' + m[3];
  m = v.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if(m){ const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear()); const d = Number(m[1]), mo = Number(m[2]); if(d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
  return '';
}
function reportDateOf(p, depth){
  depth = depth || 0;
  if(!p || typeof p !== 'object' || depth > 3) return '';
  for(const k of Object.keys(p)){
    if(/report|postpon|resched|deferr|schedul|planned|nextattempt|nextdelivery|newdate/i.test(k)){
      const v = p[k];
      const d = typeof v === 'string' ? toIsoDay(v) : (v && typeof v === 'object' ? reportDateOf(v, depth + 1) : '');
      if(d) return d;
    }
  }
  for(const k of Object.keys(p)){
    const v = p[k];
    if(/situation|comment|note|remark|attempt|metadata|meta$/i.test(k) || (depth > 0 && /name|description|label|title/i.test(k))){
      if(typeof v === 'string' && /report/i.test(v)){ const d = toIsoDay(v.replace(/^[^]*?report\w*/i, '')); if(d) return d; }
      if(v && typeof v === 'object'){ const d = reportDateOf(v, depth + 1); if(d) return d; }
    }
  }
  return '';
}
function noteOf(p){
  const s = p && (p.situation || p.lastSituation);
  const c = s && typeof s === 'object' ? (s.comment || s.note || s.remark || s.observation) : '';
  return typeof c === 'string' ? c.slice(0, 200) : '';
}
const isNoSituation = t => !t || /pas de situation/i.test(strip(t));

/* ---------- Firestore (REST) ---------- */
function toFs(v){
  if(v === null || v === undefined) return {nullValue: null};
  if(typeof v === 'boolean') return {booleanValue: v};
  if(typeof v === 'number') return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  if(Array.isArray(v)) return {arrayValue: {values: v.map(toFs)}};
  if(typeof v === 'object'){ const f = {}; for(const k in v) f[k] = toFs(v[k]); return {mapValue: {fields: f}}; }
  return {stringValue: String(v)};
}
function fromFs(v){
  if(!v) return null;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return Number(v.integerValue);
  if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue;
  if('nullValue' in v) return null;
  if('timestampValue' in v) return v.timestampValue;
  if('mapValue' in v){ const o = {}, f = v.mapValue.fields || {}; for(const k in f) o[k] = fromFs(f[k]); return o; }
  if('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  return null;
}
const FIELDS = ['customer', 'total', 'zr', 'zrDesc', 'deferred', 'deferredDate', 'createdAt'];

async function getOrder(id){
  const mask = FIELDS.map(f => 'mask.fieldPaths=' + f).join('&');
  const r = await fetch(`${FS}/orders/${encodeURIComponent(id)}?${mask}&key=${FS_KEY}`);
  if(r.status === 404) return null;
  if(!r.ok) throw new Error('Firestore ' + r.status);
  const j = await r.json();
  const o = fromFs({mapValue: {fields: j.fields || {}}});
  o.id = id; o._updateTime = j.updateTime;
  return o;
}
// Écrit seulement le champ zr de la commande. Avec updateTime : échoue si quelqu'un l'a modifiée entre-temps (verrou).
async function saveZr(id, zr, updateTime){
  let url = `${FS}/orders/${encodeURIComponent(id)}?updateMask.fieldPaths=zr&key=${FS_KEY}`;
  url += updateTime ? `&currentDocument.updateTime=${encodeURIComponent(updateTime)}` : '&currentDocument.exists=true';
  const r = await fetch(url, {method: 'PATCH', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({fields: {zr: toFs(zr)}})});
  if(!r.ok) return null;
  return (await r.json()).updateTime;
}
async function activeOrders(){
  const r = await fetch(`${FS}:runQuery?key=${FS_KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({structuredQuery: {
      from: [{collectionId: 'orders'}],
      where: {fieldFilter: {field: {fieldPath: 'zr.active'}, op: 'EQUAL', value: {booleanValue: true}}},
      select: {fields: FIELDS.map(f => ({fieldPath: f}))},
      limit: 300
    }})});
  if(!r.ok) throw new Error('Firestore query ' + r.status);
  const rows = await r.json();
  return rows.filter(x => x.document).map(x => {
    const o = fromFs({mapValue: {fields: x.document.fields || {}}});
    o.id = x.document.name.split('/').pop(); o._updateTime = x.document.updateTime;
    return o;
  });
}

/* ---------- Tenant : secret ZR_TENANT, sinon trouvé tout seul via GET /users/profile ---------- */
let tenantCache = '', tenantName = '', tenantDiag = '', authMode = 'key';
async function tenantOf(env){
  if((env.ZR_TENANT || '').trim()) return env.ZR_TENANT.trim();
  if(tenantCache) return tenantCache;
  if(!env.ZR_API_KEY) return '';
  try{
    // essaie la clé en X-Api-Key, puis en Bearer (les deux sont acceptés par l'API selon la doc)
    const key = String(env.ZR_API_KEY).trim().replace(/^"+|"+$/g, '');
    let r = await fetch(ZR + '/users/profile', {headers: {Accept: 'application/json', 'X-Api-Key': key}});
    let raw = await r.text();
    if(!r.ok){
      const r2 = await fetch(ZR + '/users/profile', {headers: {Accept: 'application/json', Authorization: 'Bearer ' + key}});
      const raw2 = await r2.text();
      if(r2.ok){ r = r2; raw = raw2; authMode = 'bearer'; }
      else{ tenantDiag = 'profile HTTP ' + r.status + ' / bearer ' + r2.status + ' — clé de ' + key.length + ' caractères'; return ''; }
    }
    let me = {}; try{ me = JSON.parse(raw); }catch(e){}
    const ms = (me && me.memberships) || [];
    const m = ms.find(x => x.isDefault && x.isActive && x.tenantId) || ms.find(x => x.isActive && x.tenantId) || ms.find(x => x.tenantId);
    if(m){ tenantCache = m.tenantId; tenantName = m.tenantName || ''; }
    else tenantDiag = 'profile OK mais aucun tenant (' + ms.length + ' membership)';
  }catch(e){ tenantDiag = 'profile erreur ' + (e.message || e); }
  return tenantCache;
}

/* ---------- ZR Express ---------- */
class ZrError extends Error { constructor(msg, permanent){ super(msg); this.permanent = permanent; } }
function authHeaders(env, mode){
  const key = String(env.ZR_API_KEY || '').trim().replace(/^"+|"+$/g, '');
  return mode === 'bearer' ? {Authorization: 'Bearer ' + key} : {'X-Api-Key': key};
}
async function zr(env, path, init = {}){
  const tenant = await tenantOf(env);
  const send = mode => fetch(ZR + path, {...init, headers: {'Content-Type': 'application/json', Accept: 'application/json',
    ...authHeaders(env, mode), 'X-Tenant': tenant}});
  let r = await send(authMode);
  if(r.status === 401){                                   // l'autre façon d'envoyer la clé
    const other = authMode === 'bearer' ? 'key' : 'bearer';
    const r2 = await send(other);
    if(r2.status !== 401){ authMode = other; r = r2; }
  }
  let body = null; try{ body = await r.json(); }catch(e){}
  if(!r.ok){
    const b = body || {};
    let errs = '';
    if(Array.isArray(b.errors)) errs = b.errors.map(e => typeof e === 'string' ? e : (e.description || e.message || JSON.stringify(e))).join(' | ');
    else if(b.errors && typeof b.errors === 'object') errs = Object.entries(b.errors).map(([k, v]) => k + ': ' + [].concat(v).join(', ')).join(' | ');
    const msg = [b.title, b.detail, errs].filter(Boolean).join(' — ') || b.message || ('HTTP ' + r.status);
    throw new ZrError(msg, r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 401 && r.status !== 403);
  }
  return body;
}
async function territories(env, keyword, extra = {}){
  const b = await zr(env, '/territories/search', {method: 'POST', body: JSON.stringify({keyword, pageSize: 50, pageNumber: 1, ...extra})});
  return (b && b.items) || [];
}
const cityCache = new Map();
async function resolveCity(env, code, name){
  if(cityCache.has(code)) return cityCache.get(code);
  const ok = t => t.code === code && t.level === 'wilaya';
  let c = (await territories(env, strip(name))).find(ok);
  if(!c) c = (await territories(env, String(code), {pageSize: 200})).find(ok);
  if(!c) throw new ZrError(`ZR ne livre pas la wilaya ${code} (${name})`, true);
  cityCache.set(code, c);
  return c;
}
// clé tolérante : accents, espaces, tirets, lettres doublées, ou/u, y/i, e muet…
// « Honaïne » = « Honnaine », « Beni-Slimane » = « Béni Slimane », « Ouled » = « Oulad »
function fuzzyKey(s){
  return strip(s).toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/oul[ae]d/g, 'uld').replace(/ou/g, 'u').replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1')
    .replace(/e(?=[^aeiou]|$)/g, '')
    .replace(/^el|^al/, '');
}
function lev(a, b){
  const m = a.length, n = b.length; if(!m || !n) return Math.max(m, n);
  let prev = Array.from({length: n + 1}, (_, j) => j);
  for(let i = 1; i <= m; i++){
    const cur = [i];
    for(let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
let allTerr = null, allTerrAt = 0;
async function allTerritories(env){
  if(allTerr && Date.now() - allTerrAt < 6 * 3600 * 1000) return allTerr;
  const all = [];
  for(let page = 1; page <= 10; page++){
    const b = await zr(env, '/territories/search', {method: 'POST', body: JSON.stringify({pageSize: 1000, pageNumber: page})});
    const items = (b && b.items) || [];
    all.push(...items);
    if(items.length < 1000 || page >= ((b && b.totalPages) || 1)) break;
  }
  allTerr = all; allTerrAt = Date.now();
  return all;
}
async function resolveDistrict(env, commune, city, pickup){
  const items = (await territories(env, strip(commune), pickup ? {deliveryType: {value: 'pickup-point'}} : {}))
    .filter(t => t.level === 'commune');
  let d = items.find(t => t.parentId === city.id && norm(t.name) === norm(commune))
       || items.find(t => t.parentId === city.id);
  if(!d){
    // orthographe différente de celle de ZR : on compare avec toutes les communes de la wilaya
    try{
      const list = (await allTerritories(env)).filter(t => t.level === 'commune' && t.parentId === city.id);
      const k = fuzzyKey(commune);
      d = list.find(t => fuzzyKey(t.name) === k);
      if(!d && k.length >= 4){
        let best = null, bestD = 99;
        list.forEach(t => { const dd = lev(fuzzyKey(t.name), k); if(dd < bestD){ bestD = dd; best = t; } });
        if(best && bestD <= Math.max(1, Math.floor(k.length / 5))) d = best;     // 1 faute pour 5 lettres
      }
    }catch(e){}
  }
  if(!d) d = items.find(t => norm(t.name) === norm(commune) && t.parentId === city.id);
  if(!d) throw new ZrError(`Commune « ${commune} » introuvable chez ZR (wilaya ${city.name || ''})`, true);
  return d;
}
let hubCache = null, hubTime = 0;
async function hubs(env){
  if(hubCache && Date.now() - hubTime < 6 * 3600 * 1000) return hubCache;
  const out = [];
  for(let p = 1; p <= 10; p++){
    const b = await zr(env, '/hubs/search', {method: 'POST', body: JSON.stringify({pageSize: 200, pageNumber: p})});
    const items = (b && b.items) || [];
    out.push(...items);
    if(!items.length || p >= ((b && b.totalPages) || 1)) break;
  }
  hubCache = out; hubTime = Date.now();
  return out;
}
const officeName = c => String(c || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
async function resolveHub(env, city, communeRaw){
  const commune = officeName(communeRaw);
  const list = (await hubs(env)).filter(h => h.isPickupPoint !== false);
  let district = null;
  try{ district = await resolveDistrict(env, commune, city, true); }catch(e){}
  const inCity = list.filter(h => h.address && h.address.cityTerritoryId === city.id);
  const n = norm(commune);
  const h = (district && list.find(x => x.address && x.address.districtTerritoryId === district.id))
         || inCity.find(x => norm(x.name) === n)
         || inCity.find(x => norm(x.name).split(' ').includes(n) || norm(x.name).startsWith(n))
         || inCity.find(x => norm(x.name).includes(n))
         || list.find(x => norm(x.name).includes(norm(commune)))
         || (inCity.length === 1 ? inCity[0] : null);
  if(!h) throw new ZrError(`Bureau Stop Desk « ${commune} » introuvable chez ZR (bureaux de la wilaya : ${inCity.map(x => x.name).join(', ') || 'aucun'})`, true);
  return h;
}
function phoneIntl(p){
  p = String(p || '').replace(/[^\d+]/g, '');
  if(p.startsWith('+')) return p;
  if(p.startsWith('00')) return '+' + p.slice(2);
  if(p.startsWith('0')) return '+213' + p.slice(1);
  if(p.startsWith('213')) return '+' + p;
  return '+213' + p;
}
function wilayaCodeOf(c){
  const n = Number(c.wilayaCode);
  if(n >= 1 && n <= 58) return n;
  const k = norm(c.wilaya);
  const i = WILAYAS.findIndex(w => norm(w) === k);
  return i >= 0 ? i + 1 : 0;
}

async function createParcel(env, o){
  const c = o.customer || {};
  if(!c.name || !c.phone) throw new ZrError('Nom ou téléphone manquant', true);
  const code = wilayaCodeOf(c);
  if(!code) throw new ZrError(`Wilaya « ${c.wilaya || ''} » non reconnue`, true);
  const pickup = c.deliveryType === 'stopdesk';
  if(!c.commune) throw new ZrError(pickup ? 'Bureau Stop Desk manquant' : 'Commune manquante', true);
  const phone = phoneIntl(c.phone);
  const city = await resolveCity(env, code, WILAYAS[code - 1]);
  let cityId, districtId, hubId = null;
  if(pickup){
    const h = await resolveHub(env, city, c.commune);
    hubId = h.id;
    cityId = (h.address && h.address.cityTerritoryId) || city.id;
    districtId = h.address && h.address.districtTerritoryId;
    if(!districtId) districtId = (await resolveDistrict(env, officeName(c.commune), city, true)).id;
  }else{
    cityId = city.id;
    districtId = (await resolveDistrict(env, c.commune, city, false)).id;
  }
  const cust = await zr(env, '/customers/individual', {method: 'POST', body: JSON.stringify({name: c.name, phone: {number1: phone}})});
  if(!cust || !cust.id) throw new ZrError('Création du client ZR impossible', false);
  const amount = Math.round(Number(o.total) || 0);
  const desc = 'ملابس نسائية';   // toujours ce texte sur le bordereau
  const created = await zr(env, '/parcels', {method: 'POST', body: JSON.stringify({
    customer: {customerId: cust.id, name: c.name, phone: {number1: phone}},
    deliveryAddress: {cityTerritoryId: cityId, districtTerritoryId: districtId, street: pickup ? null : (c.address || null)},
    deliveryType: pickup ? 'pickup-point' : 'home',
    amount, description: desc, externalId: o.id,
    orderedProducts: [{productName: desc, unitPrice: amount, quantity: 1, stockType: 'none'}],
    ...(hubId ? {hubId} : {})
  })});
  if(!created || !created.id) throw new ZrError('ZR n\'a pas renvoyé de colis', false);
  let parcel = null;
  for(let i = 0; i < 3 && !(parcel && parcel.trackingNumber); i++){
    if(i) await new Promise(r => setTimeout(r, 1500));
    parcel = await zr(env, '/parcels/' + created.id).catch(() => null);
  }
  return {parcelId: created.id, tracking: (parcel && parcel.trackingNumber) || '', state: parcel && parcel.state};
}

/* ---------- Envoi d'une commande (idempotent + verrou) ---------- */
async function sendOrder(env, id, force){
  const o = await getOrder(id);
  if(!o) return {ok: false, error: 'Commande introuvable'};
  const z = o.zr || {};
  if(z.parcelId) return {ok: true, zr: z};                           // déjà envoyée
  if(!force && z.status === 'error') return {ok: false, zr: z};
  if(z.status === 'sending' && Date.now() - Date.parse(z.updatedAt || 0) < 3 * 60 * 1000) return {ok: true, zr: z};
  const now = new Date().toISOString();
  const lockTime = await saveZr(id, {...z, status: 'sending', active: true, updatedAt: now}, o._updateTime);
  if(!lockTime) return {ok: true, zr: z};                           // un autre envoi est en cours
  try{
    const p = await createParcel(env, o);
    const nz = {status: 'sent', active: true, parcelId: p.parcelId, tracking: p.tracking,
      state: (p.state && (p.state.description || p.state.name)) || 'Commande reçue', stage: stageOf(p.state) || 'created', situation: '',
      sentAt: now, updatedAt: new Date().toISOString(), lastCheck: Date.now(), error: '', attempts: (z.attempts || 0) + 1};
    await saveZr(id, nz);
    return {ok: true, zr: nz};
  }catch(e){
    const attempts = (z.attempts || 0) + 1;
    const permanent = e.permanent || attempts >= MAX_ATTEMPTS;
    const nz = {...z, status: permanent ? 'error' : 'queued', active: !permanent, error: e.message || String(e),
      attempts, updatedAt: new Date().toISOString()};
    await saveZr(id, nz);
    return {ok: false, zr: nz};
  }
}

async function trackOrder(env, o){
  const z = o.zr || {};
  if(!z.parcelId) return z;
  const p = await zr(env, '/parcels/' + z.parcelId);
  let stage = stageOf(p.state) || z.stage || 'created';
  if(p.isReturn === true) stage = 'returned';
  const final = stage === 'delivered' || stage === 'returned';
  const sit = situationOf(p);
  const nowIso = new Date().toISOString();
  // statistiques : date de fin (livré / retour), argent encaissé par ZR, nombre max de « Ne répond pas »
  const stateKey = strip((p.state && (p.state.name || p.state.description)) || '').toLowerCase();
  const paid = !!z.paid || (stage === 'delivered' && /encaiss|recouvert|paye|virement/.test(stateKey));
  const finalAt = final ? (z.finalAt || nowIso) : '';
  const nrpM = String(sit || '').match(/r[eé]pond\s+pas\D*(\d+)/i);
  const nrp = Math.max(Number(z.nrp) || 0, nrpM ? Number(nrpM[1]) : (/r[eé]pond pas/i.test(sit || '') ? 1 : 0));
  // un colis livré reste suivi (lentement) jusqu'à l'encaissement, 30 jours maximum
  const keep = stage === 'delivered' && !paid && Date.now() - Date.parse(finalAt) < 30 * 86400000;
  const nz = {...z, tracking: p.trackingNumber || z.tracking,
    state: (p.state && (p.state.description || p.state.name)) || z.state, stage,
    situation: isNoSituation(sit) ? '' : sit,
    deliveryPrice: Number(p.deliveryPrice) || z.deliveryPrice || 0, returnPrice: Number(p.returnPrice) || z.returnPrice || 0,
    finalAt, paid, nrp,
    reportDate: /report/i.test(sit || '') ? (reportDateOf(p) || (/report/i.test(z.situation || '') ? z.reportDate || '' : '')) : '',
    situationNote: noteOf(p) || '',
    // depuis quand l'état / la situation n'ont pas changé (pour repérer les colis bloqués)
    stateAt: ((p.state && (p.state.description || p.state.name)) || z.state) !== z.state ? nowIso : (z.stateAt || z.sentAt || nowIso),
    situationAt: (p.lastSituationUpdateAt ? new Date(String(p.lastSituationUpdateAt).replace(/(\.\d{3})\d+/, '$1') + (/Z|[+-]\d\d:?\d\d$/.test(p.lastSituationUpdateAt) ? '' : 'Z')).toISOString() : '') || ((isNoSituation(sit) ? '' : sit) !== (z.situation || '') ? nowIso : (z.situationAt || nowIso)),
    status: final ? stage : 'sent', active: !final || keep, lastCheck: Date.now(), updatedAt: nowIso};
  await saveZr(o.id, nz);
  return nz;
}

async function cron(env){
  const today = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);   // heure d'Algérie
  const list = await activeOrders();
  for(const o of list){
    const z = o.zr || {};
    try{
      if(!z.parcelId){
        const due = !z.sendAfter || z.sendAfter <= today;
        const old = Date.now() - Date.parse(z.updatedAt || o.createdAt || 0) > 2 * 60 * 1000;
        if(due && old) await sendOrder(env, o.id, false);
      }else if(Date.now() - (z.lastCheck || 0) > (z.stage === 'delivered' ? 6 * 3600 * 1000
          : (z.stage === 'out_for_delivery' || z.situation) ? 10 * 60 * 1000 : TRACK_EVERY_MS)){
        await trackOrder(env, o);
      }
    }catch(e){ /* on réessaiera au prochain passage */ }
  }
}

/* ---------- HTTP ---------- */
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'};
const json = (b, s = 200) => new Response(JSON.stringify(b), {status: s, headers: {...CORS, 'Content-Type': 'application/json'}});

export default {
  async fetch(req, env){
    if(req.method === 'OPTIONS') return new Response(null, {headers: CORS});
    const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    if(path === '/' ){
      const t = await tenantOf(env);
      // liste complète des wilayas / communes livrées par ZR (pour compléter les listes de l'app)
      if(new URL(req.url).searchParams.get('territories') && t){
        const all = [];
        for(let page = 1; page <= 10; page++){
          const b = await zr(env, '/territories/search', {method: 'POST', body: JSON.stringify({pageSize: 1000, pageNumber: page})});
          const items = (b && b.items) || [];
          all.push(...items);
          if(items.length < 1000 || page >= ((b && b.totalPages) || 1)) break;
        }
        const wil = all.filter(x => x.level === 'wilaya');
        const byId = {}; wil.forEach(w => byId[w.id] = w);
        const communes = {};
        all.filter(x => x.level === 'commune' && byId[x.parentId]).forEach(c => {
          const code = String(Number(byId[c.parentId].code));
          (communes[code] = communes[code] || []).push(c.name);
        });
        return json({ok: true, total: all.length, wilayas: wil.map(w => ({code: Number(w.code), name: w.name})).sort((a, b) => a.code - b.code), communes});
      }
      const hq = new URL(req.url).searchParams.get('hubs');
      if(hq && t){
        const all = await hubs(env);
        const q = norm(hq);
        return json({ok: true, total: all.length, hubs: all.filter(h => !q || norm(JSON.stringify([h.name, h.address])).includes(q))
          .slice(0, 30).map(h => ({name: h.name, pickup: h.isPickupPoint, city: h.address && h.address.cityTerritoryId, district: h.address && h.address.districtTerritoryId}))});
      }
      if(new URL(req.url).searchParams.get('test') && t){
        try{ const x = await territories(env, 'alger'); return json({ok: true, test: 'connexion ZR OK', territoires: x.length, auth: authMode}); }
        catch(e){ return json({ok: false, test: 'échec', error: e.message, auth: authMode}); }
      }
      return json({ok: true, service: 'atelier-zr', version: 11, configured: !!env.ZR_API_KEY, tenant: t ? 'ok' : 'manquant',
        boutique: tenantName || undefined, info: t ? undefined : (tenantDiag || undefined)});
    }
    // GET /pdf?u=… : renvoie le PDF de ZR avec CORS → l'app peut l'afficher et l'imprimer elle-même
    if(path === '/pdf'){
      let u; try{ u = new URL(new URL(req.url).searchParams.get('u') || ''); }catch(e){}
      if(!u || u.protocol !== 'https:') return json({ok: false, error: 'lien invalide'}, 400);
      const r = await fetch(u.toString());
      const buf = await r.arrayBuffer();
      const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
      if(!r.ok || head !== '%PDF-') return json({ok: false, error: 'PDF introuvable (' + r.status + ')'}, 502);
      return new Response(buf, {headers: {...CORS, 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store'}});
    }
    if(req.method !== 'POST') return json({error: 'POST attendu'}, 405);
    if(!env.ZR_API_KEY) return json({ok: false, error: 'Secret ZR_API_KEY manquant dans Cloudflare'}, 500);
    if(!(await tenantOf(env))) return json({ok: false, error: 'Tenant ID introuvable : ajoutez le secret ZR_TENANT'}, 500);
    let body = {}; try{ body = await req.json(); }catch(e){}
    const id = String(body.id || '').trim();
    try{
      if(path === '/test'){
        const t = await territories(env, 'alger');
        return json({ok: true, message: 'Connexion ZR Express OK', sample: t.length});
      }
      if(path === '/labels'){
        const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 250) : [];
        if(!ids.length) return json({ok: false, error: 'Aucune commande'}, 400);
        const format = body.format === 'a4' ? 'a4' : 'a6';
        const list = [];
        for(let k = 0; k < ids.length; k += 10){                      // lecture par paquets de 10
          const part = await Promise.all(ids.slice(k, k + 10).map(x => getOrder(x).catch(() => null)));
          list.push(...part);
        }
        const trackings = list.map(o => o && o.zr && o.zr.tracking).filter(Boolean);   // même ordre que l'app
        if(!trackings.length) return json({ok: false, error: 'Aucune de ces commandes n\'a encore de numéro ZR'}, 400);
        // A6 : une étiquette par colis, remises dans NOTRE ordre (ZR peut réordonner le PDF groupé)
        if(format === 'a6'){
          try{
            const bi = await zr(env, '/parcels/labels/individual/pdf', {method: 'POST', body: JSON.stringify({trackingNumbers: trackings, format: 'a6'})});
            const files = (bi && bi.parcelLabelFiles) || [];
            const tnOf = f => String(f.trackingNumber || f.tracking || f.parcelTrackingNumber || (f.parcel && f.parcel.trackingNumber) || '');
            let urls;
            if(files.length && files.every(f => tnOf(f))){
              const by = {}; files.forEach(f => { by[tnOf(f)] = f.fileUrl; });
              urls = trackings.map(t => by[t]).filter(Boolean);
            }else urls = files.map(f => f.fileUrl).filter(Boolean);   // même ordre que la demande
            if(urls.length) return json({ok: true, urls, url: urls[0], count: urls.length, failed: (bi && bi.failedTrackingNumbers) || []});
          }catch(e){ /* repli : PDF groupé */ }
        }
        const b = await zr(env, '/parcels/labels/multiple/pdf', {method: 'POST', body: JSON.stringify({trackingNumbers: trackings, format})});
        if(!b || !b.fileUrl) return json({ok: false, error: 'ZR n\'a pas généré le PDF'}, 502);
        return json({ok: true, url: b.fileUrl, count: trackings.length, failed: b.failedTrackingNumbers || []});
      }
      if(!id) return json({ok: false, error: 'id manquant'}, 400);
      if(path === '/send') return json(await sendOrder(env, id, !!body.force));
      if(path === '/track'){
        const o = await getOrder(id);
        if(!o) return json({ok: false, error: 'Commande introuvable'}, 404);
        return json({ok: true, zr: await trackOrder(env, o)});
      }
      if(path === '/raw'){   // diagnostic : colis brut renvoyé par ZR
        const o = await getOrder(id);
        const pid = o && o.zr && o.zr.parcelId;
        if(!pid) return json({ok: false, error: 'pas de colis'}, 400);
        const out = {parcel: await zr(env, '/parcels/' + pid)};
        const probes = Array.isArray(body.probe) ? body.probe.slice(0, 40) : [];
        for(const pr of probes){
          const u = String(pr).replace(/^POST /, '').replace('{id}', pid).replace('{tn}', encodeURIComponent((o.zr && o.zr.tracking) || ''));
          try{ const r = await zr(env, u, pr.startsWith('POST ') ? {method: 'POST', body: JSON.stringify({parcelId: pid, pageNumber: 1, pageSize: 50})} : {}); out[pr] = JSON.stringify(r).slice(0, 30000); }
          catch(e){ out[pr] = 'ERR ' + String(e && e.message || e).slice(0, 100); }
        }
        return json(out);
      }
      if(path === '/label'){
        const o = await getOrder(id);
        const t = o && o.zr && o.zr.tracking;
        if(!t) return json({ok: false, error: 'Pas encore de numéro de suivi'}, 400);
        const b = await zr(env, '/parcels/labels/individual/pdf', {method: 'POST', body: JSON.stringify({trackingNumbers: [t], format: 'a6'})});
        const url = b && b.parcelLabelFiles && b.parcelLabelFiles[0] && b.parcelLabelFiles[0].fileUrl;
        return url ? json({ok: true, url}) : json({ok: false, error: 'Étiquette indisponible'}, 502);
      }
      if(path === '/update'){
        // commande modifiée dans l'app → le colis ZR est remplacé (tant que ZR ne l'a pas encore pris en charge)
        const o = await getOrder(id);
        if(!o) return json({ok: false, error: 'Commande introuvable'}, 404);
        const z = o.zr || {};
        if(!z.parcelId) return json(await sendOrder(env, id, true));
        const live = await zr(env, '/parcels/' + z.parcelId).catch(() => null);
        const st = (live && stageOf(live.state)) || z.stage || 'created';
        if(st !== 'created'){
          const lbl = (live && live.state && (live.state.description || live.state.name)) || st;
          return json({ok: false, locked: true, error: `Colis déjà pris en charge par ZR (${lbl}) : modification impossible depuis l'app, contactez ZR.`});
        }
        const delOld = async () => { try{ if(z.tracking) await zr(env, '/parcels/bulk/by-tracking-number', {method: 'DELETE', body: JSON.stringify({trackingNumbers: [z.tracking]})}); }catch(e){ if(!/not found/i.test(e.message)) throw e; } };
        let np = null;
        try{ np = await createParcel(env, o); await delOld(); }
        catch(e){
          if(e.permanent && !/exist|duplic|externalid|already/i.test(e.message || '')) return json({ok: false, error: e.message || String(e)});
          await delOld();
          try{ np = await createParcel(env, o); }
          catch(e2){
            const nz = {...z, parcelId: '', tracking: '', status: 'queued', active: true, stage: '', error: e2.message || String(e2), previousTracking: z.tracking || '', updatedAt: new Date().toISOString()};
            await saveZr(id, nz);
            return json({ok: false, zr: nz, error: 'Ancien colis annulé, nouveau colis pas encore créé (nouvel essai automatique) : ' + (e2.message || e2)});
          }
        }
        const now = new Date().toISOString();
        const nz = {...z, status: 'sent', active: true, parcelId: np.parcelId, tracking: np.tracking,
          state: (np.state && (np.state.description || np.state.name)) || 'Commande reçue', stage: stageOf(np.state) || 'created', situation: '',
          error: '', previousTracking: z.tracking || '', updatedAt: now, lastCheck: Date.now(), editedAt: now};
        await saveZr(id, nz);
        return json({ok: true, replaced: true, zr: nz});
      }
      if(path === '/cancel'){
        const o = await getOrder(id);
        const t = o && o.zr && o.zr.tracking;
        if(!t) return json({ok: true, cancelled: false});
        try{
          await zr(env, '/parcels/bulk/by-tracking-number', {method: 'DELETE', body: JSON.stringify({trackingNumbers: [t]})});
        }catch(e){ if(!/not found/i.test(e.message)) throw e; }
        return json({ok: true, cancelled: true});
      }
      return json({error: 'Route inconnue'}, 404);
    }catch(e){
      return json({ok: false, error: e.message || String(e)}, 502);
    }
  },
  async scheduled(event, env, ctx){
    if(env.ZR_API_KEY) ctx.waitUntil(tenantOf(env).then(t => t && cron(env)));
  }
};

// ======================================================================
// Fin du code. Les lignes ci-dessous servent seulement de marge :
// si le copier-coller sur téléphone coupe la fin, il ne coupe que ces lignes.
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ======================================================================
