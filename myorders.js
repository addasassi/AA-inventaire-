/* ============================================================
   📋 « Mes commandes » : chaque employé voit les commandes qu'il a ajoutées et où elles en sont
   (en cours, livrées, retours, à traiter). L'admin peut choisir un employé ou toute l'équipe.
   ============================================================ */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const all = () => (typeof orders !== 'undefined' ? orders : []);
  const me = () => (typeof currentUser !== 'undefined' && currentUser) || null;
  const isAdmin = () => !!(me() && me().role === 'admin');
  const isHand = o => o.customer && o.customer.deliveryType === 'main';
  const sent = o => !!(o.zr && (o.zr.parcelId || o.zr.tracking));
  const sit = o => norm((o.zr && o.zr.situation) || '');
  let period = '7', filter = 'all', who = null;

  function stateOf(o){
    if(isHand(o) && !sent(o)) return (o.deferred && o.deferredDate && !o.handDone) ? 'progress' : 'delivered';
    const st = o.zr && o.zr.stage;
    if(st === 'delivered') return 'delivered';
    if(st === 'returned') return 'returned';
    const problem = o.verify || o.swapHold || (o.zr && o.zr.status === 'error') || /annul|refus|repond pas|injoignable|sans reponse/.test(sit(o))
      || (!sent(o) && !isHand(o) && !(o.deferred && o.deferredDate) && !(o.swap) && Date.now() - Date.parse(o.createdAt || 0) > 30 * 60 * 1000);
    return problem ? 'todo' : 'progress';
  }
  function why(o){
    if(o.verify) return '🔎 À vérifier';
    if(o.swapHold) return '⏸️ Retenue pour un swap';
    if(o.zr && o.zr.status === 'error') return '⚠️ Erreur ZR : ' + (o.zr.error || 'à renvoyer');
    const s = (o.zr && o.zr.situation) || '';
    if(/annul|refus/i.test(norm(s))) return '❌ ' + s;
    if(/repond pas|injoignable|sans reponse/.test(norm(s))) return '📵 ' + s + ' — rappelez la cliente';
    if(!sent(o) && !isHand(o)) return '📦 Pas encore envoyée à ZR';
    return '';
  }
  function inPeriod(o){
    if(period === 'all') return true;
    const d = new Date(o.createdAt || 0), now = new Date();
    if(period === '1') return d.toDateString() === now.toDateString();
    if(period === 'm') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return Date.now() - d.getTime() < Number(period) * 86400000;
  }
  function mine(){
    const name = who == null ? (me() && me().name) : who;
    return all().filter(o => (name === '*' || o.createdBy === name) && inPeriod(o) && !o.swap);
  }

  function render(){
    const el = document.getElementById('mo-body'); if(!el || !me()) return;
    if(who == null && isAdmin()) who = '*';
    const list = mine().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const by = {delivered: [], returned: [], todo: [], progress: []};
    list.forEach(o => by[stateOf(o)].push(o));
    const fin = by.delivered.length + by.returned.length;
    const rate = fin ? Math.round(by.delivered.length * 100 / fin) + '%' : '—';
    const money = by.delivered.reduce((t, o) => t + (Number(o.total) || 0), 0);
    const shown = filter === 'all' ? list : by[filter];
    const tile = (k, ico, label, n, cls) => `<button class="mo-tile ${cls || ''} ${filter === k ? 'on' : ''}" data-f="${k}"><span>${ico}</span><b>${n}</b><small>${label}</small></button>`;
    const team = isAdmin() ? `<select id="mo-who"><option value="*">👥 Toute l'équipe</option>${[...new Set(all().map(o => o.createdBy).filter(Boolean))].sort().map(n => `<option value="${esc(n)}" ${who === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : '';
    el.innerHTML = `
      ${team}
      <div class="mo-periods">${[['1', "Aujourd'hui"], ['7', '7 jours'], ['m', 'Ce mois'], ['all', 'Tout']].map(([k, l]) => `<button class="chip ${period === k ? 'active' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="mo-tiles">
        ${tile('all', '🛍️', 'Ajoutées', list.length)}
        ${tile('todo', '⚠️', 'À traiter', by.todo.length, by.todo.length ? 'warn' : '')}
        ${tile('progress', '🚚', 'En cours', by.progress.length)}
        ${tile('delivered', '✅', 'Livrées', by.delivered.length, 'ok')}
        ${tile('returned', '↩️', 'Retours', by.returned.length, by.returned.length ? 'bad' : '')}
        <div class="mo-tile rate"><span>🎯</span><b>${rate}</b><small>Taux de livraison</small></div>
      </div>
      <div class="mo-money">💰 Livré : <b>${Math.round(money).toLocaleString('fr-FR')} DA</b></div>
      ${shown.length ? shown.map(card).join('') : `<div class="empty"><h3>Aucune commande</h3><p>${filter === 'todo' ? 'Rien à traiter 👏' : 'Aucune commande pour cette période.'}</p></div>`}`;
    el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { period = b.dataset.p; render(); });
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
    const sel = document.getElementById('mo-who'); if(sel){ sel.value = who; sel.onchange = () => { who = sel.value; render(); }; }
  }
  function card(o){
    const c = o.customer || {}, d = new Date(o.createdAt || 0), w = stateOf(o) === 'todo' ? why(o) : '';
    return `<div class="mo-card ${stateOf(o)}" onclick="showOrderDetail('${esc(o.id)}')">
      ${w ? `<div class="mo-why">${esc(w)}</div>` : ''}
      ${window.zrBadge ? window.zrBadge(o) : ''}
      <div class="mo-top"><b>${esc(c.name || 'Cliente')}</b><span>${Math.round(Number(o.total) || 0)} DA</span></div>
      <div class="mo-line">${esc(c.phone || '')}${c.wilaya ? ' • ' + esc(c.wilaya) : ''}${c.commune ? ' / ' + esc(c.commune) : ''} ${c.phone && typeof phoneActionButtons === 'function' ? phoneActionButtons(c.phone) : ''}</div>
      <div class="mo-line small">${(o.items || []).map(i => (i.qty || 1) + '× ' + esc(i.name)).join(', ')}</div>
      <div class="mo-line small">${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})}${who === '*' && o.createdBy ? ' • par ' + esc(o.createdBy) : ''}</div>
    </div>`;
  }

  function open(btn){
    if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-mescommandes').classList.add('active');
    try{ closeSidebar(); }catch(e){}
    filter = 'all';
    render();
    try{ if(typeof loadOrders === 'function') loadOrders().then(render); }catch(e){}
  }
  function install(){
    if(document.getElementById('view-mescommandes')) return;
    const ref = document.querySelector('.tab-btn[data-tab="commandes"]'), main = document.querySelector('.main-content');
    if(!ref || !main) return;
    const btn = document.createElement('button');
    btn.className = 'tab-btn'; btn.dataset.tab = 'mescommandes'; btn.title = 'Mes commandes';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M8.5 12l2 2 4-4"/><line x1="9" y1="17.5" x2="15" y2="17.5"/></svg>';
    ref.after(btn);
    btn.addEventListener('click', () => open(btn));
    const sec = document.createElement('section');
    sec.className = 'view'; sec.id = 'view-mescommandes';
    sec.innerHTML = '<div class="mo-title">📋 Mes commandes</div><div id="mo-body"></div>';
    main.appendChild(sec);
  }
  // se met à jour tout seul quand les commandes changent (si la page est ouverte)
  setInterval(() => { const v = document.getElementById('view-mescommandes'); if(v && v.classList.contains('active') && !document.hidden) render(); }, 15000);
  install(); document.addEventListener('DOMContentLoaded', install);
  window.myOrdersRender = render;

  const st = document.createElement('style');
  st.textContent = `
    .mo-title{font-weight:800;font-size:18px;color:var(--plum);margin:4px 0 10px;}
    #mo-who{width:100%;margin-bottom:10px;}
    .mo-periods{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}
    .mo-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;}
    .mo-tile{display:flex;flex-direction:column;align-items:center;gap:2px;background:var(--card,#fff);border:1.5px solid var(--line);border-radius:14px;padding:10px 4px;font:inherit;color:var(--plum);cursor:pointer;}
    .mo-tile span{font-size:18px;} .mo-tile b{font-size:20px;} .mo-tile small{font-size:11px;opacity:.8;text-align:center;}
    .mo-tile.on{border-color:var(--plum);box-shadow:0 0 0 2px var(--plum) inset;}
    .mo-tile.warn b{color:#c2410c;} .mo-tile.ok b{color:#15803d;} .mo-tile.bad b{color:#b91c1c;}
    .mo-tile.rate{cursor:default;}
    .mo-money{background:#e6f6ec;color:#14532d;border-radius:12px;padding:9px 12px;margin-bottom:12px;font-size:14px;text-align:center;}
    .mo-card{background:var(--card,#fff);border:1px solid var(--line);border-left:5px solid #94a3b8;border-radius:14px;padding:10px 12px;margin-bottom:9px;cursor:pointer;}
    .mo-card.todo{border-left-color:#f59e0b;} .mo-card.delivered{border-left-color:#16a34a;} .mo-card.returned{border-left-color:#dc2626;} .mo-card.progress{border-left-color:#3b82f6;}
    .mo-why{background:#fff4e0;color:#7a4a00;font-weight:700;font-size:13px;border-radius:8px;padding:5px 8px;margin-bottom:6px;}
    .mo-top{display:flex;justify-content:space-between;gap:8px;margin-top:4px;font-size:15px;} .mo-top span{font-weight:800;color:var(--plum);}
    .mo-line{font-size:13px;margin-top:3px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;} .mo-line.small{opacity:.75;font-size:12px;}
  `;
  document.head.appendChild(st);
})();
