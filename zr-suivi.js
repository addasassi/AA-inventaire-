/* =====================================================================
   Page « Suivi ZR » : état de chaque colis, comme le tableau de bord ZR
   Domicile / Stop desk → Livrées aujourd'hui, Ne répond pas 1/2/3,
   annulées, reportées… + colis en route. Touchez une ligne → les commandes.
   Dépend de : orders, showOrderDetail, toast (index.html), window.zrCall (zr-sync.js)
   ===================================================================== */
(function(){
  const DAY = 86400000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' DA';
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const dayKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const all = () => (typeof orders !== 'undefined' && Array.isArray(orders)) ? orders : [];
  const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(s || ''));
  const sitOf = o => { const s = (o.zr && o.zr.situation) || ''; return isUuid(s) ? '' : s; };
  const final = o => { const st = o.zr && o.zr.stage; return st === 'delivered' || st === 'returned'; };
  const nrpN = o => { const m = norm(sitOf(o)).match(/r[e]?pond\w*\s+pas\D*(\d)/); return m ? Number(m[1]) : (/repond pas|sans reponse|injoignable/.test(norm(sitOf(o))) ? 1 : 0); };
  const today = () => dayKey(Date.now());
  const fmtDay = k => { try{ return new Date(k + 'T00:00:00').toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long'}); }catch(e){ return k; } };

  // lignes du tableau : [clé, couleur, libellé, test]
  const ROWS = [
    ['liv',  '#22c55e', "Livrées aujourd'hui", o => o.zr.stage === 'delivered' && o.zr.finalAt && dayKey(o.zr.finalAt) === today()],
    ['nrp1', '#fcd34d', 'Ne répond pas 1', o => !final(o) && nrpN(o) === 1],
    ['nrp2', '#fbbf24', 'Ne répond pas 2', o => !final(o) && nrpN(o) === 2],
    ['nrp3', '#f59e0b', 'Ne répond pas 3', o => !final(o) && nrpN(o) >= 3],
    ['ann',  '#ef4444', 'Commande annulée', o => !final(o) && /annul|refus/.test(norm(sitOf(o)))],
    ['rep',  '#10b981', 'Commande reportée', o => !final(o) && /report/.test(norm(sitOf(o)))],
  ];
  const FLOW = [
    ['new',  '#94a3b8', 'Créées — pas encore récupérées', o => !final(o) && (o.zr.stage || 'created') === 'created'],
    ['way',  '#60a5fa', 'Vers la wilaya', o => !final(o) && (o.zr.stage === 'in_transit')],
    ['hub',  '#0ea5e9', 'Au bureau / agence', o => !final(o) && o.zr.stage === 'at_hub'],
    ['out',  '#14b8a6', 'En livraison', o => !final(o) && o.zr.stage === 'out_for_delivery'],
    ['ret',  '#dc2626', "Retournées aujourd'hui", o => o.zr.stage === 'returned' && o.zr.finalAt && dayKey(o.zr.finalAt) === today()],
    ['retp', '#b91c1c', 'Retours à récupérer', o => o.zr.stage === 'returned' && !(o.returnInfo && o.returnInfo.at)],
  ];

  let open = '';   // ligne ouverte (type|clé)
  function parcels(){ return all().filter(o => o.zr && o.zr.parcelId); }

  function card(o, col){
    const c = o.customer || {}, z = o.zr || {};
    const sit = sitOf(o);
    const since = Math.floor((Date.now() - Date.parse(z.situationAt || z.stateAt || z.sentAt || o.createdAt)) / DAY);
    const when = final(o) && z.finalAt ? (dayKey(z.finalAt) === today() ? "aujourd'hui à " + new Date(z.finalAt).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}) : 'le ' + new Date(z.finalAt).toLocaleDateString('fr-FR'))
      : (since > 0 ? 'depuis ' + since + ' j' : "aujourd'hui");
    return `<div class="zs-o" style="--c:${col}" onclick="zsOpen('${esc(o.id)}')">
      <div class="zs-o-m"><div class="zs-o-n">${esc(c.name || 'Cliente')}</div>
        <div class="zs-o-w">📍 ${esc(c.wilaya || '')}${c.commune ? ' — ' + esc(c.commune) : ''}</div>
        <div class="zs-o-s"><span class="zs-pill">${esc(sit || z.state || '—')}</span><span class="zs-when">${when}</span></div>
        ${/report/.test(norm(sit)) ? `<div class="zs-rep">📅 ${z.reportDate ? 'Reportée au <b>' + fmtDay(z.reportDate) + '</b>' : 'Date du report pas indiquée par ZR'}${z.situationAt ? ' · reportée le ' + fmtDay(dayKey(z.situationAt)) : ''}</div>` : ''}
        ${z.situationNote ? `<div class="zs-note">💬 ${esc(z.situationNote)}</div>` : ''}
        ${z.tracking ? `<div class="zs-o-t">${esc(z.tracking)}</div>` : ''}</div>
      <div class="zs-o-r"><div class="zs-o-p">${money(o.total)}</div>${c.phone ? `<a href="tel:${esc(c.phone)}" onclick="event.stopPropagation()" aria-label="Appeler">📞</a>` : ''}</div></div>`;
  }
  function block(type, title, icon, list, rows){
    return `<div class="zs-box"><div class="zs-h"><span class="zs-ic">${icon}</span>${title}</div>
      ${rows.map(([k, col, label, test]) => {
        const items = list.filter(o => { try{ return test(o); }catch(e){ return false; } });
        const id = type + '|' + k, isOpen = open === id;
        return `<div class="zs-r${isOpen ? ' on' : ''}${items.length ? '' : ' zero'}" onclick="zsRow('${id}')">
            <i style="background:${col}"></i><span>${label}</span><b>${items.length}</b><em>${isOpen ? '▾' : '↗'}</em></div>
          ${isOpen ? `<div class="zs-list">${items.length ? items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(o => card(o, col)).join('') : '<div class="zs-empty">Aucune commande</div>'}</div>` : ''}`;
      }).join('')}</div>`;
  }

  /* ---------- Recherche d'un colis (téléphone, nom, n° de suivi) ---------- */
  let query = '';
  const digits = t => String(t || '').replace(/\D/g, '').replace(/^213/, '0');
  function colorOf(o){
    const z = o.zr || {};
    if(z.stage === 'delivered') return '#22c55e';
    if(z.stage === 'returned') return '#dc2626';
    const sk = norm(sitOf(o));
    if(/annul|refus/.test(sk)) return '#ef4444';
    if(nrpN(o)) return '#f59e0b';
    if(/report/.test(sk)) return '#10b981';
    if(z.stage === 'out_for_delivery') return '#14b8a6';
    if(z.stage === 'at_hub') return '#0ea5e9';
    if(z.stage === 'in_transit') return '#60a5fa';
    return '#94a3b8';
  }
  function results(){
    const box = document.getElementById('zs-results');
    if(!box) return;
    const q = query.trim(), qd = digits(q), qn = norm(q);
    if(q.length < 2){ box.innerHTML = ''; return; }
    const hits = all().filter(o => {
      if(!o.zr && !(o.customer && o.customer.deliveryType !== 'main')) return false;
      const c = o.customer || {}, z = o.zr || {};
      if(qd.length >= 3 && digits(c.phone).includes(qd)) return true;
      if(z.tracking && norm(z.tracking).replace(/[^a-z0-9]/g, '').includes(qn.replace(/[^a-z0-9]/g, '')) && qn.replace(/[^a-z0-9]/g, '').length >= 3) return true;
      return qn.length >= 2 && !/^\d+$/.test(q) && norm(c.name).includes(qn);
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 30);
    box.innerHTML = hits.length
      ? `<div class="zs-rcount">${hits.length} colis trouvé${hits.length > 1 ? 's' : ''}</div><div class="zs-list">` + hits.map(o => o.zr && o.zr.parcelId ? card(o, colorOf(o))
          : `<div class="zs-o" style="--c:#94a3b8" onclick="zsOpen('${esc(o.id)}')"><div class="zs-o-m"><div class="zs-o-n">${esc((o.customer || {}).name || 'Cliente')}</div><div class="zs-o-w">📍 ${esc((o.customer || {}).wilaya || '')}</div><div class="zs-o-s"><span class="zs-pill">${o.zr && o.zr.status === 'error' ? '❌ Erreur ZR' : (o.deferred ? '🕓 Reportée — pas encore envoyée' : '📦 Pas encore envoyée à ZR')}</span><span class="zs-when">${new Date(o.createdAt).toLocaleDateString('fr-FR')}</span></div></div><div class="zs-o-r"><div class="zs-o-p">${money(o.total)}</div></div></div>`).join('') + '</div>'
      : '<div class="zs-empty">Aucun colis trouvé pour « ' + esc(q) + ' »</div>';
  }
  window.zsSearch = v => { query = v; results(); const x = document.getElementById('zs-x'); if(x) x.style.display = v ? '' : 'none'; };

  function render(){
    const page = document.getElementById('zsPage');
    if(!page) return;
    if(!document.getElementById('zs-body')){
      page.innerHTML = `<div class="zs-search"><span>🔍</span><input id="zs-q" type="text" enterkeyhint="search" autocomplete="off" placeholder="N° de téléphone, nom ou n° de suivi" oninput="zsSearch(this.value)"><button id="zs-x" style="display:none" onclick="var i=document.getElementById('zs-q');i.value='';zsSearch('');i.focus()">✕</button></div>
        <div id="zs-results"></div><div id="zs-body"></div>`;
    }
    results();
    const root = document.getElementById('zs-body');
    const P = parcels();
    const dom = P.filter(o => (o.customer || {}).deliveryType !== 'stopdesk'), sd = P.filter(o => (o.customer || {}).deliveryType === 'stopdesk');
    const last = P.reduce((m, o) => Math.max(m, Date.parse(o.zr.updatedAt || 0) || 0), 0);
    const y = window.scrollY;
    root.innerHTML = `
      <div class="zs-top"><div class="zs-sub">${P.filter(o => !final(o)).length} colis en cours${last ? ' · mis à jour ' + new Date(last).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}) : ''}</div>
        <button class="zs-refresh" id="zs-refresh" onclick="zsRefresh()">🔄 Actualiser</button></div>
      ${block('d', 'Livraison à domicile', '🚚', dom, ROWS)}
      ${block('s', 'Stop desk', '🏪', sd, ROWS)}
      <div class="zs-cap">Colis en route</div>
      ${block('fd', 'Domicile', '🚚', dom, FLOW)}
      ${block('fs', 'Stop desk', '🏪', sd, FLOW)}
      <div class="zs-hint">Les états viennent de ZR Express (mis à jour automatiquement toutes les 10 min). Touchez une ligne pour voir les commandes, puis une commande pour l'ouvrir.</div>`;
    window.scrollTo(0, y);
  }

  window.zsRow = id => { open = open === id ? '' : id; render(); };
  window.zsOpen = id => { if(typeof showOrderDetail === 'function') showOrderDetail(id); };
  window.zsRefresh = async () => {
    const b = document.getElementById('zs-refresh');
    if(!window.zrCall){ toast('ZR Express non configuré', true); return; }
    const list = parcels().filter(o => !final(o));
    if(b){ b.disabled = true; }
    let done = 0;
    for(const o of list){
      try{ const r = await window.zrCall('/track', {id: o.id}); if(r && r.zr) o.zr = r.zr; }catch(e){}
      done++; if(b) b.textContent = '🔄 ' + done + '/' + list.length;
    }
    if(b){ b.disabled = false; b.textContent = '🔄 Actualiser'; }
    toast('✅ ' + list.length + ' colis actualisés');
    render();
  };
  window.renderZsPage = render;

  /* ---------- Onglet + page ---------- */
  function mount(){
    if(document.getElementById('view-zrsuivi')) return;
    const nav = document.querySelector('.tab-btn[data-tab="zr"]');
    const btn = document.createElement('button');
    btn.className = 'tab-btn'; btn.dataset.tab = 'zrsuivi'; btn.title = 'Suivi des colis ZR';
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="4.5" fill="#FFCC00"/><text x="12" y="15.6" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="9.5" fill="#111">ZR</text></svg>';
    if(nav) nav.insertAdjacentElement('beforebegin', btn); else return;
    const v = document.createElement('section');
    v.className = 'view'; v.id = 'view-zrsuivi';
    v.innerHTML = '<div class="cat-title">Suivi ZR</div><div id="zsPage"></div>';
    const ref = document.getElementById('view-zr');
    ref.parentNode.insertBefore(v, ref);
    btn.addEventListener('click', () => {
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
      btn.classList.add('active'); v.classList.add('active');
      if(typeof closeSidebar === 'function') closeSidebar();
      const go = () => render();
      if(typeof loadOrders === 'function') loadOrders().then(go, go); else go();
    });
    // rafraîchit tout seul quand les commandes changent
    let sig = '';
    setInterval(() => {
      if(!v.classList.contains('active')) return;
      const s = all().length + '|' + all().reduce((t, o) => t + ((o.zr && o.zr.updatedAt) || ''), '');
      if(s !== sig){ sig = s; render(); }
    }, 3000);
    const st = document.createElement('style');
    st.textContent = `
      .zs-search{display:flex;align-items:center;gap:8px;background:var(--card);border:2px solid #FFCC00;border-radius:14px;padding:4px 6px 4px 12px;margin:2px 0 10px;}
      .zs-search input{flex:1;min-width:0;border:none;background:transparent;color:inherit;font:inherit;font-size:16px;padding:10px 0;outline:none;}
      .zs-search button{border:none;background:transparent;color:inherit;font-size:18px;padding:6px 10px;cursor:pointer;}
      #zs-results{margin-bottom:6px;} #zs-results:empty{display:none;}
      .zs-rcount{font-size:12.5px;font-weight:700;color:var(--mauve-dark);margin:0 2px 6px;}
      .zs-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 12px;}
      .zs-sub{font-size:12.5px;color:var(--mauve-dark);}
      .zs-refresh{border:none;border-radius:12px;padding:9px 14px;background:#FFCC00;color:#111;font:inherit;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap;}
      .zs-box{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 12px 6px;margin-bottom:14px;}
      .zs-h{display:flex;align-items:center;gap:12px;font-weight:900;font-size:17px;margin-bottom:8px;}
      .zs-ic{width:44px;height:44px;border-radius:12px;background:color-mix(in srgb,var(--line) 55%,transparent);display:flex;align-items:center;justify-content:center;font-size:22px;}
      .zs-r{display:grid;grid-template-columns:14px 1fr auto 34px;align-items:center;gap:10px;padding:11px 4px;border-top:1px solid var(--line);cursor:pointer;font-size:14.5px;}
      .zs-r i{width:14px;height:14px;border-radius:50%;}
      .zs-r b{min-width:44px;text-align:center;background:#FFCC00;color:#111;border-radius:999px;padding:4px 10px;font-size:14px;}
      .zs-r.zero b{background:color-mix(in srgb,var(--line) 70%,transparent);color:var(--mauve-dark);}
      .zs-r em{font-style:normal;text-align:center;font-weight:900;border:1px solid var(--line);border-radius:9px;padding:5px 0;font-size:14px;}
      .zs-r.on em{background:var(--plum);color:#fff;border-color:var(--plum);}
      .zs-list{display:flex;flex-direction:column;gap:6px;padding:4px 0 10px;}
      .zs-o{display:flex;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:12px;background:var(--card);border:1px solid var(--line);border-left:6px solid var(--c);color:var(--plum);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.06);}
      html[data-theme="dark"] .zs-o{color:#fff;}
      .zs-o-m{min-width:0;}
      .zs-o-n{font-weight:800;font-size:15.5px;}
      .zs-o-w{font-size:13.5px;font-weight:600;margin-top:3px;overflow-wrap:anywhere;}
      .zs-rep{margin-top:7px;font-size:13.5px;font-weight:600;background:#d1fae5;color:#065f46;border-radius:9px;padding:6px 9px;}
      .zs-note{margin-top:6px;font-size:13px;font-style:italic;}
      .zs-o-s{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;}
      .zs-pill{background:color-mix(in srgb,var(--c) 28%,#fff);border:1.5px solid var(--c);color:#111;font-weight:800;font-size:12.5px;padding:3px 9px;border-radius:999px;}
      .zs-when{font-size:12.5px;font-weight:700;}
      .zs-o-t{display:inline-block;background:#FFCC00;color:#111;font-family:monospace;font-size:13px;font-weight:800;margin-top:7px;padding:3px 9px;border-radius:7px;letter-spacing:.02em;}
      .zs-o-r{text-align:right;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:8px;}
      .zs-o-p{font-weight:900;font-size:15px;}
      .zs-o-r a{text-decoration:none;font-size:20px;background:#dcf3e6;border-radius:12px;padding:6px 9px;}
      .zs-empty{font-size:13px;color:var(--mauve-dark);padding:6px 4px;}
      .zs-cap{font-weight:800;font-size:13px;color:var(--mauve-dark);margin:18px 2px 8px;text-transform:uppercase;letter-spacing:.04em;}
      .zs-hint{font-size:12px;color:var(--mauve-dark);line-height:1.45;margin:4px 2px 30px;}`;
    document.head.appendChild(st);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
