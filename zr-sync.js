/* =====================================================================
   Atelier Stock ⇄ ZR Express
   - Chaque nouvelle commande est envoyée automatiquement à ZR Express
     (via le Worker Cloudflare « atelier-zr », qui garde les identifiants).
   - Commande reportée : envoyée le jour prévu (par le Worker).
   - Numéro de suivi + état du colis affichés sur la commande.
   L'adresse du Worker est enregistrée dans Firestore (meta/zr) par l'admin :
   tous les téléphones l'utilisent, sans aucun identifiant ZR dedans.
   Dépend de : db, orders, currentUser, toast, wilayasList (index.html)
   ===================================================================== */
(function(){
  let relay = '';            // adresse du Worker
  let loaded = false;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isAdmin = () => typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  async function loadCfg(){
    try{
      const d = await db.collection('meta').doc('zr').get();
      relay = (d.exists && d.data().url || '').replace(/\/+$/, '');
    }catch(e){}
    loaded = true;
  }

  async function call(path, body){
    if(!relay) throw new Error('ZR Express non configuré');
    const r = await fetch(relay + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
    let j = {}; try{ j = await r.json(); }catch(e){}
    if(!r.ok && !j.zr) throw new Error(j.error || ('Erreur ' + r.status));
    return j;
  }

  /* ---------- Avant l'enregistrement d'une commande (nouvelle ou modifiée) ---------- */
  function prepare(o){
    if(!relay || !o || !o.customer) return;
    const z = o.zr || null;
    if(z && z.parcelId) return;                                // déjà chez ZR : on ne touche plus
    // anciennes commandes (avant le branchement ZR) : jamais envoyées automatiquement
    if(!z && Date.now() - Date.parse(o.createdAt || 0) > 10*60*1000) return;
    const w = (typeof wilayasList !== 'undefined' ? wilayasList : []).find(x => norm(x.name) === norm(o.customer.wilaya));
    if(w) o.customer.wilayaCode = w.code;
    o.zrDesc = (o.items || []).map(it => (it.qty || 1) + 'x ' + it.name).join(', ').slice(0, 250);
    o.zr = Object.assign({}, z || {}, {
      status: 'queued', active: true, error: '',
      sendAfter: o.deferred && o.deferredDate ? o.deferredDate : '',
      updatedAt: new Date().toISOString()
    });
    if(!z) o.zr.attempts = 0;
  }

  /* ---------- Après l'enregistrement : envoi immédiat si pas reportée ---------- */
  function today(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function afterSave(o){
    if(!relay || !o || !o.zr || o.zr.parcelId || o.zr.status !== 'queued') return;
    if(o.zr.sendAfter && o.zr.sendAfter > today()) return;    // reportée : le Worker l'enverra le jour prévu
    call('/send', {id: o.id}).then(j => {
      if(j.ok && j.zr && j.zr.tracking) toast('🚚 Envoyée à ZR Express — ' + j.zr.tracking);
      else if(j.zr && j.zr.status === 'error') toast('ZR Express : ' + (j.zr.error || 'erreur'), true);
    }).catch(()=>{ /* le Worker réessaiera tout seul dans quelques minutes */ });
  }

  /* ---------- Affichage ---------- */
  const STAGE = {
    created:          ['📦', 'Chez ZR', '#5b6b8c', '#e8edf7'],
    in_transit:       ['🚚', 'En route', '#8a5a1f', '#fbe9d3'],
    at_hub:           ['🏢', 'Au bureau', '#8a5a1f', '#fbe9d3'],
    out_for_delivery: ['🛵', 'En livraison', '#1f6b8a', '#d9f0f7'],
    delivered:        ['✅', 'Livrée', '#1f7a4a', '#dcf3e6'],
    returned:         ['↩️', 'Retour', '#a4483f', '#f8dedb']
  };
  function info(o){
    const z = o && o.zr;
    if(!z) return null;
    if(z.status === 'error') return ['⚠️', 'Erreur ZR', '#fff', '#a4483f', z.error];
    if(!z.parcelId){
      if(z.sendAfter && z.sendAfter > today()) return ['🕓', 'ZR : envoi le ' + new Date(z.sendAfter + 'T00:00:00').toLocaleDateString('fr-FR'), '#8a5a1f', '#fbe9d3'];
      return ['⏳', 'Envoi à ZR…', '#5b6b8c', '#eef0f5'];
    }
    const s = STAGE[z.stage] || STAGE.created;
    // le texte affiché est celui du système ZR Express (ex. « Sortie en livraison ») ; l'icône/couleur vient de l'étape
    return [s[0], z.state || s[1], s[2], s[3]];
  }
  function badge(o){
    const i = info(o);
    if(!i) return '';
    const t = o.zr.tracking ? ' · ' + esc(o.zr.tracking) : '';
    return `<div class="zr-badge" style="color:${i[2]};background:${i[3]}">${i[0]} ${esc(i[1])}${t}</div>`;
  }

  let detailId = null;
  function detail(o){
    detailId = o.id;
    const el = document.getElementById('od-zr');
    if(!el) return;
    const z = o.zr;
    if(!relay){ el.innerHTML = ''; return; }
    if(!z){
      el.innerHTML = `<div class="zr-box"><div class="zr-h">🚚 ZR Express</div><div class="zr-sub">Commande pas envoyée à ZR.</div>
        <button class="zr-btn" data-zr="send">Envoyer à ZR Express</button></div>`;
    }else{
      const i = info(o);
      const hist = '';
      const err = z.status === 'error' ? `<div class="zr-err">${esc(z.error || 'Erreur')}</div>` : '';
      const tr = z.tracking ? `<div class="zr-track"><span>N° de suivi</span><b>${esc(z.tracking)}</b><button class="zr-mini" data-zr="copy">Copier</button></div>` : '';
      const btns = [];
      if(z.status === 'error') btns.push('<button class="zr-btn" data-zr="retry">🔁 Corriger puis réessayer</button>');
      if(z.parcelId){
        btns.push('<button class="zr-btn ghost" data-zr="label">🏷️ Étiquette</button>');
        btns.push('<button class="zr-btn ghost" data-zr="track">🔄 Actualiser</button>');
      }
      el.innerHTML = `<div class="zr-box"><div class="zr-h">🚚 ZR Express <span class="zr-badge" style="color:${i[2]};background:${i[3]}">${i[0]} ${esc(i[1])}</span></div>
        ${tr}${hist}${err}<div class="zr-row">${btns.join('')}</div></div>`;
    }
    el.querySelectorAll('[data-zr]').forEach(b => b.onclick = () => action(b.dataset.zr, o, b));
  }
  async function action(kind, o, btn){
    const z = o.zr || {};
    if(kind === 'copy'){
      try{ await navigator.clipboard.writeText(z.tracking); toast('N° de suivi copié'); }catch(e){ prompt('N° de suivi', z.tracking); }
      return;
    }
    const old = btn.textContent; btn.disabled = true; btn.textContent = '⏳';
    try{
      if(kind === 'send' || kind === 'retry'){
        if(kind === 'send'){ prepare(o); await db.collection('orders').doc(o.id).set({zr: o.zr, zrDesc: o.zrDesc, customer: o.customer}, {merge: true}); }
        const j = await call('/send', {id: o.id, force: true});
        if(j.zr && j.zr.tracking) toast('🚚 Envoyée à ZR Express — ' + j.zr.tracking);
        else if(j.zr && j.zr.error) toast('ZR Express : ' + j.zr.error, true);
      }else if(kind === 'track'){
        await call('/track', {id: o.id}); toast('État mis à jour');
      }else if(kind === 'label'){
        const w = window.open('', '_blank');
        const j = await call('/label', {id: o.id});
        if(j.url){ if(w) w.location = j.url; else location.href = j.url; }
        else { if(w) w.close(); toast(j.error || 'Étiquette indisponible', true); }
      }
    }catch(e){ toast('ZR Express : ' + (e.message || e), true); }
    btn.disabled = false; btn.textContent = old;
  }
  function onOrders(){
    const m = document.getElementById('orderDetailModal');
    if(!detailId || !m || !m.classList.contains('show')) return;
    const o = (typeof orders !== 'undefined' ? orders : []).find(x => x.id === detailId);
    if(o) detail(o);
  }

  /* ---------- Suppression d'une commande déjà chez ZR ---------- */
  async function beforeDelete(o){
    const z = o && o.zr;
    if(!z || !z.parcelId) return true;
    if(z.stage === 'delivered' || z.stage === 'returned') return confirm('Supprimer cette commande ? (le colis ZR est terminé)');
    const ans = confirm('Ce colis est déjà chez ZR Express (' + (z.tracking || '') + ').\n\nOK = supprimer la commande ET annuler le colis chez ZR\nAnnuler = ne rien supprimer');
    if(!ans) return false;
    try{ await call('/cancel', {id: o.id}); toast('Colis annulé chez ZR'); }
    catch(e){ return confirm('Impossible d\'annuler chez ZR (' + (e.message || e) + ').\nSupprimer quand même la commande ?'); }
    return true;
  }

  /* ---------- Réglages (admin) ---------- */
  function ensureUI(){
    if(document.getElementById('zrModal')) return;
    const css = document.createElement('style');
    css.textContent = `
      .zr-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;margin:0 0 6px;}
      .zr-box{background:var(--cream,#f7f2ef);border:1px solid var(--line,#ddd);border-radius:14px;padding:12px;margin:12px 0;}
      .zr-h{font-weight:800;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
      .zr-h .zr-badge{margin:0;}
      .zr-sub{font-size:12.5px;margin-top:6px;opacity:.85;}
      .zr-err{font-size:12.5px;margin-top:8px;color:#a4483f;font-weight:700;}
      .zr-track{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;}
      .zr-track span{opacity:.7;}
      .zr-track b{direction:ltr;letter-spacing:.3px;}
      .zr-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
      .zr-btn{flex:1;min-width:120px;border:none;border-radius:10px;padding:10px;font-weight:800;font-size:13px;background:#1a1a1a;color:#ffd200;cursor:pointer;}
      .zr-btn.ghost{background:var(--card,#fff);color:inherit;border:1px solid var(--line,#ddd);}
      .zr-mini{border:1px solid var(--line,#ddd);background:var(--card,#fff);color:inherit;border-radius:8px;padding:4px 9px;font-size:12px;font-weight:700;cursor:pointer;}
      #zrModal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;z-index:9999;}
      #zrModal.show{display:flex;}
      #zrModal .zm-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;}
      #zrModal h3{margin:0 0 6px;font-size:18px;}
      #zrModal input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line,#ddd);border-radius:10px;font-size:14px;margin-top:4px;background:var(--card,#fff);color:inherit;}
      #zrModal label{font-size:12.5px;font-weight:700;display:block;margin-top:10px;}
      #zrModal .zm-row{display:flex;gap:8px;margin-top:14px;}
      #zrModal .zm-row button{flex:1;margin-top:0;}
      #zrModal .zm-msg{font-size:13px;margin-top:10px;white-space:pre-wrap;}`;
    document.head.appendChild(css);
    const m = document.createElement('div');
    m.id = 'zrModal';
    m.innerHTML = `<div class="zm-card">
      <h3>🚚 ZR Express</h3>
      <div class="note">Les nouvelles commandes sont envoyées automatiquement à ZR Express. Les commandes reportées partent le jour prévu.</div>
      <label>Adresse du relais ZR (Cloudflare)</label>
      <input type="url" id="zm-url" placeholder="https://atelier-zr.xxxx.workers.dev">
      <div class="zm-row"><button class="btn-secondary" id="zm-test">Tester la connexion</button><button class="btn-primary" id="zm-save">Enregistrer</button></div>
      <div class="zm-msg" id="zm-msg"></div>
      <div class="zm-row"><button class="btn-secondary" id="zm-close">Fermer</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if(e.target === m) m.classList.remove('show'); });
    document.getElementById('zm-close').onclick = () => m.classList.remove('show');
    const msg = t => document.getElementById('zm-msg').textContent = t;
    document.getElementById('zm-test').onclick = async () => {
      const url = document.getElementById('zm-url').value.trim().replace(/\/+$/, '');
      if(!url){ msg('Collez d\'abord l\'adresse du relais.'); return; }
      msg('⏳ Test en cours…');
      try{
        const r = await fetch(url + '/test', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        const j = await r.json();
        msg(j.ok ? '✅ ' + j.message : '❌ ' + (j.error || 'Échec'));
      }catch(e){ msg('❌ Relais injoignable : ' + (e.message || e)); }
    };
    document.getElementById('zm-save').onclick = async () => {
      const url = document.getElementById('zm-url').value.trim().replace(/\/+$/, '');
      try{
        await db.collection('meta').doc('zr').set({url}, {merge: true});
        relay = url;
        msg(url ? '✅ Enregistré — les nouvelles commandes partiront chez ZR.' : 'Envoi automatique désactivé.');
        toast('Réglages ZR enregistrés');
      }catch(e){ msg('❌ ' + (e.message || e)); }
    };
  }
  function openModal(){
    ensureUI();
    document.getElementById('zm-url').value = relay;
    document.getElementById('zm-msg').textContent = relay ? 'Relais configuré ✅' : 'Pas encore configuré.';
    document.getElementById('zrModal').classList.add('show');
  }
  function injectButton(){
    const actions = document.querySelector('#view-accueil .dash-actions');
    if(actions && !document.getElementById('dash-btn-zr')){
      const b = document.createElement('button');
      b.className = 'dash-action admin-only'; b.id = 'dash-btn-zr';
      b.textContent = '🚚 ZR Express';
      b.style.gridColumn = '1 / -1';
      b.onclick = openModal;
      actions.appendChild(b);
    }
    const b = document.getElementById('dash-btn-zr');
    if(b) b.style.display = isAdmin() ? '' : 'none';
  }

  ensureUI();
  const start = () => { loadCfg(); injectButton(); };
  const origEnter = window.enterApp;
  if(typeof origEnter === 'function'){
    window.enterApp = function(){ const r = origEnter.apply(this, arguments); try{ start(); }catch(e){} return r; };
  }
  setTimeout(() => { try{ if(typeof db !== 'undefined' && db) loadCfg(); if(typeof currentUser !== 'undefined' && currentUser) injectButton(); }catch(e){} }, 1500);

  window.zrPrepareOrder = prepare;
  window.zrAfterSave = afterSave;
  window.zrBadge = badge;
  window.zrDetail = detail;
  window.zrOnOrders = onOrders;
  window.zrBeforeDelete = beforeDelete;
  window.openZrSettings = openModal;
})();
