/* =====================================================================
   Atelier Stock ⇄ Shopify (A&A VÊTEMENTS)
   - Bouton « Synchroniser Shopify » : envoie les produits, couleurs,
     prix, quantités, nouveaux produits/couleurs et photos vers Shopify.
   - Les commandes du site Shopify diminuent automatiquement le stock
     ici (à l'ouverture de l'app, toutes les 3 min, et avant chaque synchro).
   Dépend de : db, products, currentUser, toast (index.html)
   ===================================================================== */
(function(){
  const LS_URL = 'shopify-relay-url';
  const LS_KEY = 'shopify-relay-key';
  const META_DOC = 'shopifySync';
  const OPTION = 'اللون';
  const VENDOR = 'A&A';
  const CAT_INFO = {
    'فوندغوب':['fond-de-robe','فوند غوب ناعم ومريح، قماش خفيف يبان شباب عليك.'],
    'بيجامات':['pyjama','بيجامة مريحة للدار، قماش ناعم وخفيف.'],
    'براسيار جيب':['ensemble','طقم براسيار وجيب، ستايل شيك ومريح.'],
    'بيستي شورت':['bustier-short','طقم بيستي وشورت خفيف للصيف والدار.'],
    'روبات':['robe','روبة أنيقة، قماش مريح وتفصيلة تبان مليحة.'],
    'نويزات':['nuisette','نويزات ناعمة وخفيفة.']
  };
  const DELIVERY = '<p>🚚 توصيل لكل الولايات — الدفع عند الاستلام</p>';

  let running = false;
  let ordersTimer = null;

  /* ---------- Réglages ---------- */
  function cfg(){
    let url = '', key = '';
    try{ url = localStorage.getItem(LS_URL) || ''; key = localStorage.getItem(LS_KEY) || ''; }catch(e){}
    return { url: url.replace(/\/+$/,''), key };
  }
  function isReady(){ const c = cfg(); return !!(c.url && c.key); }
  function isAdmin(){ return typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin'; }

  /* ---------- Relais ---------- */
  async function gql(query, variables){
    const c = cfg();
    const r = await fetch(c.url + '/graphql', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-App-Key':c.key},
      body: JSON.stringify({query, variables})
    });
    const txt = await r.text();
    let j; try{ j = JSON.parse(txt); }catch(e){ throw new Error('Relais: réponse invalide ('+r.status+')'); }
    if(r.status === 401) throw new Error('Clé du relais incorrecte');
    if(j.error) throw new Error(j.error);
    if(j.errors) throw new Error(j.errors.map(e=>e.message).join(' | '));
    return j.data;
  }
  function userErr(res){
    const out = [];
    Object.values(res || {}).forEach(v=>{
      if(!v) return;
      (v.userErrors || v.mediaUserErrors || []).forEach(e=> out.push(e.message));
    });
    if(out.length) throw new Error(out.join(' | '));
    return res;
  }

  /* ---------- Utilitaires ---------- */
  function hashStr(s){
    s = String(s || ''); let h = 2166136261;
    for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h>>>0).toString(36) + s.length.toString(36);
  }
  function money(v){ const n = Number(v); return isFinite(n) ? String(Math.round(n)) : '0'; }
  function int(v){ const n = parseInt(v,10); return isFinite(n) && n > 0 ? n : 0; }
  function colorsOf(p){ return Array.isArray(p.colors) ? p.colors.filter(c=>c && c.code) : []; }
  function colorPrice(p, c){ return (c.price != null && c.price !== '') ? c.price : p.price; }
  function codesOf(p){
    const cols = colorsOf(p);
    return cols.length ? cols.map(c=>String(c.code)) : (p.code ? [String(p.code)] : []);
  }
  function mimeOf(dataUrl){ const m = String(dataUrl||'').match(/^data:([^;]+);base64,/); return m ? m[1] : null; }

  async function getMeta(){
    try{
      const d = await db.collection('meta').doc(META_DOC).get();
      return d.exists ? d.data() : {};
    }catch(e){ return {}; }
  }
  async function setMeta(patch){
    await db.collection('meta').doc(META_DOC).set(patch, {merge:true});
  }

  /* ---------- Envoi d'une image (base64) vers Shopify ---------- */
  async function uploadImage(dataUrl, name){
    const mime = mimeOf(dataUrl);
    if(!mime) return null;
    const ext = mime.split('/')[1] === 'png' ? 'png' : 'jpg';
    const filename = (name || 'photo') + '.' + ext;
    const res = userErr(await gql(
      `mutation SU($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }`,
      {input:[{resource:'IMAGE', filename, mimeType:mime, httpMethod:'POST'}]}
    ));
    const t = res.stagedUploadsCreate.stagedTargets[0];
    const c = cfg();
    const r = await fetch(c.url + '/upload', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-App-Key':c.key},
      body: JSON.stringify({url:t.url, parameters:t.parameters, dataUrl, filename})
    });
    if(!r.ok) throw new Error('Envoi photo échoué ('+r.status+')');
    return t.resourceUrl;
  }

  /* ---------- Lecture de Shopify ---------- */
  async function loadShopify(){
    const list = []; let after = null, locationId = null, onlineStore = null;
    for(let page=0; page<20; page++){
      const d = await gql(`query P($after:String){
        products(first:50, after:$after){ pageInfo{ hasNextPage endCursor }
          nodes{ id title status productType tags handle
            options{ name }
            media(first:50){ nodes{ id } }
            variants(first:100){ nodes{ id sku price title inventoryQuantity inventoryItem{ id tracked } media(first:5){ nodes{ id } } } } } }
        locations(first:5){ nodes{ id isActive } }
        publications(first:10){ nodes{ id name } } }`, {after});
      list.push(...d.products.nodes);
      if(!locationId){
        const loc = d.locations.nodes.find(l=>l.isActive) || d.locations.nodes[0];
        locationId = loc && loc.id;
        const pub = d.publications.nodes.find(p=>/online store/i.test(p.name));
        onlineStore = pub && pub.id;
      }
      if(!d.products.pageInfo.hasNextPage) break;
      after = d.products.pageInfo.endCursor;
    }
    const bySku = {};
    list.forEach(sp=> sp.variants.nodes.forEach(v=>{ if(v.sku) bySku[String(v.sku)] = {product:sp, variant:v}; }));
    return {list, bySku, locationId, onlineStore};
  }

  /* ---------- Commandes Shopify → stock Atelier ---------- */
  async function pullOrders(silent){
    if(!isReady() || !isAdmin() || typeof db === 'undefined' || !db) return 0;
    let meta = await getMeta();
    if(!meta.since){
      meta.since = new Date().toISOString();
      await setMeta({since: meta.since, processed: [], cancelled: []});
      return 0;
    }
    const d = await gql(`query O($q:String){ orders(first:50, sortKey:CREATED_AT, reverse:true, query:$q){
        nodes{ id name createdAt cancelledAt lineItems(first:50){ nodes{ sku quantity variant{ sku } } } } } }`,
      {q: 'created_at:>=' + meta.since});
    const orders = d.orders.nodes;
    if(!orders.length) return 0;

    const metaRef = db.collection('meta').doc(META_DOC);
    const applied = await db.runTransaction(async tx=>{
      const mSnap = await tx.get(metaRef);
      const m = mSnap.exists ? mSnap.data() : {};
      const processed = new Set(m.processed || []);
      const cancelled = new Set(m.cancelled || []);
      // delta par code : négatif = vendu sur le site, positif = commande annulée
      const delta = {}; const newProc = []; const newCanc = [];
      orders.forEach(o=>{
        const add = (sign)=> o.lineItems.nodes.forEach(li=>{
          const sku = String((li.variant && li.variant.sku) || li.sku || '');
          if(sku) delta[sku] = (delta[sku]||0) + sign * (li.quantity||0);
        });
        if(!processed.has(o.id)){
          newProc.push(o.id);
          if(o.cancelledAt){ newCanc.push(o.id); } // annulée avant d'être comptée : rien à faire
          else add(-1);
        } else if(o.cancelledAt && !cancelled.has(o.id)){
          newCanc.push(o.id); add(+1);
        }
      });
      if(!newProc.length && !newCanc.length) return [];
      // retrouve les produits concernés
      const touched = products.filter(p=> codesOf(p).some(c=> delta[c]) || (p.code && delta[String(p.code)]));
      const snaps = [];
      for(const p of touched){ snaps.push([p, await tx.get(db.collection('products').doc(p.id))]); }
      const log = [];
      snaps.forEach(([p, s])=>{
        if(!s.exists) return;
        const doc = s.data(); let changed = false;
        const cols = Array.isArray(doc.colors) ? doc.colors : [];
        cols.forEach(c=>{
          const dl = delta[String(c.code)];
          if(dl){ c.qty = Math.max(0, (Number(c.qty)||0) + dl); changed = true; log.push((doc.name||'')+' '+(dl>0?'+':'')+dl); }
        });
        if(!cols.length && doc.code && delta[String(doc.code)]){
          const dl = delta[String(doc.code)];
          doc.qty = Math.max(0, (Number(doc.qty)||0) + dl); changed = true; log.push((doc.name||'')+' '+(dl>0?'+':'')+dl);
        }
        if(changed) tx.set(db.collection('products').doc(p.id), doc);
      });
      const keep = (arr)=> arr.slice(-400);
      tx.set(metaRef, {
        processed: keep([...(m.processed||[]), ...newProc]),
        cancelled: keep([...(m.cancelled||[]), ...newCanc]),
        lastOrdersPull: new Date().toISOString()
      }, {merge:true});
      return log;
    });
    if(applied && applied.length && !silent){
      toast('🛍️ Commandes du site : ' + applied.join(', '));
    } else if(applied && applied.length){
      toast('🛍️ Stock mis à jour (commandes du site)');
    }
    return applied ? applied.length : 0;
  }

  /* ---------- Atelier → Shopify ---------- */
  async function pushAll(log){
    const shop = await loadShopify();
    if(!shop.locationId) throw new Error('Aucun emplacement Shopify');
    const meta = await getMeta();
    const imgHash = Object.assign({}, meta.img || {});
    const firstRun = !meta.img;
    const prevCodes = new Set(meta.codes || []);
    const stats = {qty:0, price:0, created:0, newColors:0, photos:0, titles:0, drafted:0};
    const qtyUpdates = [];
    const seenProducts = new Set();

    for(const p of products){
      const codes = codesOf(p);
      if(!codes.length) continue;
      const cols = colorsOf(p);
      const match = codes.map(c=> shop.bySku[c]).find(Boolean) || (p.code ? shop.bySku[String(p.code)] : null);

      // ---------- Nouveau produit ----------
      if(!match){
        log('➕ Nouveau : ' + p.name);
        await createProduct(p, shop, imgHash);
        stats.created++;
        continue;
      }
      const sp = match.product;
      seenProducts.add(sp.id);

      // Titre / catégorie / remise en ligne
      const upd = {id: sp.id};
      if(p.name && sp.title !== p.name){ upd.title = p.name; }
      if(p.cat && sp.productType !== p.cat){ upd.productType = p.cat; upd.tags = [p.cat]; }
      if(Object.keys(upd).length > 1){
        userErr(await gql(`mutation PU($product:ProductUpdateInput!){ productUpdate(product:$product){ userErrors{ field message } } }`, {product:upd}));
        stats.titles++;
      }

      const spVariants = sp.variants.nodes;
      const isDefault = spVariants.length === 1 && /default title/i.test(spVariants[0].title);

      // Produit sans couleur dans Shopify mais avec couleurs dans Atelier → reconstruire
      if(cols.length && isDefault && !cols.some(c=> shop.bySku[String(c.code)])){
        log('🎨 Couleurs ajoutées : ' + p.name);
        await createProduct(p, shop, imgHash, sp.id);
        stats.newColors += cols.length;
        continue;
      }

      const priceUpdates = [];
      const newVariants = [];
      const existingNames = new Set(spVariants.map(v=>v.title));
      const units = cols.length ? cols.map((c,i)=>({code:String(c.code), qty:int(c.qty), price:money(colorPrice(p,c)), img:c.img, idx:i}))
                                : [{code:String(p.code), qty:int(p.qty), price:money(p.price), img:p.img, idx:-1}];
      for(const u of units){
        const hit = shop.bySku[u.code];
        if(hit && hit.product.id === sp.id){
          const v = hit.variant;
          if(money(v.price) !== u.price) priceUpdates.push({id:v.id, price:u.price});
          if((v.inventoryQuantity||0) !== u.qty) qtyUpdates.push({productId:sp.id, variantId:v.id, delta:u.qty-(v.inventoryQuantity||0)});
          // Photo modifiée ?
          const h = hashStr(u.img);
          if(firstRun || !imgHash[u.code]){ imgHash[u.code] = h; }
          else if(u.img && imgHash[u.code] !== h){
            log('📷 Photo : ' + p.name + (u.idx>=0 ? ' #'+(u.idx+1) : ''));
            await replacePhoto(sp, v, u, isDefault);
            imgHash[u.code] = h; stats.photos++;
          }
        } else if(!hit){
          let name = 'لون ' + (u.idx+1); let k = u.idx+1;
          while(existingNames.has(name)){ k++; name = 'لون ' + k; }
          existingNames.add(name);
          newVariants.push({u, name});
        }
      }
      if(priceUpdates.length){
        userErr(await gql(`mutation U($productId:ID!,$variants:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$productId, variants:$variants){ userErrors{ field message } } }`,
          {productId: sp.id, variants: priceUpdates}));
        stats.price += priceUpdates.length;
      }
      if(newVariants.length){
        log('🎨 Nouvelle couleur : ' + p.name + ' (' + newVariants.length + ')');
        const variants = [], media = [];
        for(const nv of newVariants){
          const src = nv.u.img ? await uploadImage(nv.u.img, 'c'+nv.u.code) : null;
          const item = {
            optionValues:[{optionName: (sp.options[0] && sp.options[0].name) || OPTION, name: nv.name}],
            price: nv.u.price,
            inventoryItem:{sku: nv.u.code, tracked:true},
            inventoryQuantities:[{locationId: shop.locationId, availableQuantity: nv.u.qty}]
          };
          if(src){ item.mediaSrc = [src]; media.push({originalSource:src, mediaContentType:'IMAGE', alt: p.name + ' - ' + nv.name}); }
          variants.push(item);
          imgHash[nv.u.code] = hashStr(nv.u.img);
        }
        userErr(await gql(`mutation C($productId:ID!,$variants:[ProductVariantsBulkInput!]!,$media:[CreateMediaInput!]){ productVariantsBulkCreate(productId:$productId, variants:$variants, media:$media){ productVariants{ id } userErrors{ field message } } }`,
          {productId: sp.id, variants, media: media.length ? media : null}));
        stats.newColors += newVariants.length;
      }
      // Couleurs supprimées dans Atelier → stock 0 sur Shopify
      spVariants.forEach(v=>{
        if(v.sku && !codes.includes(String(v.sku)) && !(isDefault && cols.length) && (v.inventoryQuantity||0) !== 0){
          qtyUpdates.push({productId:sp.id, variantId:v.id, delta:-(v.inventoryQuantity||0)});
        }
      });
    }

    // Quantités (ajustements par produit)
    const byProduct = {};
    qtyUpdates.forEach(q=>{ (byProduct[q.productId] = byProduct[q.productId] || []).push(q); });
    for(const pid of Object.keys(byProduct)){
      const variants = byProduct[pid].map(q=>({id:q.variantId, quantityAdjustments:[{locationId:shop.locationId, adjustment:q.delta}]}));
      userErr(await gql(`mutation U($productId:ID!,$variants:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$productId, variants:$variants){ userErrors{ field message } } }`,
        {productId: pid, variants}));
      stats.qty += variants.length;
    }

    // Produits supprimés dans Atelier → masqués (brouillon) sur Shopify
    const nowCodes = new Set(products.flatMap(codesOf));
    if(prevCodes.size){
      for(const sp of shop.list){
        if(seenProducts.has(sp.id) || sp.status !== 'ACTIVE') continue;
        const skus = sp.variants.nodes.map(v=>String(v.sku||'')).filter(Boolean);
        if(skus.length && skus.every(s=> prevCodes.has(s) && !nowCodes.has(s))){
          log('🗑️ Retiré du site : ' + sp.title);
          userErr(await gql(`mutation PU($product:ProductUpdateInput!){ productUpdate(product:$product){ userErrors{ field message } } }`, {product:{id:sp.id, status:'DRAFT'}}));
          stats.drafted++;
        }
      }
    }

    await setMeta({img: imgHash, codes: [...nowCodes], lastPush: new Date().toISOString()});
    return stats;
  }

  async function createProduct(p, shop, imgHash, existingId){
    const cols = colorsOf(p);
    const info = CAT_INFO[p.cat] || ['produit',''];
    const files = []; const variants = [];
    if(cols.length){
      const names = cols.map((c,i)=> 'لون ' + (i+1));
      for(let i=0;i<cols.length;i++){
        const c = cols[i];
        const src = c.img ? await uploadImage(c.img, 'c'+c.code) : null;
        const v = {
          optionValues:[{optionName:OPTION, name:names[i]}], price: money(colorPrice(p,c)), sku: String(c.code),
          inventoryItem:{tracked:true},
          inventoryQuantities:[{locationId: shop.locationId, name:'available', quantity:int(c.qty)}]
        };
        if(src){ const f = {originalSource:src, contentType:'IMAGE', alt: p.name + ' - ' + names[i]}; v.file = f; files.push(f); }
        variants.push(v);
        imgHash[String(c.code)] = hashStr(c.img);
      }
    } else {
      const src = p.img ? await uploadImage(p.img, 'p'+p.code) : null;
      if(src) files.push({originalSource:src, contentType:'IMAGE', alt:p.name});
      variants.push({
        optionValues:[{optionName:'Title', name:'Default Title'}], price: money(p.price), sku: String(p.code),
        inventoryItem:{tracked:true},
        inventoryQuantities:[{locationId: shop.locationId, name:'available', quantity:int(p.qty)}]
      });
      imgHash[String(p.code)] = hashStr(p.img);
    }
    const input = {
      title: p.name, vendor: VENDOR, productType: p.cat || '', tags: p.cat ? [p.cat] : [], status:'ACTIVE',
      productOptions: cols.length ? [{name:OPTION, values: variants.map(v=>({name:v.optionValues[0].name}))}]
                                  : [{name:'Title', values:[{name:'Default Title'}]}],
      variants
    };
    if(files.length) input.files = files;
    if(!existingId){
      const num = (String(p.name||'').match(/\d+/)||[])[0];
      input.handle = info[0] + '-' + (num || p.code) + (num ? '-' + String(p.code).slice(-4) : '');
      input.descriptionHtml = (info[1] ? '<p>'+info[1]+'</p>' : '') + DELIVERY;
    }
    const res = userErr(await gql(`mutation PS($input:ProductSetInput!,$identifier:ProductSetIdentifiers){ productSet(input:$input, identifier:$identifier, synchronous:true){ product{ id } userErrors{ field message } } }`,
      {input, identifier: existingId ? {id: existingId} : null}));
    const id = res.productSet.product && res.productSet.product.id;
    if(id && !existingId && shop.onlineStore){
      userErr(await gql(`mutation PP($id:ID!,$input:[PublicationInput!]!){ publishablePublish(id:$id, input:$input){ userErrors{ field message } } }`,
        {id, input:[{publicationId: shop.onlineStore}]}));
    }
    return id;
  }

  async function replacePhoto(sp, v, u, isDefault){
    const src = await uploadImage(u.img, (isDefault?'p':'c') + u.code);
    if(!src) return;
    const old = isDefault ? sp.media.nodes.map(m=>m.id) : v.media.nodes.map(m=>m.id);
    const res = userErr(await gql(`mutation PM($productId:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$productId, media:$media){ media{ id status } mediaUserErrors{ field message } } }`,
      {productId: sp.id, media:[{originalSource:src, mediaContentType:'IMAGE', alt: sp.title}]}));
    const newId = res.productCreateMedia.media[0] && res.productCreateMedia.media[0].id;
    if(newId && !isDefault){
      // attendre que Shopify traite l'image avant de la lier à la couleur
      for(let i=0;i<6;i++){
        try{
          userErr(await gql(`mutation VM($productId:ID!,$variantMedia:[ProductVariantAppendMediaInput!]!){ productVariantAppendMedia(productId:$productId, variantMedia:$variantMedia){ userErrors{ field message } } }`,
            {productId: sp.id, variantMedia:[{variantId: v.id, mediaIds:[newId]}]}));
          break;
        }catch(e){ if(i===5) throw e; await new Promise(r=>setTimeout(r, 2000)); }
      }
    }
    if(old.length){
      try{
        await gql(`mutation DM($productId:ID!,$mediaIds:[ID!]!){ productDeleteMedia(productId:$productId, mediaIds:$mediaIds){ deletedMediaIds mediaUserErrors{ field message } } }`,
          {productId: sp.id, mediaIds: old});
      }catch(e){}
    }
  }

  /* ---------- Interface ---------- */
  function ensureUI(){
    if(document.getElementById('shopifySyncModal')) return;
    const css = document.createElement('style');
    css.textContent = `
      #shopifySyncModal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;z-index:9999;}
      #shopifySyncModal.show{display:flex;}
      #shopifySyncModal .ss-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;}
      #shopifySyncModal h3{margin:0 0 6px;font-size:18px;}
      #shopifySyncModal .ss-log{background:var(--cream,#f7f2ef);border-radius:12px;padding:10px;font-size:12.5px;line-height:1.6;max-height:38vh;overflow:auto;margin-top:12px;white-space:pre-wrap;}
      #shopifySyncModal input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line,#ddd);border-radius:10px;font-size:14px;margin-top:4px;background:var(--card,#fff);color:inherit;}
      #shopifySyncModal label{font-size:12.5px;font-weight:700;display:block;margin-top:10px;}
      #shopifySyncModal .ss-row{display:flex;gap:8px;margin-top:14px;}
      #shopifySyncModal .ss-row button{flex:1;margin-top:0;}
    `;
    document.head.appendChild(css);
    const m = document.createElement('div');
    m.id = 'shopifySyncModal';
    m.innerHTML = `<div class="ss-card">
      <h3>🛍️ Boutique en ligne (Shopify)</h3>
      <div class="note" id="ss-status"></div>
      <div id="ss-settings" style="display:none;">
        <label>Adresse du relais (Cloudflare)</label>
        <input type="url" id="ss-url" placeholder="https://atelier-shopify.xxxx.workers.dev">
        <label>Clé secrète</label>
        <input type="password" id="ss-key" placeholder="••••••••">
        <div class="ss-row"><button class="btn-secondary" id="ss-save">Enregistrer</button></div>
      </div>
      <div class="ss-row">
        <button class="btn-primary" id="ss-run">Synchroniser maintenant</button>
      </div>
      <div class="ss-row">
        <button class="btn-secondary" id="ss-toggle-settings">⚙️ Réglages</button>
        <button class="btn-secondary" id="ss-close">Fermer</button>
      </div>
      <div class="ss-log" id="ss-log" style="display:none;"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e=>{ if(e.target === m) closeModal(); });
    document.getElementById('ss-close').onclick = closeModal;
    document.getElementById('ss-toggle-settings').onclick = ()=>{
      const s = document.getElementById('ss-settings');
      s.style.display = s.style.display === 'none' ? '' : 'none';
    };
    document.getElementById('ss-save').onclick = ()=>{
      const url = document.getElementById('ss-url').value.trim();
      const key = document.getElementById('ss-key').value.trim();
      try{ localStorage.setItem(LS_URL, url); localStorage.setItem(LS_KEY, key); }catch(e){}
      toast('Réglages Shopify enregistrés');
      refreshStatus(); startOrdersPolling();
    };
    document.getElementById('ss-run').onclick = runSync;
  }
  async function refreshStatus(){
    const el = document.getElementById('ss-status');
    if(!el) return;
    if(!isReady()){
      el.textContent = 'Pas encore configuré : ouvrez ⚙️ Réglages et collez l\'adresse du relais + la clé.';
      document.getElementById('ss-settings').style.display = '';
      return;
    }
    const meta = await getMeta();
    const f = (iso)=> iso ? new Date(iso).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}) : '—';
    el.textContent = 'Dernière synchro : ' + f(meta.lastPush) + ' · Commandes du site vérifiées : ' + f(meta.lastOrdersPull || meta.since);
  }
  function openModal(){
    if(!isAdmin()){ toast('Réservé à l\'admin', true); return; }
    ensureUI();
    const c = cfg();
    document.getElementById('ss-url').value = c.url;
    document.getElementById('ss-key').value = c.key;
    document.getElementById('ss-settings').style.display = isReady() ? 'none' : '';
    document.getElementById('shopifySyncModal').classList.add('show');
    refreshStatus();
  }
  function closeModal(){ const m = document.getElementById('shopifySyncModal'); if(m) m.classList.remove('show'); }

  async function runSync(){
    if(running) return;
    if(!isReady()){ toast('Configurez d\'abord le relais', true); return; }
    running = true;
    const btn = document.getElementById('ss-run');
    const logEl = document.getElementById('ss-log');
    btn.disabled = true; btn.textContent = '⏳ Synchronisation...';
    logEl.style.display = ''; logEl.textContent = '';
    const log = (s)=>{ logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; };
    try{
      log('1/2 · Commandes du site → stock...');
      const n = await pullOrders(true);
      log(n ? '   ' + n + ' article(s) mis à jour' : '   aucune nouvelle commande');
      await new Promise(r=>setTimeout(r, 800)); // laisse le stock local se rafraîchir
      log('2/2 · Atelier Stock → Shopify...');
      const s = await pushAll(log);
      log('✅ Terminé : ' + ([
        s.qty && (s.qty + ' quantité(s)'), s.price && (s.price + ' prix'), s.created && (s.created + ' nouveau(x) produit(s)'),
        s.newColors && (s.newColors + ' couleur(s)'), s.photos && (s.photos + ' photo(s)'), s.titles && (s.titles + ' nom(s)/catégorie(s)'),
        s.drafted && (s.drafted + ' retiré(s)')
      ].filter(Boolean).join(', ') || 'tout était déjà à jour'));
      toast('✅ Shopify synchronisé');
    }catch(e){
      log('❌ Erreur : ' + (e.message || e));
      toast('Erreur synchro Shopify', true);
    }
    btn.disabled = false; btn.textContent = 'Synchroniser maintenant';
    running = false;
    refreshStatus();
  }

  function startOrdersPolling(){
    if(ordersTimer) clearInterval(ordersTimer);
    if(!isReady()) return;
    const tick = ()=>{ if(!running && isAdmin()) pullOrders(false).catch(()=>{}); };
    setTimeout(tick, 4000);
    ordersTimer = setInterval(tick, 3*60*1000);
  }

  function injectButtons(){
    // Bouton dans « Actions rapides » (admin)
    const actions = document.querySelector('#view-accueil .dash-actions');
    if(actions && !document.getElementById('dash-btn-shopify')){
      const b = document.createElement('button');
      b.className = 'dash-action admin-only'; b.id = 'dash-btn-shopify';
      b.textContent = '🛍️ Synchroniser Shopify';
      b.style.gridColumn = '1 / -1';
      b.onclick = openModal;
      actions.appendChild(b);
    }
  }

  // Démarrage : après connexion (enterApp)
  const origEnter = window.enterApp;
  function afterLogin(){
    injectButtons();
    const b = document.getElementById('dash-btn-shopify');
    if(b) b.style.display = isAdmin() ? '' : 'none';
    if(isAdmin()) startOrdersPolling();
  }
  if(typeof origEnter === 'function'){
    window.enterApp = function(){ const r = origEnter.apply(this, arguments); try{ afterLogin(); }catch(e){} return r; };
  }
  // Au cas où la session est déjà ouverte
  document.addEventListener('DOMContentLoaded', ()=> setTimeout(()=>{ try{ if(typeof currentUser!=='undefined' && currentUser) afterLogin(); }catch(e){} }, 1500));
  setTimeout(()=>{ try{ if(typeof currentUser!=='undefined' && currentUser) afterLogin(); }catch(e){} }, 2500);

  window.openShopifySync = openModal;
  window.__shopifyPushAll = pushAll;
  window.shopifyPullOrders = pullOrders;
})();
