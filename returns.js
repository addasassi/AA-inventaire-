/* =====================================================================
   ↩️ Retours : scanner le QR / code-barres du bordereau ZR (ou de la
   commande) → les articles de la commande reviennent automatiquement
   dans le stock. Liste des retours à récupérer / déjà récupérés.
   Dépend de : db, orders, products, currentUser, toast, saveProductDoc,
   loadProducts, loadOrders, normalizeScannedCode (index.html)
   ===================================================================== */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = iso => { try{ return new Date(iso).toLocaleString('fr-FR', {dateStyle:'short', timeStyle:'short'}); }catch(e){ return ''; } };
  const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let lastUndo = null;

  /* ---------- Trouver la commande à partir du code scanné ---------- */
  function findOrder(raw){
    const variants = [String(raw || '').trim()];
    try{ if(typeof normalizeScannedCode === 'function') variants.push(normalizeScannedCode(raw)); }catch(e){}
    const keys = variants.map(clean).filter(k => k.length >= 4);
    if(!keys.length) return null;
    const list = (typeof orders !== 'undefined' && orders) || [];
    for(const o of list){
      const tr = clean(o.zr && o.zr.tracking);
      const id = clean(o.id);
      for(const k of keys){
        if(tr && (k === tr || k.includes(tr) || (tr.length >= 8 && tr.includes(k)))) return o;
        if(id && (k === id || k.includes(id))) return o;
      }
    }
    return null;
  }

  /* ---------- Retrouver le produit / la couleur de chaque article ---------- */
  function locate(it){
    const p = products.find(x => x.id === it.productId);
    if(!p) return null;
    if(it.code){
      if(String(p.code) === String(it.code) && !(p.colors||[]).some(c => String(c.code) === String(it.code))) return {p, c: null};
      const k = (p.colors || []).findIndex(c => String(c.code) === String(it.code));
      if(k >= 0) return {p, c: p.colors[k]};
    }
    if(it.colorIndex != null && p.colors && p.colors[it.colorIndex]) return {p, c: p.colors[it.colorIndex]};
    return {p, c: null};
  }

  async function restock(o){
    if(typeof loadProducts === 'function') await loadProducts();
    const changes = [], touched = new Map();
    (o.items || []).forEach(it => {
      const q = Number(it.qty) || 0;
      if(q <= 0) return;
      const loc = locate(it);
      if(!loc){ changes.push({name: it.name, qty: q, missing: true}); return; }
      if(loc.c){ loc.c.qty = (Number(loc.c.qty) || 0) + q; }
      else { loc.p.qty = (Number(loc.p.qty) || 0) + q; }
      touched.set(loc.p.id, loc.p);
      changes.push({name: it.name, qty: q, img: it.img || (loc.c ? loc.c.img : loc.p.img), productId: loc.p.id, colorCode: loc.c ? loc.c.code : null});
    });
    const res = await Promise.all([...touched.values()].map(p => saveProductDoc(p)));
    if(res.some(r => !r)) throw new Error('stock non enregistré');
    const info = {at: new Date().toISOString(), by: (currentUser && currentUser.name) || '', items: changes.filter(c => !c.missing).map(c => ({name: c.name, qty: c.qty}))};
    o.returnInfo = info;
    await db.collection('orders').doc(o.id).set({returnInfo: info}, {merge: true});
    if(typeof refreshCurrentInventoryView === 'function') try{ refreshCurrentInventoryView(); }catch(e){}
    return changes;
  }

  async function undo(){
    const u = lastUndo; if(!u) return;
    lastUndo = null;
    if(typeof loadProducts === 'function') await loadProducts();
    const touched = new Map();
    u.changes.forEach(ch => {
      if(ch.missing) return;
      const p = products.find(x => x.id === ch.productId); if(!p) return;
      const c = ch.colorCode ? (p.colors || []).find(x => String(x.code) === String(ch.colorCode)) : null;
      if(c) c.qty = Math.max(0, (Number(c.qty) || 0) - ch.qty); else p.qty = Math.max(0, (Number(p.qty) || 0) - ch.qty);
      touched.set(p.id, p);
    });
    await Promise.all([...touched.values()].map(p => saveProductDoc(p)));
    u.order.returnInfo = null;
    await db.collection('orders').doc(u.order.id).set({returnInfo: null}, {merge: true});
    toast('Annulé — stock remis comme avant');
    renderResult(null); renderLists();
  }

  /* ---------- Scan ---------- */
  async function handle(raw){
    raw = String(raw || '').trim();
    if(!raw) return;
    if(typeof loadOrders === 'function'){ try{ await loadOrders(); }catch(e){} }
    const o = findOrder(raw);
    if(!o){ beep(false); renderResult({error: 'Aucune commande trouvée pour « ' + raw + ' »'}); return; }
    if(o.returnInfo && o.returnInfo.at){
      beep(false);
      renderResult({order: o, already: true});
      return;
    }
    try{
      const changes = await restock(o);
      lastUndo = {order: o, changes};
      beep(true);
      renderResult({order: o, changes});
      renderLists();
    }catch(e){ beep(false); renderResult({error: 'Échec : ' + (e.message || e) + ' — réessayez'}); }
  }

  function beep(ok){
    try{
      const a = new (window.AudioContext || window.webkitAudioContext)();
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08;
      o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? 0.12 : 0.35));
    }catch(e){}
    try{ if(navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]); }catch(e){}
  }

  function renderResult(r){
    const el = document.getElementById('rt-result'); if(!el) return;
    if(!r){ el.innerHTML = ''; return; }
    if(r.error){ el.innerHTML = `<div class="rt-box rt-err">❌ ${esc(r.error)}</div>`; return; }
    const o = r.order, c = o.customer || {};
    const head = `<div class="rt-cust"><b>${esc(c.name || '')}</b> · ${esc(c.phone || '')}<br><span>${esc(c.wilaya || '')}${c.commune ? ' / ' + esc(c.commune) : ''} · ${fmtDate(o.createdAt)}${o.zr && o.zr.tracking ? ' · ' + esc(o.zr.tracking) : ''}</span></div>`;
    if(r.already){
      el.innerHTML = `<div class="rt-box rt-warn">⚠️ Ce retour est <b>déjà remis en stock</b> le ${fmtDate(o.returnInfo.at)}${o.returnInfo.by ? ' par ' + esc(o.returnInfo.by) : ''}.${head}</div>`;
      return;
    }
    const rows = (r.changes || []).map(ch => `<div class="rt-it">${ch.img ? `<img src="${esc(ch.img)}">` : '<span class="rt-noimg"></span>'}<div>${esc(ch.name)}</div><b>${ch.missing ? '⚠️ produit introuvable' : '+' + ch.qty}</b></div>`).join('');
    el.innerHTML = `<div class="rt-box rt-ok">✅ <b>Retour remis en stock</b>${head}${rows}<button class="rt-undo" id="rt-undo">↶ Annuler</button></div>`;
    document.getElementById('rt-undo').onclick = undo;
  }

  /* ---------- Listes : à récupérer / récupérés ---------- */
  function renderLists(){
    const el = document.getElementById('rt-lists'); if(!el) return;
    const list = (typeof orders !== 'undefined' && orders) || [];
    const todo = list.filter(o => o.zr && o.zr.stage === 'returned' && !(o.returnInfo && o.returnInfo.at))
                     .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const done = list.filter(o => o.returnInfo && o.returnInfo.at)
                     .sort((a, b) => String(b.returnInfo.at).localeCompare(String(a.returnInfo.at))).slice(0, 30);
    const line = (o, right) => { const c = o.customer || {}; return `<div class="rt-row"><div><b>${esc(c.name || '')}</b> · ${esc(c.wilaya || '')}<br><span>${(o.items || []).map(i => esc(i.name) + ' ×' + (i.qty || 1)).join(', ')}</span></div><small>${right}</small></div>`; };
    el.innerHTML = `
      <div class="rt-sec"><div class="rt-h">🟠 Retours à récupérer chez ZR <span>${todo.length}</span></div>
        ${todo.length ? todo.map(o => line(o, esc(o.zr.tracking || ''))).join('') : '<div class="rt-empty">Aucun retour en attente</div>'}</div>
      <div class="rt-sec"><div class="rt-h">🟢 Retours remis en stock <span>${done.length}</span></div>
        ${done.length ? done.map(o => line(o, fmtDate(o.returnInfo.at) + (o.returnInfo.by ? '<br>' + esc(o.returnInfo.by) : ''))).join('') : '<div class="rt-empty">Aucun pour le moment</div>'}</div>`;
  }

  /* ---------- Caméra (QR + codes-barres) ---------- */
  let stream = null, timer = null;
  function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function openCamera(){
    const m = document.createElement('div'); m.id = 'rt-cam';
    m.innerHTML = `<div class="rt-cam-card"><div class="rt-cam-t">📷 Visez le QR / code-barres du bordereau</div><div id="rt-cam-view"><video id="rt-video" playsinline muted></video></div><button id="rt-cam-close">Fermer</button></div>`;
    document.body.appendChild(m);
    const close = () => { try{ if(timer) clearInterval(timer); timer = null; if(stream) stream.getTracks().forEach(t => t.stop()); stream = null; if(window.__rtH5) { window.__rtH5.stop().catch(()=>{}); window.__rtH5 = null; } }catch(e){} m.remove(); };
    document.getElementById('rt-cam-close').onclick = close;
    const found = (txt) => { close(); handle(txt); };
    try{
      if('BarcodeDetector' in window){
        const det = new BarcodeDetector({formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'data_matrix', 'pdf417', 'itf']});
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
        const v = document.getElementById('rt-video'); v.srcObject = stream; await v.play();
        timer = setInterval(async () => { try{ const r = await det.detect(v); if(r && r[0] && r[0].rawValue) found(r[0].rawValue); }catch(e){} }, 250);
      } else {
        await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
        document.getElementById('rt-cam-view').innerHTML = '<div id="rt-h5"></div>';
        window.__rtH5 = new Html5Qrcode('rt-h5');
        await window.__rtH5.start({facingMode: 'environment'}, {fps: 10, qrbox: 240}, txt => found(txt));
      }
    }catch(e){ close(); toast('Caméra indisponible : ' + (e.message || e), true); }
  }

  /* ---------- Interface (dans l'onglet Scanner) ---------- */
  function ui(){
    if(document.getElementById('rt-section')) return;
    const view = document.getElementById('view-scan'); if(!view) return;
    const st = document.createElement('style');
    st.textContent = `
      #rt-section{margin-top:26px;padding-top:18px;border-top:2px solid var(--line);}
      #rt-section .rt-title{font-weight:800;font-size:16px;color:var(--plum);margin-bottom:6px;}
      #rt-section .rt-row-in{display:flex;gap:8px;}
      #rt-section .rt-row-in input{flex:1;min-width:0;}
      #rt-section .rt-row-in button{flex:0 0 auto;padding:0 14px;border:none;border-radius:9px;background:var(--plum);color:var(--cream);font-weight:700;}
      .rt-box{border-radius:14px;padding:12px;margin-top:12px;font-size:14px;line-height:1.45;}
      .rt-ok{background:#dcf3e6;color:#16502f;} .rt-err{background:#f8dedb;color:#8e2f27;} .rt-warn{background:#fff1c9;color:#6b4b00;}
      .rt-cust{margin:6px 0 4px;font-size:13px;} .rt-cust span{opacity:.8;}
      .rt-it{display:flex;align-items:center;gap:10px;background:#fff;border-radius:10px;padding:6px;margin-top:6px;color:#222;}
      .rt-it img,.rt-noimg{width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#eee;}
      .rt-it div{flex:1;min-width:0;font-size:13px;} .rt-it b{color:#1e7b45;font-size:15px;}
      .rt-undo{margin-top:10px;width:100%;border:1px solid #9cc9ae;background:#fff;color:#16502f;border-radius:10px;padding:9px;font-weight:700;}
      .rt-sec{margin-top:16px;} .rt-h{font-weight:800;color:var(--plum);margin-bottom:6px;display:flex;align-items:center;gap:8px;}
      .rt-h span{background:var(--plum);color:var(--cream);border-radius:999px;padding:1px 9px;font-size:12px;}
      .rt-row{display:flex;justify-content:space-between;gap:10px;background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;padding:9px 10px;margin-bottom:6px;font-size:13px;}
      .rt-row span{opacity:.75;font-size:12px;} .rt-row small{text-align:right;opacity:.75;flex-shrink:0;font-size:11.5px;}
      .rt-empty{font-size:13px;opacity:.7;padding:4px 2px;}
      #rt-cam{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;}
      .rt-cam-card{width:100%;max-width:440px;background:#111;border-radius:16px;padding:12px;color:#fff;text-align:center;}
      .rt-cam-t{font-weight:700;margin-bottom:8px;} #rt-cam video,#rt-h5{width:100%;border-radius:12px;background:#000;}
      #rt-cam-close{margin-top:10px;width:100%;padding:12px;border:none;border-radius:10px;font-weight:700;}
    `;
    document.head.appendChild(st);
    const sec = document.createElement('div'); sec.id = 'rt-section';
    sec.innerHTML = `
      <div class="rt-title">↩️ Réception d'un retour</div>
      <div class="note" style="margin-bottom:8px;">Scannez le QR / code-barres du bordereau ZR Express (ou tapez le n° de suivi) : tous les articles de la commande reviennent dans le stock.</div>
      <div class="rt-row-in"><input type="text" id="rt-code" placeholder="Scan du bordereau…" autocomplete="off"><button id="rt-ok">OK</button><button id="rt-camera" title="Caméra">📷</button></div>
      <div id="rt-result"></div>
      <div id="rt-lists"></div>`;
    view.appendChild(sec);
    const inp = document.getElementById('rt-code');
    const go = () => { const v = inp.value; inp.value = ''; handle(v); inp.focus(); };
    document.getElementById('rt-ok').onclick = go;
    inp.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); go(); } });
    document.getElementById('rt-camera').onclick = openCamera;
    renderLists();
  }

  function init(){
    ui();
    document.querySelectorAll('.tab-btn[data-tab="scan"]').forEach(b => b.addEventListener('click', () => { ui(); if(typeof loadOrders === 'function') loadOrders().then(renderLists).catch(()=>{}); else renderLists(); }));
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.returnsHandle = handle;
})();
