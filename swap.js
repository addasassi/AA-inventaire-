/* ============================================================
   🔁 Swap : une nouvelle commande a EXACTEMENT les mêmes articles (mêmes modèles, couleurs, quantités)
   qu'un colis chez ZR en « Ne répond pas 2/3 » ou « Annulée ».
   → au lieu d'envoyer un nouveau colis, on fait changer la cliente du colis qui allait revenir.
   Rien n'est fait automatiquement : on prévient, et on peut retenir la nouvelle commande (pas d'envoi ZR).
   ============================================================ */
(function(){
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(s || ''));
  const sitOf = o => { const s = (o.zr && o.zr.situation) || ''; return isUuid(s) ? '' : s; };
  const final = o => { const st = o.zr && o.zr.stage; return st === 'delivered' || st === 'returned'; };
  const nrpN = o => { const m = norm(sitOf(o)).match(/r[e]?pond\w*\s+pas\D*(\d)/); return m ? Number(m[1]) : (/repond pas|sans reponse|injoignable/.test(norm(sitOf(o))) ? 1 : 0); };
  const isAnn = o => /annul|refus/.test(norm(sitOf(o)));
  const sent = o => !!(o.zr && (o.zr.parcelId || o.zr.tracking));
  const all = () => (typeof orders !== 'undefined' ? orders : []);

  // colis chez ZR qui risque de revenir
  const risky = o => sent(o) && !final(o) && !o.swappedTo && (isAnn(o) || nrpN(o) >= 2);
  const label = o => isAnn(o) ? 'Annulée' : 'Ne répond pas ' + nrpN(o);
  // commande pas encore envoyée (ni en main propre)
  const pending = o => !sent(o) && !o.swap && !(o.customer && o.customer.deliveryType === 'main');
  // signature des articles : modèle + couleur + quantité (tout doit être identique)
  const sig = o => {
    const m = {};
    (o.items || []).forEach(it => {
      const k = (it.productId || it.code || it.name || '') + '|' + (it.colorIndex == null ? '' : it.colorIndex);
      m[k] = (m[k] || 0) + (Number(it.qty) || 1);
    });
    return Object.keys(m).sort().map(k => k + 'x' + m[k]).join(';');
  };

  const matches = o => {
    if(!o || !(o.items || []).length) return [];
    const s = sig(o);
    return all().filter(x => x.id !== o.id && risky(x) && sig(x) === s);
  };
  const pendingFor = r => {
    if(!r || !(r.items || []).length) return [];
    const s = sig(r);
    return all().filter(x => x.id !== r.id && pending(x) && sig(x) === s);
  };
  const who = x => { const c = x.customer || {}; return esc(c.name || 'Cliente') + (c.wilaya ? ' (' + esc(c.wilaya) + ')' : ''); };
  const line = (x, forId) => `<div class="swap-o"><b>${who(x)}</b> · <span class="swap-lv${isAnn(x) ? ' x' : ''}">${esc(label(x))}</span>
      ${x.zr && x.zr.tracking ? `<span class="swap-t">${esc(x.zr.tracking)}</span>` : ''}
      ${x.customer && x.customer.phone ? `<a class="swap-call" href="tel:${esc(x.customer.phone)}" onclick="event.stopPropagation()">📞</a>` : ''}
      ${forId ? `<button class="swap-done" onclick="event.stopPropagation();swapDone('${esc(forId)}','${esc(x.id)}')">✅ Swap fait</button>` : ''}</div>`;

  /* bandeau dans la liste des commandes et dans le détail */
  function banner(o){
    if(!o) return '';
    if(o.swap) return `<div class="swap-note ok">✅ <b>Swap fait</b> — part avec le colis ${o.swap.tracking ? '<span class="swap-t">' + esc(o.swap.tracking) + '</span> ' : ''}de ${esc(o.swap.name || 'la cliente')}. Pas d'envoi ZR, articles remis en stock.
      <button class="swap-undo" onclick="event.stopPropagation();swapUndo('${esc(o.id)}')">↶ Annuler le swap</button></div>`;
    if(o.swappedTo) return `<div class="swap-note ok">🔁 <b>Swap</b> — ce colis part maintenant chez ${esc(o.swappedTo.name || 'une autre cliente')}.</div>`;
    if(!pending(o)) return '';
    const m = matches(o);
    if(m.length) return `<div class="swap-note">🔁 <b>Swap possible</b> — ce colis existe déjà chez ZR avec exactement les mêmes articles :
      ${m.map(x => line(x, o.id)).join('')}
      <small>Pas besoin d'envoyer un nouveau colis : faites changer la cliente du colis chez ZR, puis appuyez sur « Swap fait ».</small></div>`;
    if(o.swapHold) return `<div class="swap-note warn">⏸️ <b>Retenue pour un swap</b> — cette commande n'a pas été envoyée à ZR. Si le swap ne s'est pas fait, envoyez-la.</div>`;
    return '';
  }

  /* au moment d'enregistrer une nouvelle commande : true = envoyer à ZR, false = retenir (swap) */
  function confirmSwap(o){
    const m = matches(o);
    if(!m.length) return Promise.resolve(true);
    return new Promise(res => {
      const d = document.createElement('div'); d.id = 'swapModal';
      d.innerHTML = `<div class="swap-card"><h3>🔁 Swap possible</h3>
        <p>${m.length > 1 ? 'Ces colis sont' : 'Ce colis est'} déjà chez ZR avec <b>exactement les mêmes articles</b> et ${m.length > 1 ? 'risquent' : 'risque'} de revenir :</p>
        ${m.map(x => line(x)).join('')}
        <p>Au lieu d'envoyer un nouveau colis, vous pouvez faire changer la cliente chez ZR.</p>
        <button class="swap-hold" id="sw-hold">🔁 Je fais le swap — ne pas envoyer</button>
        <button class="swap-send" id="sw-send">🚚 Envoyer quand même à ZR</button></div>`;
      document.body.appendChild(d);
      d.querySelector('#sw-hold').onclick = () => { d.remove(); res(false); };
      d.querySelector('#sw-send').onclick = () => { d.remove(); res(true); };
    });
  }

  /* dans l'alerte « Ne répond pas / Annulée » : une commande en attente a les mêmes articles ? */
  function pendingLine(r){
    const p = pendingFor(r);
    if(!p.length) return '';
    return `<div class="swap-note">🔁 Nouvelle commande avec les mêmes articles : ${p.map(x => '<b>' + who(x) + '</b>').join(', ')} — faites le swap au lieu d'un retour.</div>`;
  }

  /* ---------- Swap fait : la nouvelle commande part avec l'ancien colis → ses articles reviennent en stock ---------- */
  const byId = id => all().find(x => x.id === id);
  function locate(it){
    const p = (typeof products !== 'undefined' ? products : []).find(x => x.id === it.productId);
    if(!p) return null;
    if(it.code){
      const k = (p.colors || []).findIndex(c => String(c.code) === String(it.code));
      if(k >= 0) return {p, c: p.colors[k]};
    }
    if(it.colorIndex != null && p.colors && p.colors[it.colorIndex]) return {p, c: p.colors[it.colorIndex]};
    return {p, c: null};
  }
  async function moveStock(items, sign){
    if(typeof loadProducts === 'function') await loadProducts();
    const touched = new Map();
    (items || []).forEach(it => {
      const q = Number(it.qty) || 0, loc = locate(it);
      if(q <= 0 || !loc) return;
      const t = loc.c || loc.p;
      t.qty = Math.max(0, (Number(t.qty) || 0) + sign * q);
      touched.set(loc.p.id, loc.p);
    });
    const res = await Promise.all([...touched.values()].map(p => saveProductDoc(p)));
    if(res.some(r => !r)) throw new Error('stock non enregistré');
  }
  const put = (id, data) => db.collection('orders').doc(id).set(data, {merge: true});
  function refresh(id){
    try{ if(typeof renderOrdersHistory === 'function') renderOrdersHistory(); }catch(e){}
    try{ if(typeof currentDetailOrderId !== 'undefined' && currentDetailOrderId === id && typeof showOrderDetail === 'function') showOrderDetail(id); }catch(e){}
    try{ if(typeof refreshCurrentInventoryView === 'function') refreshCurrentInventoryView(); }catch(e){}
  }
  let busy = false;
  async function swapDone(newId, oldId){
    const n = byId(newId), r = byId(oldId);
    if(!n || !r || n.swap || busy) return;
    const rc = r.customer || {}, nc = n.customer || {};
    if(!confirm('Swap fait ?\n\nLe colis ' + ((r.zr && r.zr.tracking) || '') + ' (' + (rc.name || 'cliente') + ') part chez ' + (nc.name || 'la nouvelle cliente') + '.\nLes articles de la nouvelle commande reviennent dans le stock et elle ne sera pas envoyée à ZR.')) return;
    busy = true;
    try{
      await moveStock(n.items, +1);
      const at = new Date().toISOString(), by = (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';
      n.swap = {orderId: r.id, tracking: (r.zr && r.zr.tracking) || '', name: rc.name || '', at, by};
      n.swapHold = false;
      r.swappedTo = {orderId: n.id, name: nc.name || '', phone: nc.phone || '', at, by};
      await Promise.all([put(n.id, {swap: n.swap, swapHold: false}), put(r.id, {swappedTo: r.swappedTo})]);
      toast('✅ Swap enregistré — stock remis à jour');
    }catch(e){ toast('Échec du swap : ' + (e.message || e) + ' — réessayez', true); }
    busy = false;
    refresh(newId);
  }
  async function swapUndo(newId){
    const n = byId(newId);
    if(!n || !n.swap || busy) return;
    if(!confirm('Annuler le swap ?\nLes articles de cette commande seront retirés du stock à nouveau.')) return;
    busy = true;
    try{
      await moveStock(n.items, -1);
      const r = byId(n.swap.orderId);
      n.swap = null; n.swapHold = true;
      const jobs = [put(n.id, {swap: null, swapHold: true})];
      if(r){ r.swappedTo = null; jobs.push(put(r.id, {swappedTo: null})); }
      await Promise.all(jobs);
      toast('Swap annulé — stock remis comme avant');
    }catch(e){ toast('Échec : ' + (e.message || e), true); }
    busy = false;
    refresh(newId);
  }
  window.swapDone = swapDone;
  window.swapUndo = swapUndo;

  window.swapMatches = matches;
  window.swapBanner = banner;
  window.swapConfirm = confirmSwap;
  window.swapPendingLine = pendingLine;

  const st = document.createElement('style');
  st.textContent = `
    .swap-note{background:#fff7d6;border:1.5px solid #f5c400;color:#3b2a00;border-radius:12px;padding:9px 11px;margin:6px 0;font-size:13px;line-height:1.45;}
    .swap-note.ok{background:#e6f6ec;border-color:#16a34a;color:#14532d;}
    .swap-note.warn{background:#fdecea;border-color:#ef4444;color:#7a1d1d;}
    .swap-note small{display:block;opacity:.85;margin-top:3px;}
    .swap-o{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:4px;}
    .swap-lv{background:#FFCC00;color:#111;font-weight:800;font-size:11px;border-radius:999px;padding:1px 8px;}
    .swap-lv.x{background:#b91c1c;color:#fff;}
    .swap-t{font-family:monospace;font-size:12px;font-weight:700;background:#FFCC00;color:#111;border-radius:6px;padding:1px 6px;}
    .swap-call{text-decoration:none;font-size:16px;background:#dcf3e6;border-radius:8px;padding:2px 7px;}
    #swapModal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10050;display:flex;align-items:flex-end;justify-content:center;}
    #swapModal .swap-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;}
    #swapModal h3{margin:0 0 6px;} #swapModal p{margin:8px 0;font-size:14px;line-height:1.45;}
    #swapModal .swap-o{border:1px solid var(--line,#ddd);border-left:6px solid #f5c400;border-radius:12px;padding:9px 10px;}
    #swapModal button{display:block;width:100%;border:none;border-radius:12px;padding:13px;font:inherit;font-weight:800;margin-top:8px;cursor:pointer;}
    .swap-hold{background:#16a34a;color:#fff;}
    .swap-done{margin-left:auto;border:none;border-radius:10px;background:#16a34a;color:#fff;font:inherit;font-weight:800;font-size:12px;padding:5px 10px;cursor:pointer;}
    .swap-undo{display:block;margin-top:6px;border:1px solid #16a34a;border-radius:10px;background:#fff;color:#14532d;font:inherit;font-weight:700;font-size:12px;padding:5px 10px;cursor:pointer;} .swap-send{background:#e5e7eb;color:#111;}
  `;
  document.head.appendChild(st);
})();
