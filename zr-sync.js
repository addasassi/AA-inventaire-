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
    if(window.ordersShown && window.zrLabelsButton) window.zrLabelsButton(window.ordersShown);
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
    o.zrDesc = 'ملابس نسائية';   // texte affiché sur le bordereau (pas le détail des articles)
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
  // Situations de livraison ZR : même couleur que dans ZR Express
  function sitStyle(t){
    const k = norm(t);
    if(/ne repond pas 3|annule/.test(k)) return ['📵', '#fff', '#c0392b'];
    if(/ne repond pas/.test(k)) return ['📵', '#7a4b00', '#ffe7a8'];
    if(/commune erronee/.test(k)) return ['📍', '#7a4b00', '#ffe7a8'];
    if(/reportee|rendez vous/.test(k)) return ['📅', '#1f6b3a', '#dcf3e6'];
    if(/changement stop ?desk/.test(k)) return ['🏢', '#1f6b3a', '#dcf3e6'];
    if(/sms/.test(k)) return ['✉️', '#1a5fa0', '#dcebfa'];
    if(/appel/.test(k)) return ['📞', '#1a5fa0', '#dcebfa'];
    return ['ℹ️', '#444', '#eee'];
  }
  function sitBadge(o){
    const t = o && o.zr && o.zr.situation;
    if(!t || o.zr.stage === 'delivered' || o.zr.stage === 'returned') return '';
    const s = sitStyle(t);
    return `<div class="zr-badge" style="color:${s[1]};background:${s[2]}">${s[0]} ${esc(t)}</div>`;
  }

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
    return `<div class="zr-badges"><div class="zr-badge" style="color:${i[2]};background:${i[3]}">${i[0]} ${esc(i[1])}${t}</div>${sitBadge(o)}</div>`;
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
        ${sitBadge(o) ? '<div style="margin-top:8px">' + sitBadge(o) + '</div>' : ''}${tr}${hist}${err}<div class="zr-row">${btns.join('')}</div></div>`;
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
        const j = await call('/label', {id: o.id});
        if(j.url) await printPdf(j.url, 'a6');
        else toast(j.error || 'Étiquette indisponible', true);
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
    if(window.__zrBulkDelete){                       // suppression groupée : pas de question par commande
      if(z.stage !== 'delivered' && z.stage !== 'returned'){ try{ await call('/cancel', {id: o.id}); }catch(e){} }
      return true;
    }
    if(z.stage === 'delivered' || z.stage === 'returned') return confirm('Supprimer cette commande ? (le colis ZR est terminé)');
    const ans = confirm('Ce colis est déjà chez ZR Express (' + (z.tracking || '') + ').\n\nOK = supprimer la commande ET annuler le colis chez ZR\nAnnuler = ne rien supprimer');
    if(!ans) return false;
    try{ await call('/cancel', {id: o.id}); toast('Colis annulé chez ZR'); }
    catch(e){ return confirm('Impossible d\'annuler chez ZR (' + (e.message || e) + ').\nSupprimer quand même la commande ?'); }
    return true;
  }

  /* ---------- Réglages (admin) ---------- */
  function ensureUI(){
    if(document.getElementById('zrSyncModal')) return;
    const css = document.createElement('style');
    css.textContent = `
      .zr-badges{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px;}
      .zr-badges .zr-badge{margin:0;}
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
      #zrSyncModal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;z-index:9999;}
      #zrSyncModal.show{display:flex;}
      #zrSyncModal .zm-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;}
      #zrSyncModal h3{margin:0 0 6px;font-size:18px;}
      #zrSyncModal input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line,#ddd);border-radius:10px;font-size:14px;margin-top:4px;background:var(--card,#fff);color:inherit;}
      #zrSyncModal label{font-size:12.5px;font-weight:700;display:block;margin-top:10px;}
      #zrSyncModal .zm-row{display:flex;gap:8px;margin-top:14px;}
      #zrSyncModal .zm-row button{flex:1;margin-top:0;}
      #zrSyncModal .zm-msg{font-size:13px;margin-top:10px;white-space:pre-wrap;}`;
    document.head.appendChild(css);
    const m = document.createElement('div');
    m.id = 'zrSyncModal';
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
    document.getElementById('zrSyncModal').classList.add('show');
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

  /* ---------- Sélection des commandes + menu « Actions » (bordereaux A6 / A4, supprimer) ---------- */
  const selected = new Set();
  let shown = [];
  const printable = o => !!(o && o.zr && o.zr.tracking);
  const sel = () => shown.filter(o => selected.has(o.id));
  function selectBox(o){
    return `<label class="oc-check" onclick="event.stopPropagation()" title="Sélectionner"><input type="checkbox" ${selected.has(o.id) ? 'checked' : ''}
      onchange="zrToggle('${o.id}', this.checked)"></label>`;
  }
  window.zrToggle = (id, on) => { on ? selected.add(id) : selected.delete(id); updateBar(); };
  function updateBar(){
    const box = document.getElementById('zr-labels-box'); if(!box) return;
    const n = sel().length, all = shown.length && n === shown.length;
    const a = box.querySelector('#oc-all'); if(a){ a.checked = !!all; a.indeterminate = n > 0 && !all; }
    const btn = box.querySelector('.oc-actions-btn');
    if(btn){ btn.innerHTML = `⚡ Actions${n ? ` <span>${n}</span>` : ''}`; btn.disabled = !n; }
  }
  function labelsButton(list){
    const sum = document.getElementById('ordersSummary'); if(!sum) return;
    let box = document.getElementById('zr-labels-box');
    if(!box){ box = document.createElement('div'); box.id = 'zr-labels-box'; sum.insertAdjacentElement('afterend', box); }
    shown = list || [];
    const ids = new Set(shown.map(o => o.id));
    [...selected].forEach(id => { if(!ids.has(id)) selected.delete(id); });   // garde seulement les commandes visibles
    if(!shown.length){ box.innerHTML = ''; return; }
    box.innerHTML = `<div class="oc-bar">
        <label class="oc-all"><input type="checkbox" id="oc-all"> Tout sélectionner</label>
        <button class="oc-actions-btn" disabled>⚡ Actions</button>
      </div>`;
    box.querySelector('#oc-all').onchange = e => {
      shown.forEach(o => e.target.checked ? selected.add(o.id) : selected.delete(o.id));
      document.querySelectorAll('.oc-check input').forEach(c => c.checked = e.target.checked);
      updateBar();
    };
    box.querySelector('.oc-actions-btn').onclick = openActions;
    updateBar();
  }

  function openActions(){
    const list = sel(); if(!list.length) return;
    const pr = list.filter(printable).length;
    const isAdm = isAdmin();
    const me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : '';
    const deletable = list.filter(o => isAdm || o.createdBy === me);
    let m = document.getElementById('ocActionsModal');
    if(!m){ m = document.createElement('div'); m.id = 'ocActionsModal'; document.body.appendChild(m);
      m.addEventListener('click', e => { if(e.target === m) m.classList.remove('show'); }); }
    m.innerHTML = `<div class="oa-card">
        <h3>${list.length} commande${list.length > 1 ? 's' : ''} sélectionnée${list.length > 1 ? 's' : ''}</h3>
        <button class="oa-btn print" data-a="a6" ${relay && pr ? '' : 'disabled'}>🏷️ Bordereaux A6 — Thermique <small>${pr} avec n° ZR · dans l'ordre de la liste</small></button>
        <button class="oa-btn print2" data-a="a4" ${relay && pr ? '' : 'disabled'}>📄 Bordereaux A4 <small>4 par page</small></button>
        <button class="oa-btn del" data-a="del" ${deletable.length ? '' : 'disabled'}>🗑️ Supprimer (${deletable.length}) <small>le stock est remis · les colis ZR sont annulés</small></button>
        <button class="oa-cancel" id="oa-cancel">Fermer</button>
      </div>`;
    m.querySelector('#oa-cancel').onclick = () => m.classList.remove('show');
    m.querySelectorAll('.oa-btn').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if(a === 'del') return bulkDelete(deletable, m);
      printLabels(a, b, list.filter(printable));
    });
    m.classList.add('show');
  }

  async function printLabels(format, btn, list){
    list = list.slice(0, 250);
    if(!list.length) return;
    const old = btn.innerHTML; btn.disabled = true; btn.textContent = '⏳ Préparation du PDF…';
    try{
      const j = await call('/labels', {ids: list.map(o => o.id), format});
      if(!j.ok || !j.url) throw new Error(j.error || 'PDF indisponible');
      document.getElementById('ocActionsModal').classList.remove('show');
      await printPdf(j.url, format);
      toast('🖨️ ' + j.count + ' bordereau(x) ' + (format === 'a4' ? 'A4' : 'A6') + (j.failed && j.failed.length ? ' — ' + j.failed.length + ' en échec' : ''));
    }catch(e){ if(w) w.close(); toast('ZR Express : ' + (e.message || e), true); }
    btn.innerHTML = old; btn.disabled = false;
  }

  /* ---------- Impression directe : le PDF de ZR est dessiné dans l'app, puis
     la fenêtre d'impression du téléphone s'ouvre (choix de la machine). ---------- */
  let pdfjsP = null;
  function pdfjs(){
    const B = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/';
    if(!pdfjsP) pdfjsP = import(B + 'pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = B + 'pdf.worker.min.mjs';
      return lib;
    }).catch(e => { pdfjsP = null; throw new Error('Lecteur PDF non chargé (connexion ?)'); });
    return pdfjsP;
  }

  function printModal(){
    let m = document.getElementById('labelPrintModal');
    if(m) return m;
    m = document.createElement('div');
    m.id = 'labelPrintModal';
    m.innerHTML = `<div class="lp-bar">
        <button id="lp-close" type="button">← Retour</button>
        <span class="lp-info"></span>
        <button id="lp-share" type="button">📤 Partager</button>
        <button id="lp-print" type="button">🖨️</button>
      </div>
      <div class="lp-pages"></div>
      <style id="lp-page-style"></style>`;
    document.body.appendChild(m);
    m.querySelector('#lp-close').onclick = () => m.classList.remove('show');
    m.querySelector('#lp-print').onclick = () => window.print();
    // envoie le PDF original de ZR (taille exacte de l'étiquette) à l'appli de la machine thermique
    m.querySelector('#lp-share').onclick = async () => {
      const f = m._pdf;
      if(!f) return;
      try{
        if(navigator.canShare && navigator.canShare({files: [f]})){ await navigator.share({files: [f], title: f.name}); return; }
      }catch(e){ if(e && e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      if(typeof toast === 'function') toast('📄 PDF téléchargé — ouvrez-le avec l\'appli de la machine');
    };
    return m;
  }

  async function printPdf(url, format){
    if(!relay) await loadCfg();
    const m = printModal();
    const pages = m.querySelector('.lp-pages'), info = m.querySelector('.lp-info');
    pages.innerHTML = '<div class="lp-wait">⏳ Préparation des bordereaux…</div>';
    info.textContent = '';
    m.querySelector('#lp-print').disabled = true;
    m.querySelector('#lp-share').disabled = true;
    m._pdf = null;
    m.dataset.url = url;
    m.classList.add('show');
    try{
      const [lib, buf] = await Promise.all([
        pdfjs(),
        fetch(relay + '/pdf?u=' + encodeURIComponent(url)).then(async r => {
          if(!r.ok){ let j = {}; try{ j = await r.json(); }catch(e){} throw new Error(j.error || ('Erreur ' + r.status)); }
          return r.arrayBuffer();
        })
      ]);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '');
      m._pdf = new File([buf.slice(0)], 'bordereaux-' + (format === 'a4' ? 'A4' : 'A6') + '-' + stamp + '.pdf', {type: 'application/pdf'});
      m.querySelector('#lp-share').disabled = false;
      const doc = await lib.getDocument({data: buf}).promise;
      pages.innerHTML = '';
      let wmm = 0, hmm = 0;
      for(let i = 1; i <= doc.numPages; i++){
        const pg = await doc.getPage(i);
        const v1 = pg.getViewport({scale: 1});
        if(i === 1){ wmm = v1.width * 25.4 / 72; hmm = v1.height * 25.4 / 72; }
        const scale = (format === 'a4' ? 2.2 : 3.2);            // ~200–230 dpi : net sur thermique
        const vp = pg.getViewport({scale});
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await pg.render({canvasContext: ctx, canvas: c, viewport: vp}).promise;
        const img = new Image(); img.src = c.toDataURL('image/png'); img.className = 'lp-page';
        pages.appendChild(img);
      }
      m.querySelector('#lp-page-style').textContent =
        // pas de taille imposée : l'étiquette remplit la feuille choisie dans la fenêtre d'impression (A6, 4x6, A4…)
        `@page{margin:0;}
         @media print{#labelPrintModal .lp-page{width:100vw;height:100vh;object-fit:contain;}}`;   // remplit la feuille choisie (A6, 4x6…)
      info.textContent = doc.numPages + ' page' + (doc.numPages > 1 ? 's' : '') + ' · ' + (format === 'a4' ? 'A4' : 'A6');
      m.querySelector('#lp-print').disabled = false;
    }catch(e){
      pages.innerHTML = `<div class="lp-wait">⚠️ ${e.message || e}<br><br><a href="${url}" target="_blank" rel="noopener">Ouvrir le PDF</a></div>`;
    }
  }
  window.zrPrintPdf = printPdf;

  async function bulkDelete(list, m){
    const atZr = list.filter(o => o.zr && o.zr.parcelId && o.zr.stage !== 'delivered' && o.zr.stage !== 'returned').length;
    const ok = typeof confirmDialog === 'function'
      ? await confirmDialog({title: 'Supprimer ' + list.length + ' commande' + (list.length > 1 ? 's' : '') + ' ?',
          text: 'Le stock des articles sera remis.' + (atZr ? ' ' + atZr + ' colis seront aussi annulés chez ZR Express.' : '') + ' Cette action est définitive.',
          ok: 'Oui, supprimer', cancel: 'Non, garder'})
      : confirm('Supprimer ' + list.length + ' commande(s) ?');
    if(!ok) return;
    m.classList.remove('show');
    window.__zrBulkDelete = true;
    let n = 0;
    try{
      for(const o of list){
        try{ await deleteOrder(o.id); selected.delete(o.id); n++; }catch(e){}
      }
    }finally{ window.__zrBulkDelete = false; }
    toast('🗑️ ' + n + ' commande(s) supprimée(s)');
    if(typeof renderOrdersHistory === 'function') renderOrdersHistory();
  }
  window.zrSelectBox = selectBox;
  const cssP = document.createElement('style');
  cssP.textContent = `
    .oc-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 2px 4px;}
    .oc-all{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;}
    .oc-all input,.oc-check input{width:22px;height:22px;accent-color:var(--plum,#3a2632);margin:0;}
    .oc-check{display:flex;align-items:center;padding:2px;flex-shrink:0;}
    #labelPrintModal{position:fixed;inset:0;z-index:10060;background:#e9e4e1;display:none;flex-direction:column;}
    #labelPrintModal.show{display:flex;}
    #labelPrintModal .lp-bar{display:flex;align-items:center;gap:10px;padding:12px;background:var(--plum,#3a2632);color:#fff;}
    #labelPrintModal .lp-bar button{border:none;border-radius:12px;padding:12px 16px;font:inherit;font-size:15px;font-weight:800;cursor:pointer;}
    #lp-close{background:rgba(255,255,255,.15);color:#fff;}
    #lp-share{background:#2e9e5b;color:#fff;margin-inline-start:auto;font-size:16px !important;}
    #lp-print{background:rgba(255,255,255,.15);color:#fff;font-size:18px !important;padding:10px 14px !important;}
    #lp-print:disabled,#lp-share:disabled{opacity:.5;}
    #labelPrintModal .lp-info{font-size:13px;opacity:.85;}
    #labelPrintModal .lp-pages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;align-items:center;gap:14px;}
    #labelPrintModal .lp-page{width:100%;max-width:480px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15);}
    #labelPrintModal .lp-wait{padding:40px 20px;text-align:center;font-size:16px;}
    @media print{
      body > *:not(#labelPrintModal){display:none !important;}
      html,body{background:#fff !important;margin:0 !important;padding:0 !important;}
      #labelPrintModal{position:static !important;display:block !important;background:#fff !important;}
      #labelPrintModal .lp-bar{display:none !important;}
      #labelPrintModal .lp-pages{display:block !important;padding:0 !important;overflow:visible !important;}
      #labelPrintModal .lp-page{display:block;max-width:none;box-shadow:none;margin:0;page-break-after:always;break-after:page;}
      #labelPrintModal .lp-page:last-child{page-break-after:auto;break-after:auto;}
    }
    .oc-actions-btn{border:none;border-radius:12px;padding:11px 18px;font:inherit;font-size:15px;font-weight:800;background:var(--plum,#3a2632);color:#fff;cursor:pointer;}
    .oc-actions-btn:disabled{opacity:.4;}
    .oc-actions-btn span{background:#fff;color:var(--plum,#3a2632);border-radius:999px;padding:1px 8px;margin-left:4px;font-size:13px;}
    #ocActionsModal{position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;}
    #ocActionsModal.show{display:flex;}
    #ocActionsModal .oa-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:20px 16px 24px;box-sizing:border-box;}
    #ocActionsModal h3{margin:0 0 10px;font-size:18px;}
    #ocActionsModal button{width:100%;border-radius:14px;padding:14px;font:inherit;font-size:15.5px;font-weight:800;cursor:pointer;margin-top:9px;text-align:left;display:flex;flex-direction:column;gap:2px;}
    #ocActionsModal button small{font-size:12px;font-weight:600;opacity:.8;}
    #ocActionsModal button:disabled{opacity:.4;}
    #ocActionsModal .print{border:none;background:#1a1a1a;color:#ffd200;}
    #ocActionsModal .print2{border:1.5px solid #1a1a1a;background:transparent;color:inherit;}
    #ocActionsModal .del{border:none;background:#fde8e6;color:#c0392b;}
    #ocActionsModal .oa-cancel{border:1px solid var(--line,#ddd);background:var(--card,#fff);color:inherit;align-items:center;}
    .zr-print-bar{display:flex;align-items:center;gap:8px;margin:10px 0 4px;}
    .zr-print-bar .zr-all{display:flex;align-items:center;gap:6px;font-weight:800;font-size:14px;padding:0 4px;white-space:nowrap;}
    .zr-print-bar input,.zr-check input{width:20px;height:20px;accent-color:#1a1a1a;}
    .zr-print-btn{flex:1;border:none;border-radius:14px;padding:14px 10px;font:inherit;font-size:15px;font-weight:800;background:#1a1a1a;color:#ffd200;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.18);}
    .zr-print-btn:disabled,.zr-a4:disabled{opacity:.45;}
    .zr-a4{border:1.5px solid #1a1a1a;background:transparent;color:inherit;border-radius:12px;padding:12px 10px;font:inherit;font-weight:800;cursor:pointer;}
    .zr-check{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;margin:0 8px 6px 0;padding:4px 10px 4px 6px;border-radius:999px;background:#fff7d1;color:#1a1a1a;vertical-align:middle;}
    #zrPrintModal{position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;}
    #zrPrintModal.show{display:flex;}
    #zrPrintModal .zp-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:20px 16px 24px;box-sizing:border-box;}
    #zrPrintModal h3{margin:0 0 4px;font-size:18px;}
    #zrPrintModal .zp-sub{margin:0 0 14px;font-size:13.5px;opacity:.75;}
    #zrPrintModal button{width:100%;border-radius:14px;padding:14px;font:inherit;font-size:15px;font-weight:800;cursor:pointer;margin-top:8px;}
    #zrPrintModal .zp-btn{border:none;background:#1a1a1a;color:#ffd200;}
    #zrPrintModal .zp-cancel{border:1px solid var(--line,#ddd);background:var(--card,#fff);color:inherit;}`;
  document.head.appendChild(cssP);
  window.zrLabelsButton = labelsButton;

  window.zrPrepareOrder = prepare;
  window.zrAfterSave = afterSave;
  window.zrBadge = badge;
  window.zrDetail = detail;
  window.zrOnOrders = onOrders;
  window.zrBeforeDelete = beforeDelete;
  window.openZrSettings = openModal;
})();
