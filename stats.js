/* =====================================================================
   Page Statistiques (admin)
   Tout est calculé dans le téléphone à partir des commandes et des
   produits déjà chargés (rien de plus à télécharger).
   Sections : chiffres clés · ventes jour par jour · livraison ZR ·
   à surveiller (commandes bloquées) · produits · stock · wilayas ·
   clientes (fidèles + liste noire) · équipe · heures/jours · export.
   + alerte « liste noire » dans le formulaire de commande
   + résumé du soir (notification) pour l'admin.
   ===================================================================== */
(function(){
  const DAY = 86400000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' DA';
  const num = n => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
  const pct = (a, b) => b ? Math.round(a * 100 / b) + '%' : '—';
  const phoneKey = p => String(p || '').replace(/[^0-9]/g, '').replace(/^213/, '0');
  const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const allOrders = () => (typeof orders !== 'undefined' && Array.isArray(orders)) ? orders : [];
  const allProducts = () => (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
  const isHand = o => !!(o && o.customer && o.customer.deliveryType === 'main');   // 🤝 remise en main propre = livrée tout de suite
  const stageOf = o => isHand(o) ? ((o.deferred && o.deferredDate && !o.handDone) ? 'planned' : 'delivered') : ((o.zr && o.zr.stage) || '');
  const Z = o => isHand(o) ? {stage: stageOf(o), finalAt: o.handDone || o.createdAt, sentAt: o.createdAt, paid: true, deliveryPrice: 0, returnPrice: 0} : (o.zr || {});
  const isDelivered = o => stageOf(o) === 'delivered';
  const isReturned = o => stageOf(o) === 'returned';
  const wilayaOf = o => (o.customer && o.customer.wilaya) || '—';

  /* ---------- Bénéfice réel : tarifs ZR + sponsor (meta/sponsor) ----------
     Bénéfice = ventes livrées − coût d'achat − livraison ZR − retours ZR − sponsor
     Sponsor saisi en € par jour → $ (taux du jour) → DA (prix USDT réglable). */
  const TARIF = {1:[1400,980],2:[750,530],3:[950,680],4:[800,530],5:[800,530],6:[800,530],7:[950,680],8:[1050,730],9:[750,530],10:[800,530],11:[1600,1130],12:[850,530],13:[700,530],14:[750,530],15:[800,530],16:[650,480],17:[950,680],18:[800,530],19:[800,530],20:[750,580],21:[800,530],22:[700,530],23:[850,530],24:[850,530],25:[800,530],26:[750,530],27:[700,530],28:[900,580],29:[700,530],30:[950,730],31:[500,380],32:[1000,680],34:[800,530],35:[800,530],36:[850,530],38:[750,530],39:[950,730],40:[800,530],41:[800,530],42:[800,530],43:[800,530],44:[750,530],45:[1000,680],46:[650,530],47:[950,680],48:[750,530],49:[1050,980],51:[950,680],52:[1600,980],53:[1600,1130],54:[1600,0],55:[950,730],57:[950,0],58:[950,730]};
  let SP = {usdt: 254, retDefault: 200, days: {}}, spSub = null, spLoaded = false;
  function subSponsor(){
    if(spSub || typeof db === 'undefined') return;
    try{
      spSub = db.collection('meta').doc('sponsor').onSnapshot(d => {
        const x = (d.exists && d.data()) || {};
        spLoaded = true;
        SP = {usdt: Number(x.usdt) || 254, retDefault: x.retDefault != null && x.retDefault !== '' ? Number(x.retDefault) : 200, days: x.days || {}, lastRate: Number(x.lastRate) || 0};
        maybeRender();
      }, () => { spSub = null; });
    }catch(e){ spSub = null; }
  }
  const spDa = e => Math.round((Number(e.eur) || 0) * (Number(e.rate) || SP.lastRate || 1.17) * SP.usdt);
  const custOf = o => o.customer || {};
  const deliveryFee = o => {
    if(isHand(o)) return 0;
    const z = o.zr || {};
    if(Number(z.deliveryPrice) > 0) return Number(z.deliveryPrice);
    const t = TARIF[Number(custOf(o).wilayaCode)];
    return t ? (custOf(o).deliveryType === 'stopdesk' ? (t[1] || t[0]) : t[0]) : 0;
  };
  async function eurUsd(date){
    const today = dayKey(Date.now());
    const tries = [
      async () => (await (await fetch('https://api.frankfurter.app/' + (date >= today ? 'latest' : date) + '?from=EUR&to=USD')).json()).rates.USD,
      async () => (await (await fetch('https://open.er-api.com/v6/latest/EUR')).json()).rates.USD
    ];
    for(const f of tries){ try{ const r = Number(await f()); if(r > 0.5 && r < 2) return r; }catch(e){} }
    return SP.lastRate || 1.17;
  }
  window.zrSpSave = async () => {
    const d = document.getElementById('pf-date'), e = document.getElementById('pf-eur'), b = document.getElementById('pf-save');
    const date = d && d.value, eur = Number(String(e && e.value || '').replace(',', '.'));
    if(!date){ toast('Choisissez le jour', true); return; }
    if(!(eur >= 0) || e.value === ''){ toast('Écrivez le montant en €', true); return; }
    if(b){ b.disabled = true; b.textContent = '…'; }
    try{
      const rate = await eurUsd(date);
      await db.collection('meta').doc('sponsor').set({lastRate: rate, days: {[date]: {eur, rate, at: new Date().toISOString(), by: (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || ''}}}, {merge: true});
      ['pf-eur', 'pf-date'].forEach(id => { const el = document.getElementById(id); if(el) delete el.dataset.touched; });
      toast(eur ? `📣 ${eur} € → ${money(Math.round(eur * rate * SP.usdt))} enregistré` : '📣 Sponsor supprimé pour ce jour');
    }catch(err){ toast('Échec de l\'enregistrement : ' + (err && err.message || err), true); }
    if(b){ b.disabled = false; b.textContent = 'Enregistrer'; }
  };
  let ncOpen = false;
  window.zrNcToggle = v => { ncOpen = v; };
  window.zrNcOpen = id => { if(typeof openProductModal === 'function') openProductModal(id); };
  window.zrNcSave = async id => {
    const inp = document.getElementById('nc-' + id);
    const v = Number(String(inp && inp.value || '').replace(',', '.').replace(/\s/g, ''));
    if(!(v > 0)){ toast('Écrivez le prix d\'achat', true); return; }
    try{
      await db.collection('products').doc(id).set({cost: v}, {merge: true});
      const p = allProducts().find(x => x.id === id); if(p) p.cost = v;
      toast('✅ Prix d\'achat enregistré : ' + money(v));
      render();
    }catch(e){ toast('Échec : ' + (e.message || e), true); }
  };
  window.zrSpEdit = date => {
    const d = document.getElementById('pf-date'), e = document.getElementById('pf-eur');
    if(d){ d.value = date; d.dataset.touched = '1'; }
    if(e){ const x = SP.days[date]; e.value = x && x.eur ? x.eur : ''; e.dataset.touched = '1'; e.focus(); }
  };
  window.zrSpSettings = async () => {
    const u = Number(String(document.getElementById('pf-usdt').value).replace(',', '.'));
    const r = Number(String(document.getElementById('pf-ret').value).replace(',', '.'));
    if(!(u > 0)){ toast('Prix USDT invalide', true); return; }
    try{ await db.collection('meta').doc('sponsor').set({usdt: u, retDefault: r >= 0 ? r : 200}, {merge: true}); ['pf-usdt', 'pf-ret'].forEach(id => { const el = document.getElementById(id); if(el) delete el.dataset.touched; }); toast('✅ Réglages enregistrés'); }
    catch(err){ toast('Échec : ' + (err && err.message || err), true); }
  };

  /* ---------- Période ---------- */
  let period = 'month', customFrom = '', customTo = '';
  function range(){
    const now = new Date(), today = dayStart(now);
    let from, to = new Date(today.getTime() + DAY);
    if(period === 'today') from = today;
    else if(period === '7') from = new Date(today.getTime() - 6 * DAY);
    else if(period === '30') from = new Date(today.getTime() - 29 * DAY);
    else if(period === 'month') from = new Date(today.getFullYear(), today.getMonth(), 1);
    else if(period === 'lastmonth'){ from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); }
    else if(period === 'custom' && customFrom){ from = dayStart(customFrom + 'T00:00:00'); to = new Date(dayStart((customTo || customFrom) + 'T00:00:00').getTime() + DAY); }
    else { // tout
      const first = allOrders().reduce((m, o) => Math.min(m, Date.parse(o.createdAt) || m), Date.now());
      from = dayStart(first);
    }
    const len = to - from;
    return {from, to, prevFrom: new Date(from.getTime() - len), prevTo: from, days: Math.max(1, Math.round(len / DAY))};
  }
  const inRange = (o, a, b) => { const t = Date.parse(o.createdAt); return t >= a.getTime() && t < b.getTime(); };

  /* ---------- Petits composants ---------- */
  function delta(cur, prev){
    if(period === 'all' || !prev) return '';
    const d = Math.round((cur - prev) * 100 / Math.abs(prev));
    if(!isFinite(d) || d === 0) return '<span class="st-delta">= période préc.</span>';
    return `<span class="st-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
  }
  const tile = (label, value, sub, extra) => `<div class="st-tile${extra ? ' ' + extra : ''}"><div class="st-l">${label}</div><div class="st-v">${value}</div>${sub ? `<div class="st-s">${sub}</div>` : ''}</div>`;
  const section = (title, body, hint) => `<section class="st-sec"><h3>${title}</h3>${hint ? `<div class="st-hint">${hint}</div>` : ''}${body}</section>`;
  // barres horizontales (une seule couleur : la longueur porte la valeur)
  function hbars(rows, fmt, opts){
    opts = opts || {};
    if(!rows.length) return '<div class="st-empty">Pas encore de données</div>';
    const max = Math.max(...rows.map(r => r.v), 1);
    return '<div class="st-hb">' + rows.map(r => `<div class="st-hb-row"${r.click ? ` onclick="${r.click}"` : ''}>
      ${r.img ? `<img src="${esc(r.img)}" loading="lazy">` : ''}
      <div class="st-hb-main"><div class="st-hb-top"><span class="st-hb-name">${esc(r.label)}</span><span class="st-hb-val">${fmt(r.v)}${r.note ? ` <small>${r.note}</small>` : ''}</span></div>
      <div class="st-hb-track"><div class="st-hb-fill${opts.cls ? ' ' + opts.cls : ''}" style="width:${Math.max(2, r.v * 100 / max)}%"></div></div></div></div>`).join('') + '</div>';
  }
  // barre empilée livrées / en cours / retours (avec libellés, jamais la couleur seule)
  function stackBar(d, e, r){
    const t = d + e + r || 1;
    const seg = (n, cls) => n ? `<div class="${cls}" style="width:${n * 100 / t}%"></div>` : '';
    return `<div class="st-stack">${seg(d, 'ok')}${seg(e, 'mid')}${seg(r, 'bad')}</div>
      <div class="st-legend"><span><i class="ok"></i>Livrées ${d}</span><span><i class="mid"></i>En cours ${e}</span><span><i class="bad"></i>Retours ${r}</span></div>`;
  }
  function table(head, rows){
    if(!rows.length) return '<div class="st-empty">Pas encore de données</div>';
    return `<div class="st-tw"><table class="st-t"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr${r.click ? ` onclick="${r.click}"` : ''}>${r.cells.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------- Courbe des ventes (période vs période précédente) ---------- */
  let chartData = null;
  const cmd = n => n + ' commande' + (n > 1 ? 's' : '');
  function lineChart(R, cur, prev){
    const byHour = R.days <= 1;
    const n = byHour ? 24 : R.days;
    const bucket = (list, start) => {
      const arr = new Array(n).fill(0);
      list.forEach(o => {
        const t = Date.parse(o.createdAt);
        const i = byHour ? new Date(t).getHours() : Math.floor((dayStart(t) - start) / DAY);
        if(i >= 0 && i < n) arr[i] += 1;
      });
      return arr;
    };
    const a = bucket(cur, R.from), b = period === 'all' ? null : bucket(prev, R.prevFrom);
    const labels = [...Array(n)].map((_, i) => byHour ? i + 'h' : new Date(R.from.getTime() + i * DAY).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'}));
    chartData = {a, b, labels};
    const W = 340, H = 150, L = 6, Rr = 6, T = 10, B = 22;
    const max = Math.max(...a, ...(b || [0]), 1);
    const x = i => L + (n === 1 ? (W - L - Rr) / 2 : i * (W - L - Rr) / (n - 1));
    const y = v => T + (H - T - B) * (1 - v / max);
    const path = arr => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, s) => s.indexOf(v) === i);
    return `<div class="st-chart" id="st-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Commandes ${byHour ? 'par heure' : 'par jour'}">
        <line x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}" class="st-axis"/>
        <line x1="${L}" x2="${W - Rr}" y1="${y(max / 2)}" y2="${y(max / 2)}" class="st-gl"/>
        ${b ? `<path d="${path(b)}" class="st-prev"/>` : ''}
        <path d="${path(a)}" class="st-cur"/>
        ${ticks.map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="st-tick">${esc(labels[i])}</text>`).join('')}
        <line id="st-cross" x1="0" x2="0" y1="${T}" y2="${y(0)}" class="st-cross" style="display:none"/>
        <circle id="st-dot" r="4" class="st-dot" style="display:none"/>
      </svg>
      <div class="st-tip" id="st-tip" style="display:none"></div>
      <div class="st-legend"><span><i class="cur"></i>Cette période</span>${b ? '<span><i class="prev"></i>Période précédente</span>' : ''}<span class="st-max">max ${cmd(max)}</span></div>
    </div>`;
  }
  function bindChart(){
    const box = document.getElementById('st-chart');
    if(!box || !chartData) return;
    const svg = box.querySelector('svg'), tip = box.querySelector('#st-tip'), cross = box.querySelector('#st-cross'), dot = box.querySelector('#st-dot');
    const {a, b, labels} = chartData, n = a.length;
    const W = 340, H = 150, L = 6, Rr = 6, T = 10, B = 22, max = Math.max(...a, ...(b || [0]), 1);
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : (px - L) / ((W - L - Rr) / (n - 1)))));
      const xx = L + (n === 1 ? (W - L - Rr) / 2 : i * (W - L - Rr) / (n - 1));
      cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.style.display = '';
      dot.setAttribute('cx', xx); dot.setAttribute('cy', T + (H - T - B) * (1 - a[i] / max)); dot.style.display = '';
      tip.innerHTML = `<b>${esc(labels[i])}</b><br>${cmd(a[i])}${b ? `<br><span>avant : ${cmd(b[i])}</span>` : ''}`;
      tip.style.display = '';
      const left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, xx / W * r.width - tip.offsetWidth / 2));
      tip.style.left = left + 'px';
    };
    const hide = () => { tip.style.display = 'none'; cross.style.display = 'none'; dot.style.display = 'none'; };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('touchmove', move, {passive: true});
    svg.addEventListener('pointerleave', hide);
  }

  /* ---------- Calculs ---------- */
  function compute(){
    const R = range();
    const ALL = allOrders(), P = allProducts();
    const cur = ALL.filter(o => inRange(o, R.from, R.to));
    const prev = ALL.filter(o => inRange(o, R.prevFrom, R.prevTo));
    const sum = (l, f) => l.reduce((t, o) => t + (Number(f(o)) || 0), 0);
    const prodById = {}; P.forEach(p => prodById[p.id] = p);

    // argent
    const ca = sum(cur, o => o.total), caP = sum(prev, o => o.total);
    const profit = sum(cur, o => o.profit != null ? o.profit : o.total), profitP = sum(prev, o => o.profit != null ? o.profit : o.total);
    const delivered = cur.filter(isDelivered), returned = cur.filter(isReturned);
    const inProgress = cur.filter(o => o.zr && o.zr.parcelId && !isDelivered(o) && !isReturned(o));
    const fees = sum(delivered, o => Z(o).deliveryPrice) + sum(returned, o => Z(o).returnPrice);
    const net = sum(delivered, o => o.profit != null ? o.profit : o.total) - fees;
    const atZr = ALL.filter(o => isDelivered(o) && Z(o).finalAt && !Z(o).paid);   // suivi de l'encaissement depuis la v8 du relais
    const atZrMoney = sum(atZr, o => (Number(o.total) || 0) - (Number(Z(o).deliveryPrice) || 0));
    const noCostList = P.filter(p => !(Number(p.cost) > 0));
    const noCost = noCostList.length;

    // 💰 bénéfice réel
    const learned = {};
    ALL.forEach(o => { const rp = Number((o.zr || {}).returnPrice); if(rp > 0){ const c = custOf(o); learned[c.wilayaCode + '|' + c.deliveryType] = rp; if(!learned[c.wilayaCode]) learned[c.wilayaCode] = rp; } });
    let retEst = 0;
    const returnFee = o => {
      const rp = Number((o.zr || {}).returnPrice); if(rp > 0) return rp;
      const c = custOf(o); retEst++;
      return learned[c.wilayaCode + '|' + c.deliveryType] || learned[c.wilayaCode] || SP.retDefault;
    };
    const costOf = o => o.costTotal != null ? Number(o.costTotal) || 0 : (o.profit != null ? (Number(o.total) || 0) - Number(o.profit) : 0);
    const pf = {sales: sum(delivered, o => o.total), cost: sum(delivered, costOf), deliv: sum(delivered, deliveryFee), ret: sum(returned, returnFee), retEst};
    const fromK = dayKey(R.from), toK = dayKey(R.to - 1);
    pf.spDays = Object.entries(SP.days || {}).filter(([d, e]) => e && Number(e.eur) > 0 && d >= fromK && d <= toK).sort((a, b) => b[0].localeCompare(a[0]));
    pf.spEur = pf.spDays.reduce((t, [, e]) => t + Number(e.eur), 0);
    pf.spDa = pf.spDays.reduce((t, [, e]) => t + spDa(e), 0);
    pf.net = pf.sales - pf.cost - pf.deliv - pf.ret - pf.spDa;
    const pend = cur.filter(o => !isDelivered(o) && !isReturned(o));
    pf.pendN = pend.length; pf.pendProfit = sum(pend, o => (Number(o.total) || 0) - costOf(o) - deliveryFee(o));

    // livraison par wilaya + type + délai
    const wil = {};
    cur.forEach(o => {
      const w = wilayaOf(o); const x = wil[w] || (wil[w] = {n: 0, ca: 0, d: 0, r: 0, days: [], fee: 0});
      x.n++; x.ca += Number(o.total) || 0;
      if(isDelivered(o)){ x.d++; if(Z(o).sentAt && Z(o).finalAt) x.days.push((Date.parse(Z(o).finalAt) - Date.parse(Z(o).sentAt)) / DAY); }
      if(isReturned(o)) x.r++;
    });
    const types = {domicile: {n: 0, d: 0, r: 0}, stopdesk: {n: 0, d: 0, r: 0}, main: {n: 0, d: 0, r: 0}};
    cur.forEach(o => { const dt0 = o.customer && o.customer.deliveryType; const t = types[dt0 === 'stopdesk' ? 'stopdesk' : (dt0 === 'main' ? 'main' : 'domicile')]; t.n++; if(isDelivered(o)) t.d++; if(isReturned(o)) t.r++; });
    const allDays = [].concat(...Object.values(wil).map(x => x.days));
    const avgDays = allDays.length ? allDays.reduce((a, b) => a + b, 0) / allDays.length : 0;
    const nrp = cur.filter(o => o.zr && (Number(o.zr.nrp) > 0 || /r[eé]pond pas/i.test(o.zr.situation || '')));

    // commandes à surveiller (toutes périodes)
    const now = Date.now(), todayIso = dayKey(now);
    const watch = [];
    const wnorm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    ALL.forEach(o => {
      const z = o.zr || {};
      if(isDelivered(o) || isReturned(o)) return;
      const age = (now - Date.parse(o.createdAt)) / DAY;
      if(z.status === 'error') watch.push({o, why: '❌ Erreur ZR : ' + (z.error || ''), lvl: 3});
      else if(o.deferred && o.deferredDate && o.deferredDate <= todayIso && !z.parcelId) watch.push({o, why: '🕓 Reportée — à envoyer (' + new Date(o.deferredDate + 'T00:00:00').toLocaleDateString('fr-FR') + ')', lvl: 2});
      else if(o.zr && !z.parcelId && !o.deferred && age > 1 / 24) watch.push({o, why: '📦 Pas encore envoyée à ZR', lvl: 2});
      else {
        // seulement ce qui demande une action : annulée, sans réponse, colis bloqué au même état
        const sit = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(z.situation || '') ? '' : (z.situation || '');
        const sk = wnorm(sit), stk = wnorm(z.state);
        const since = Math.floor((now - Date.parse(z.stateAt || z.sentAt || o.createdAt)) / DAY);
        const where = (o.customer && o.customer.deliveryType === 'stopdesk') ? ' · Stop desk' : ' · Domicile';
        if(/annul/.test(sk)) watch.push({o, why: '❌ ' + sit + where, lvl: 3});
        else if(/ne repond pas|sans reponse|injoignable|nrp|refus/.test(sk)) watch.push({o, why: '📵 ' + sit + where, lvl: 2});
        else if(z.parcelId && /confirme au bureau|au bureau|chez partenaire/.test(stk) && since >= 3) watch.push({o, why: '🏢 ' + (z.state || 'Au bureau') + ' depuis ' + since + ' j — pas récupéré' + where, lvl: 2});
        else if(z.parcelId && /vers wilaya|dispatch|transit|expedi/.test(stk) && since >= 4) watch.push({o, why: '🐢 ' + (z.state || 'Vers wilaya') + ' depuis ' + since + ' j', lvl: 1});
        else if(z.parcelId && z.stage === 'out_for_delivery' && since >= 3) watch.push({o, why: '🛵 ' + (z.state || 'En livraison') + ' depuis ' + since + ' j', lvl: 1});
      }
    });
    watch.sort((a, b) => b.lvl - a.lvl || Date.parse(a.o.createdAt) - Date.parse(b.o.createdAt));

    // produits
    const pieceKey = it => it.productId + '#' + (it.colorIndex == null ? 'm' : it.colorIndex);
    const pieceImg = it => { const p = prodById[it.productId]; if(!p) return it.img || ''; if(it.colorIndex != null && p.colors && p.colors[it.colorIndex]) return p.colors[it.colorIndex].img || ''; return p.img || ''; };
    const top = {}, topModel = {}, cats = {};
    cur.forEach(o => (o.items || []).forEach(it => {
      const q = Number(it.qty) || 0, v = (Number(it.price) || 0) * q;
      const k = pieceKey(it); const t = top[k] || (top[k] = {label: it.name, v: 0, ca: 0, img: pieceImg(it)}); t.v += q; t.ca += v;
      const p = prodById[it.productId]; const mk = it.productId;
      const m = topModel[mk] || (topModel[mk] = {label: p ? p.name : it.name, v: 0, ca: 0, img: p ? p.img : it.img}); m.v += q; m.ca += v;
      const c = (p && p.cat) || 'Autre'; cats[c] = (cats[c] || 0) + q;
    }));

    // vitesse de vente (14 derniers jours) → stock dormant, à racheter
    const since14 = now - 14 * DAY, since30 = now - 30 * DAY;
    const sold14 = {}, lastSale = {};
    ALL.forEach(o => (o.items || []).forEach(it => {
      const t = Date.parse(o.createdAt), k = pieceKey(it);
      if(t >= since14) sold14[k] = (sold14[k] || 0) + (Number(it.qty) || 0);
      lastSale[it.productId] = Math.max(lastSale[it.productId] || 0, t);
    }));
    const firstOrder = ALL.reduce((m, o) => Math.min(m, Date.parse(o.createdAt) || m), now);
    const historyDays = Math.floor((now - firstOrder) / DAY);
    const pieces = [];
    P.forEach(p => {
      pieces.push({k: p.id + '#m', p, name: p.colorName ? p.name + ' — ' + p.colorName : p.name, qty: Number(p.qty) || 0, img: p.img, price: Number(p.price) || 0, cost: Number(p.cost) || 0});
      (p.colors || []).forEach((c, i) => { if(c) pieces.push({k: p.id + '#' + i, p, name: p.name + ' — ' + (c.name || ('couleur ' + (i + 1))), qty: Number(c.qty) || 0, img: c.img, price: Number(c.price != null && c.price !== '' ? c.price : p.price) || 0, cost: Number(c.cost != null && c.cost !== '' ? c.cost : p.cost) || 0}); });
    });
    const reorder = pieces.map(x => { const s = sold14[x.k] || 0; const perDay = s / 14; return Object.assign(x, {s, perDay, left: perDay ? x.qty / perDay : Infinity}); })
      .filter(x => x.s >= 2 && x.left <= 7).sort((a, b) => a.left - b.left).slice(0, 12);
    const dormant = P.filter(p => {
      const stock = (Number(p.qty) || 0) + (p.colors || []).reduce((t, c) => t + (Number(c && c.qty) || 0), 0);
      const created = Number(String(p.id).replace(/\D/g, '').slice(0, 13)) || 0;
      return stock > 0 && (lastSale[p.id] || 0) < since30 && (!created || created < since30);
    }).map(p => {
      const stock = (Number(p.qty) || 0) + (p.colors || []).reduce((t, c) => t + (Number(c && c.qty) || 0), 0);
      return {label: p.name, v: stock, img: p.img, note: lastSale[p.id] ? 'dernière vente ' + new Date(lastSale[p.id]).toLocaleDateString('fr-FR') : 'aucune vente enregistrée'};
    }).sort((a, b) => b.v - a.v).slice(0, 15);
    const stockCost = pieces.reduce((t, x) => t + x.qty * x.cost, 0), stockPrice = pieces.reduce((t, x) => t + x.qty * x.price, 0), stockN = pieces.reduce((t, x) => t + x.qty, 0);

    // clientes (toutes périodes)
    const cust = {};
    ALL.forEach(o => {
      const k = phoneKey(o.customer && o.customer.phone); if(!k) return;
      const c = cust[k] || (cust[k] = {name: (o.customer && o.customer.name) || k, phone: (o.customer && o.customer.phone) || k, n: 0, spent: 0, r: 0, d: 0, last: 0, wil: wilayaOf(o)});
      c.n++; c.spent += Number(o.total) || 0; if(isReturned(o)) c.r++; if(isDelivered(o)) c.d++;
      c.last = Math.max(c.last, Date.parse(o.createdAt) || 0);
    });
    const custList = Object.values(cust);
    const loyal = custList.filter(c => c.n >= 2).sort((a, b) => b.spent - a.spent);
    const black = custList.filter(c => c.r > 0).sort((a, b) => b.r - a.r || b.last - a.last);
    const topCust = custList.slice().sort((a, b) => b.spent - a.spent).slice(0, 5);

    // équipe
    const team = {};
    cur.forEach(o => { const k = o.createdBy || '—'; const t = team[k] || (team[k] = {n: 0, ca: 0, d: 0, r: 0}); t.n++; t.ca += Number(o.total) || 0; if(isDelivered(o)) t.d++; if(isReturned(o)) t.r++; });

    // heures / jours
    const hours = new Array(24).fill(0), wdays = new Array(7).fill(0);
    cur.forEach(o => { const d = new Date(o.createdAt); hours[d.getHours()]++; wdays[(d.getDay() + 6) % 7]++; });

    return {R, cur, prev, ca, caP, profit, profitP, delivered, returned, inProgress, fees, net, pf, atZr, atZrMoney, noCost, noCostList,
      wil, types, avgDays, nrp, watch, top, topModel, cats, reorder, dormant, historyDays, stockCost, stockPrice, stockN,
      loyal, black, topCust, custN: custList.length, team, hours, wdays};
  }

  /* ---------- Affichage ---------- */
  const PERIODS = [['today', "Aujourd'hui"], ['7', '7 jours'], ['30', '30 jours'], ['month', 'Ce mois'], ['lastmonth', 'Mois dernier'], ['all', 'Tout'], ['custom', '📅 Dates']];
  let lastS = null;

  function render(){
    const root = document.getElementById('statsPage');
    if(!root) return;
    css();
    const S = lastS = compute();
    const n = S.cur.length, nP = S.prev.length;
    const finished = S.delivered.length + S.returned.length;
    const wilRows = Object.entries(S.wil).sort((a, b) => b[1].n - a[1].n || b[1].ca - a[1].ca);
    const tops = Object.values(S.top).sort((a, b) => b.v - a.v).slice(0, 10);
    const topModels = Object.values(S.topModel).sort((a, b) => b.v - a.v).slice(0, 10);
    // ↩️ retours : modèles les plus retournés (période) + retours à récupérer (toutes périodes)
    const retAgg = {}, finAgg = {};
    S.delivered.concat(S.returned).forEach(o => (o.items || []).forEach(it => {
      const k = it.name || '?';
      (finAgg[k] = finAgg[k] || {n: 0}).n += Number(it.qty) || 1;
    }));
    S.returned.forEach(o => (o.items || []).forEach(it => {
      const k = it.name || '?';
      const r = retAgg[k] = retAgg[k] || {label: k, v: 0, img: it.img || ''};
      r.v += Number(it.qty) || 1;
    }));
    const topRet = Object.values(retAgg).sort((a, b) => b.v - a.v).slice(0, 10)
      .map(r => Object.assign(r, {note: finAgg[r.label] && finAgg[r.label].n ? pct(r.v, finAgg[r.label].n) + ' de retour' : ''}));
    const pendRet = allOrders().filter(o => isReturned(o) && !(o.returnInfo && o.returnInfo.at));
    const oldRet = pendRet.filter(o => Date.now() - Date.parse((o.zr && (o.zr.finalAt || o.zr.updatedAt)) || o.createdAt) > 7 * 86400000);
    const backRet = allOrders().filter(o => o.returnInfo && o.returnInfo.at && Date.parse(o.returnInfo.at) >= S.R.from && Date.parse(o.returnInfo.at) < S.R.to);
    const orderClick = id => `zrStatsOpen('${id}')`;
    const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const bestH = S.hours.indexOf(Math.max(...S.hours)), bestD = S.wdays.indexOf(Math.max(...S.wdays));

    const keepIds = ['pf-date', 'pf-eur', 'pf-usdt', 'pf-ret'].concat([...document.querySelectorAll('#statsPage input[id^="nc-"]')].map(e => e.id));
    const keep = {}; keepIds.forEach(id => { const el = document.getElementById(id); if(el && el.dataset.touched) keep[id] = el.value; });
    const focusId = document.activeElement && document.activeElement.id;
    const setOpen = !!document.querySelector('.pf-set[open]');
    root.innerHTML = `
      <div class="st-periods">${PERIODS.map(([k, l]) => `<button class="chip${period === k ? ' active' : ''}" onclick="zrStatsPeriod('${k}')">${l}</button>`).join('')}</div>
      <div class="st-custom" style="display:${period === 'custom' ? 'flex' : 'none'}">
        <label>Du <input type="date" id="st-from" value="${customFrom}"></label><label>Au <input type="date" id="st-to" value="${customTo}"></label>
      </div>
      <div class="st-range">${S.R.from.toLocaleDateString('fr-FR')} → ${new Date(S.R.to - 1).toLocaleDateString('fr-FR')}${S.historyDays < 30 ? ` · <span>historique : ${S.historyDays + 1} jour(s) de commandes</span>` : ''}</div>

      ${profitSection(S)}

      ${section('📊 Chiffres clés', `<div class="st-grid">
        ${tile("Chiffre d'affaires", money(S.ca), delta(S.ca, S.caP) || 'toutes les commandes, même pas encore livrées')}
        ${tile('Commandes', num(n), delta(n, nP))}
        ${tile('Marge sur articles', money(S.profit), delta(S.profit, S.profitP) || 'vente − achat, toutes commandes')}
        ${tile('Panier moyen', money(n ? S.ca / n : 0), nP ? 'avant : ' + money(S.caP / nP) : '')}
      </div>`)}

      ${section('📈 Commandes ' + (S.R.days <= 1 ? 'heure par heure' : 'jour par jour'), lineChart(S.R, S.cur, S.prev), 'Touchez la courbe pour voir le détail.')}

      ${section('🚚 Livraison ZR', `
        <div class="st-grid">
          ${tile('Taux de livraison', finished ? pct(S.delivered.length, finished) : '—', finished ? S.delivered.length + ' livrées / ' + finished + ' terminées' : 'aucun colis terminé', finished && S.delivered.length / finished < 0.7 ? 'bad' : finished ? 'good' : '')}
          ${tile('Retours', num(S.returned.length), finished ? pct(S.returned.length, finished) + ' des colis terminés' : '')}
          ${tile('Délai moyen', S.avgDays ? S.avgDays.toFixed(1).replace('.', ',') + ' j' : '—', 'envoi → livraison')}
          ${tile('« Ne répond pas »', num(S.nrp.length), S.nrp.length ? pct(S.nrp.length, n) + ' des commandes' : '')}
          ${tile('Argent chez ZR', money(S.atZrMoney), S.atZr.length + ' colis livrés pas encore encaissés', 'wide')}
        </div>
        ${stackBar(S.delivered.length, S.inProgress.length, S.returned.length)}
        <h4>Domicile / Stop desk</h4>
        ${table(['Type', 'Commandes', 'Livrées', 'Retours', 'Taux'], [['🏠 Domicile', S.types.domicile], ['🏢 Stop desk', S.types.stopdesk], ['🤝 En main propre', S.types.main]].map(([l, t]) => ({cells: [l, t.n, t.d, t.r, t.d + t.r ? pct(t.d, t.d + t.r) : '—']})))}
        <h4>Par wilaya</h4>
        ${table(['Wilaya', 'Cmd', 'Livrées', 'Retours', 'Taux', 'Délai'], wilRows.map(([w, x]) => ({cells: [esc(w), x.n, x.d, x.r ? `<b class="bad-t">${x.r}</b>` : 0, x.d + x.r ? pct(x.d, x.d + x.r) : '—', x.days.length ? (x.days.reduce((a, b) => a + b, 0) / x.days.length).toFixed(1).replace('.', ',') + ' j' : '—']})))}
      `)}

      ${section('⏳ À surveiller (' + S.watch.length + ')', S.watch.length ? '<div class="st-watch">' + S.watch.slice(0, 60).map((w, i) => `<div class="st-w lvl${w.lvl}"${i >= 12 ? ' data-more style="display:none"' : ''} onclick="${orderClick(w.o.id)}">
          <div><b>${esc((w.o.customer && w.o.customer.name) || 'Client')}</b> · ${esc(wilayaOf(w.o))}<br><span>${esc(w.why)}</span></div>
          <div class="st-w-r">${money(w.o.total)}<br><small>${new Date(w.o.createdAt).toLocaleDateString('fr-FR')}</small></div></div>`).join('')
          + (S.watch.length > 12 ? `<button class="st-more" onclick="this.parentNode.querySelectorAll('[data-more]').forEach(e=>e.style.display='');this.remove()">Voir tout (${Math.min(60, S.watch.length)})</button>` : '') + '</div>'
        : '<div class="st-empty ok">✅ Rien à signaler</div>', 'Toutes périodes : erreurs ZR, pas envoyées, annulées, « Ne répond pas », colis bloqués (au bureau depuis 3 j, vers wilaya depuis 4 j, en livraison depuis 3 j).')}

      ${section('👗 Les plus vendus', `
        <div class="st-tabs"><button class="on" onclick="zrStatsTab(this,'st-top-c')">Par couleur</button><button onclick="zrStatsTab(this,'st-top-m')">Par modèle</button></div>
        <div id="st-top-c">${hbars(tops.map(t => ({label: t.label, v: t.v, img: t.img})), v => v + ' pcs')}</div>
        <div id="st-top-m" style="display:none">${hbars(topModels.map(t => ({label: t.label, v: t.v, img: t.img})), v => v + ' pcs')}</div>
        <h4>Ventes par catégorie</h4>
        ${(() => { const totP = Object.values(S.cats).reduce((a, b) => a + b, 0); return hbars(Object.entries(S.cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({label: c, v, note: pct(v, totP)})), v => v + ' pcs'); })()}
      `)}

      ${section('🔁 À racheter bientôt', S.reorder.length ? hbars(S.reorder.map(x => ({label: x.name, v: x.s, img: x.img, note: x.qty <= 0 ? '— <b class="bad-t">rupture</b>' : `— reste ${x.qty}, ≈ ${Math.max(1, Math.round(x.left))} j`})), v => v + ' vendus/14 j', {cls: 'warn'}) : '<div class="st-empty ok">✅ Aucun article ne va manquer cette semaine</div>', 'Pièces vendues au moins 2 fois en 14 jours dont le stock tiendra moins d\'une semaine à ce rythme.')}

      ${section('↩️ Retours', `<div class="st-grid">
          ${tile('À récupérer chez ZR', num(pendRet.length), oldRet.length ? '<b class="bad-t">' + oldRet.length + ' depuis plus de 7 jours</b>' : 'tous récents')}
          ${tile('Remis en stock', num(backRet.length), 'sur la période')}
        </div>
        <button class="st-more" onclick="document.querySelector('.tab-btn[data-tab=&quot;scan&quot;]').click();setTimeout(function(){var e=document.getElementById('rt-section');if(e)e.scrollIntoView({behavior:'smooth'})},250)">↩️ Ouvrir la réception des retours</button>
        <h4>Modèles les plus retournés</h4>
        ${topRet.length ? hbars(topRet, v => v + ' pcs', {cls: 'warn'}) : '<div class="st-empty ok">✅ Aucun retour sur la période</div>'}
      `, 'Un modèle souvent retourné = taille, photo ou description à revoir.')}

      ${section('😴 Modèles qui dorment', S.dormant.length ? hbars(S.dormant, v => v + ' en stock', {cls: 'muted'}) : '<div class="st-empty ok">✅ Tout se vend</div>', 'En stock mais aucune vente depuis 30 jours — pensez à une promo ou une nouvelle photo.' + (S.historyDays < 30 ? ' (Historique de commandes encore court : liste plus fiable dans quelques semaines.)' : ''))}

      ${section('🗺️ Wilayas', hbars(wilRows.slice(0, 15).map(([w, x]) => ({label: w, v: x.n, note: x.d ? x.d + ' livrée' + (x.d > 1 ? 's' : '') : ''})), v => v + ' cmd'))}

      ${section('👥 Clientes', `<div class="st-grid">
          ${tile('Clientes', num(S.custN))}
          ${tile('Fidèles (2+ commandes)', num(S.loyal.length), S.custN ? pct(S.loyal.length, S.custN) : '')}
        </div>
        <h4>Meilleures clientes</h4>
        ${table(['Cliente', 'Cmd', 'Total'], S.topCust.map(c => ({cells: [`${esc(c.name)}<br><small>${esc(c.phone)} · ${esc(c.wil)}</small>`, c.n, money(c.spent)]})))}
        <h4>⛔ Liste noire (colis retournés)</h4>
        ${S.black.length ? table(['Cliente', 'Retours', 'Livrées'], S.black.slice(0, 30).map(c => ({cells: [`${esc(c.name)}<br><small>${esc(c.phone)} · ${esc(c.wil)}</small>`, `<b class="bad-t">${c.r}</b>`, c.d]}))) : '<div class="st-empty ok">✅ Aucune cliente n\'a retourné de colis</div>'}
        <div class="st-hint">Quand une de ces clientes recommande, un avertissement s'affiche dans le formulaire de commande.</div>
      `)}

      ${section('👩‍💼 Équipe', table(['Employé', 'Cmd', 'Livrées', 'Retours', 'Taux'], Object.entries(S.team).sort((a, b) => b[1].n - a[1].n).map(([k, t]) => ({cells: [esc(k), t.n, t.d, t.r, t.d + t.r ? pct(t.d, t.d + t.r) : '—']}))), 'Un taux de livraison bas pour un employé = commandes mal confirmées avec la cliente.')}

      ${section('⏰ Quand vend-on le plus ?', `
        ${n ? `<div class="st-best">Meilleur moment : <b>${WD[bestD]}</b> vers <b>${bestH}h</b> — publiez sur Facebook un peu avant.</div>` : ''}
        <h4>Par jour</h4>${vbars(S.wdays, WD)}
        <h4>Par heure</h4>${vbars(S.hours, S.hours.map((_, i) => i % 3 === 0 ? i + 'h' : ''))}
      `)}

      ${section('🗄️ Sauvegarde automatique', `<div id="st-backup">${backupHtml()}</div>`, 'Chaque nuit, une copie de tous les produits, commandes et clientes est enregistrée à part.')}
      <div class="st-export"><button class="btn-primary" onclick="zrStatsExport()">⬇️ Exporter ces statistiques (Excel)</button></div>`;
    const f = document.getElementById('st-from'), t = document.getElementById('st-to');
    if(f) f.onchange = () => { customFrom = f.value; if(!customTo || customTo < customFrom) customTo = customFrom; render(); };
    if(t) t.onchange = () => { customTo = t.value; render(); };
    bindChart();
    Object.entries(keep).forEach(([id, v]) => { const el = document.getElementById(id); if(el){ el.value = v; el.dataset.touched = '1'; } });
    ['pf-date', 'pf-eur', 'pf-usdt', 'pf-ret'].concat([...document.querySelectorAll('#statsPage input[id^="nc-"]')].map(e => e.id)).forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('input', () => el.dataset.touched = '1'); });
    if(setOpen){ const d = document.querySelector('.pf-set'); if(d) d.open = true; }
    if(focusId && /^(pf|nc)-/.test(focusId)){ const el = document.getElementById(focusId); if(el) el.focus(); }
  }
  function profitSection(S){
    subSponsor();
    const p = S.pf, today = dayKey(Date.now());
    const line = (ic, l, v, sub, sign) => `<div class="pf-l"><span>${ic} ${l}${sub ? `<small>${sub}</small>` : ''}</span><b class="${sign < 0 ? 'neg' : 'pos'}">${sign < 0 ? '− ' : '+ '}${money(v)}</b></div>`;
    const rate = SP.lastRate || 1.17;
    const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {weekday: 'short', day: 'numeric', month: 'short'});
    const todayEntry = SP.days && SP.days[today];
    return section('💰 Bénéfice réel', `
      <div class="pf-big ${p.net < 0 ? 'neg' : ''}"><div class="pf-big-l">Ce qui reste dans ta poche</div><div class="pf-big-v">${money(p.net)}</div></div>
      <div class="pf-lines">
        ${line('💵', 'Ventes livrées', p.sales, S.delivered.length + ' commande' + (S.delivered.length > 1 ? 's' : ''), 1)}
        ${line('🧵', "Prix d'achat des articles", p.cost, '', -1)}
        ${line('🚚', 'Livraison ZR', p.deliv, '', -1)}
        ${line('↩️', 'Retours ZR', p.ret, S.returned.length + ' retour' + (S.returned.length > 1 ? 's' : '') + (p.retEst ? ` · ${p.retEst} estimé${p.retEst > 1 ? 's' : ''}` : ''), -1)}
        ${line('📣', 'Sponsor', p.spDa, p.spEur ? (Math.round(p.spEur * 100) / 100) + ' €' : 'rien saisi', -1)}
        <div class="pf-l pf-tot"><span>= Bénéfice</span><b class="${p.net < 0 ? 'neg' : 'pos'}">${money(p.net)}</b></div>
      </div>
      ${p.pendN ? `<div class="pf-pend">⏳ <b>${p.pendN}</b> commande${p.pendN > 1 ? 's' : ''} pas encore livrée${p.pendN > 1 ? 's' : ''} : jusqu'à <b>${money(p.pendProfit)}</b> de plus si elles sont livrées.</div>` : ''}
      ${S.noCost ? `<details class="st-warn nc"${ncOpen ? ' open' : ''} ontoggle="zrNcToggle(this.open)"><summary>⚠️ <b>${S.noCost} produit(s) sans prix d'achat</b> — touchez pour les compléter</summary>
        ${S.noCostList.map(p => `<div class="nc-r"><img src="${esc(p.img || '')}" onclick="zrNcOpen('${esc(p.id)}')" loading="lazy"><div class="nc-n" onclick="zrNcOpen('${esc(p.id)}')"><b>${esc(p.name)}</b><small>#${esc(p.code || '')} · vendu ${money(p.price)}</small></div>
          <input type="text" inputmode="decimal" id="nc-${esc(p.id)}" placeholder="Achat DA"><button onclick="zrNcSave('${esc(p.id)}')">OK</button></div>`).join('')}
      </details>` : ''}

      <h4>📣 Sponsor du jour</h4>
      <div class="pf-sp">
        <input type="date" id="pf-date" value="${today}" max="${today}" onchange="zrSpEdit(this.value)">
        <input type="text" id="pf-eur" inputmode="decimal" placeholder="Montant en €" value="${todayEntry && todayEntry.eur ? todayEntry.eur : ''}">
        <button id="pf-save" onclick="zrSpSave()">Enregistrer</button>
      </div>
      <div class="st-hint" style="margin:6px 0 0">1 € ≈ ${rate.toFixed(3).replace('.', ',')} $ · 1 USDT = ${SP.usdt} DA → <b>1 € ≈ ${Math.round(rate * SP.usdt)} DA</b>. Le taux € → $ du jour est pris automatiquement.</div>
      ${p.spDays.length ? `<div class="pf-days">${p.spDays.map(([d, e]) => `<div class="pf-day" onclick="zrSpEdit('${d}')"><span>${fmtDay(d)}</span><span>${e.eur} €</span><b>${money(spDa(e))}</b><i>✏️</i></div>`).join('')}</div>` : ''}

      <details class="pf-set"><summary>⚙️ Réglages (prix USDT, retour)</summary>
        <label>Prix d'achat de 1 USDT (DA)<input type="text" inputmode="decimal" id="pf-usdt" value="${SP.usdt}"></label>
        <label>Prix d'un retour quand ZR ne l'indique pas (DA)<input type="text" inputmode="decimal" id="pf-ret" value="${SP.retDefault}"></label>
        <button onclick="zrSpSettings()">Enregistrer les réglages</button>
        <div class="st-hint" style="margin:8px 0 0">Livraison et retour : prix donnés par ZR pour chaque colis. Sinon tarif ZR de la wilaya (livraison) ou le prix ci-dessus (retour).</div>
      </details>
    `, 'Commandes de la période qui sont livrées, moins tous les frais.');
  }
  function vbars(arr, labels){
    const max = Math.max(...arr, 1);
    return `<div class="st-vb">${arr.map((v, i) => `<div class="st-vb-c" title="${v} commande(s)"><div class="st-vb-v">${v || ''}</div><div class="st-vb-b" style="height:${v ? Math.max(4, v * 100 / max) : 0}%"></div><div class="st-vb-l">${labels[i]}</div></div>`).join('')}</div>`;
  }

  window.zrStatsPeriod = k => { period = k; if(k === 'custom' && !customFrom){ customFrom = dayKey(Date.now() - 6 * DAY); customTo = dayKey(Date.now()); } render(); };
  window.zrStatsTab = (btn, id) => {
    btn.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    ['st-top-c', 'st-top-m'].forEach(x => { const el = document.getElementById(x); if(el) el.style.display = x === id ? '' : 'none'; });
  };
  window.zrStatsOpen = id => { if(typeof showOrderDetail === 'function') showOrderDetail(id); };

  /* ---------- Export (CSV lisible par Excel) ---------- */
  window.zrStatsExport = () => {
    const S = lastS || compute();
    const rows = [];
    const R = S.R;
    rows.push(['Statistiques A&A VÊTEMENTS', R.from.toLocaleDateString('fr-FR') + ' → ' + new Date(R.to - 1).toLocaleDateString('fr-FR')]);
    rows.push([]);
    rows.push(['Chiffre d\'affaires', Math.round(S.ca)], ['Commandes', S.cur.length], ['Bénéfice (articles)', Math.round(S.profit)],
      [], ['Ventes livrées', Math.round(S.pf.sales)], ['Prix d\'achat', -Math.round(S.pf.cost)], ['Livraison ZR', -Math.round(S.pf.deliv)], ['Retours ZR', -Math.round(S.pf.ret)],
      ['Sponsor (€)', Math.round(S.pf.spEur * 100) / 100], ['Sponsor (DA)', -Math.round(S.pf.spDa)], ['BÉNÉFICE RÉEL', Math.round(S.pf.net)], [], ['Livrées', S.delivered.length], ['Retours', S.returned.length],
      ['Argent chez ZR', Math.round(S.atZrMoney)]);
    rows.push([], ['Wilaya', 'Commandes', 'CA', 'Livrées', 'Retours']);
    Object.entries(S.wil).sort((a, b) => b[1].ca - a[1].ca).forEach(([w, x]) => rows.push([w, x.n, Math.round(x.ca), x.d, x.r]));
    rows.push([], ['Article', 'Pièces vendues', 'CA']);
    Object.values(S.top).sort((a, b) => b.v - a.v).forEach(t => rows.push([t.label, t.v, Math.round(t.ca)]));
    rows.push([], ['Employé', 'Commandes', 'CA', 'Livrées', 'Retours']);
    Object.entries(S.team).forEach(([k, t]) => rows.push([k, t.n, Math.round(t.ca), t.d, t.r]));
    rows.push([], ['Liste noire', 'Téléphone', 'Retours', 'Livrées']);
    S.black.forEach(c => rows.push([c.name, c.phone, c.r, c.d]));
    const name = 'statistiques_' + dayKey(Date.now()) + '.csv';
    if(typeof downloadCsv === 'function') downloadCsv(name, rows);
    else {
      const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv'})); a.download = name; a.click();
    }
  };

  /* ---------- Liste noire : avertissement dans le formulaire de commande ---------- */
  function blackInfo(phone){
    const k = phoneKey(phone);
    if(k.length < 9) return null;
    const list = allOrders().filter(o => phoneKey(o.customer && o.customer.phone) === k);
    const r = list.filter(isReturned).length;
    if(!r) return null;
    return {r, d: list.filter(isDelivered).length, n: list.length};
  }
  function bindBlacklist(id){
    const inp = document.getElementById(id);
    if(!inp || inp._bl) return;
    inp._bl = true;
    const box = document.createElement('div');
    box.className = 'st-black-alert'; box.style.display = 'none';
    inp.insertAdjacentElement('afterend', box);
    const check = () => {
      const b = blackInfo(inp.value);
      if(!b){ box.style.display = 'none'; return; }
      box.innerHTML = `⛔ <b>Attention : cette cliente a déjà retourné ${b.r} colis</b> (${b.d} livré${b.d > 1 ? 's' : ''} sur ${b.n} commande${b.n > 1 ? 's' : ''}). Confirmez bien avec elle avant d'envoyer.`;
      box.style.display = 'block';
    };
    ['input', 'change', 'blur'].forEach(ev => inp.addEventListener(ev, check));
    setInterval(() => { if(inp.offsetParent && inp.value !== inp._lastV){ inp._lastV = inp.value; check(); } }, 800);   // numéro collé / rempli par l'analyse du texte
  }

  /* ---------- Résumé du soir (admin) ---------- */
  function eveningSummary(){
    try{
      if(typeof currentUser === 'undefined' || !currentUser || currentUser.role !== 'admin') return;
      const now = new Date(); if(now.getHours() * 60 + now.getMinutes() < 30) return;
      const key = 'stEvening-' + dayKey(now);
      if(localStorage.getItem(key)) return;
      if(typeof notifPrefEnabled === 'function' && !notifPrefEnabled()) return;
      const today = allOrders().filter(o => dayKey(o.createdAt) === dayKey(now));
      const ca = today.reduce((t, o) => t + (Number(o.total) || 0), 0);
      const ret = allOrders().filter(o => isReturned(o) && Z(o).finalAt && dayKey(Z(o).finalAt) === dayKey(now)).length;
      const del = allOrders().filter(o => isDelivered(o) && Z(o).finalAt && dayKey(Z(o).finalAt) === dayKey(now)).length;
      localStorage.setItem(key, '1');
      const body = `${today.length} commande(s) · ${money(ca)} · ${del} livrée(s) · ${ret} retour(s)`;
      if('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker){
        navigator.serviceWorker.ready.then(reg => reg.showNotification('📊 Résumé du jour', {body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'evening-' + dayKey(now)})).catch(() => {});
      }else if(typeof toast === 'function') toast('📊 Aujourd\'hui : ' + body);
    }catch(e){}
  }

  /* ---------- 📣 Rappel à 00:30 : sponsor de la veille pas saisi ---------- */
  function sponsorReminder(){
    try{
      if(typeof currentUser === 'undefined' || !currentUser || currentUser.role !== 'admin') return;
      const now = new Date(); if(now.getHours() * 60 + now.getMinutes() < 30) return;
      subSponsor();
      if(!spSub || !spLoaded) return;
      const day = dayKey(now.getTime() - DAY);                  // la journée qui vient de finir
      if(SP.days && SP.days[day]) return;                       // déjà saisi (même 0)
      let snooze = 0; try{ snooze = Number(localStorage.getItem('spRemind-' + day) || 0); }catch(e){}
      if(snooze > Date.now() || document.getElementById('spRemind')) return;
      const m = document.createElement('div'); m.id = 'spRemind';
      m.innerHTML = `<div class="spr-card"><h3>📣 Sponsor d'hier</h3><p>Combien as-tu dépensé en sponsor hier (${new Date(day + 'T00:00:00').toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long'})}) ? (en €)</p>
        <input type="text" inputmode="decimal" id="spr-eur" placeholder="Montant en €">
        <button class="spr-ok" id="spr-ok">Enregistrer</button>
        <button class="spr-none" id="spr-none">Pas de sponsor hier</button>
        <button class="spr-later" id="spr-later">Me le rappeler dans 1 h</button></div>`;
      document.body.appendChild(m);
      const close = () => m.remove();
      const save = async eur => {
        try{
          const rate = await eurUsd(day);
          await db.collection('meta').doc('sponsor').set({lastRate: rate, days: {[day]: {eur, rate, at: new Date().toISOString(), by: currentUser.name || ''}}}, {merge: true});
          toast(eur ? `📣 ${eur} € → ${money(Math.round(eur * rate * SP.usdt))} enregistré` : '📣 Noté : pas de sponsor hier');
          close();
        }catch(e){ toast('Échec : ' + (e.message || e), true); }
      };
      m.querySelector('#spr-ok').onclick = () => { const v = Number(String(m.querySelector('#spr-eur').value).replace(',', '.')); if(!(v > 0)){ toast('Écrivez le montant en €', true); return; } save(v); };
      m.querySelector('#spr-none').onclick = () => save(0);
      m.querySelector('#spr-later').onclick = () => { try{ localStorage.setItem('spRemind-' + day, String(Date.now() + 3600e3)); }catch(e){} close(); };
      if(document.hidden && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker){
        navigator.serviceWorker.ready.then(reg => reg.showNotification('📣 Sponsor d\'hier', {body: 'Écris combien tu as dépensé en sponsor hier', icon: 'icon-192.png', tag: 'sponsor-' + day})).catch(() => {});
      }
    }catch(e){}
  }

  /* ---------- 🗄️ Sauvegarde : état + clé ---------- */
  let bkInfo = null;
  async function loadBackup(){
    try{ const d = await db.collection('meta').doc('backup').get(); bkInfo = d.exists ? d.data() : null; }catch(e){ bkInfo = null; }
    const el = document.getElementById('st-backup'); if(el) el.innerHTML = backupHtml();
  }
  function backupHtml(){
    if(!bkInfo || !bkInfo.last) return '<div class="st-empty">Première sauvegarde cette nuit.</div>';
    const l = bkInfo.last; let c = {}; try{ c = JSON.parse(l.counts || '{}'); }catch(e){}
    const old = Date.now() - Date.parse(l.at) > 2 * 86400e3;
    return `<div class="${old ? 'st-warn' : 'pf-pend'}">${old ? '⚠️' : '✅'} Dernière sauvegarde : <b>${new Date(l.at).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})}</b><br>
      ${c.products || 0} produits · ${c.orders || 0} commandes · ${c.customers || 0} clientes (+ photos) — gardées 14 jours, chiffrées.</div>
      <button class="st-more" style="margin-top:8px" onclick="var k=this.nextElementSibling;k.style.display=k.style.display==='none'?'block':'none'">🔑 Afficher la clé de sauvegarde</button>
      <div style="display:none" class="bk-key"><code>${esc(bkInfo.key || '')}</code><div class="st-hint" style="margin:6px 0 0">Gardez cette clé (capture d'écran ou note) : elle sert à récupérer vos données si un jour il y a un problème.</div></div>`;
  }

  /* ---------- Rafraîchissement ---------- */
  let t = null;
  function maybeRender(){
    const v = document.getElementById('view-statistiques');
    if(v && v.classList.contains('active')){ clearTimeout(t); t = setTimeout(render, 400); }
  }
  window.renderStatsPage = function(){ render(); if(!bkInfo) loadBackup(); };
  window.statsOnData = maybeRender;
  function init(){
    css();
    bindBlacklist('o-phone'); bindBlacklist('eo-phone');
    setInterval(eveningSummary, 5 * 60 * 1000); setTimeout(eveningSummary, 20000);
    setInterval(sponsorReminder, 5 * 60 * 1000); setTimeout(sponsorReminder, 15000);
    document.addEventListener('visibilitychange', () => { if(!document.hidden) setTimeout(sponsorReminder, 2000); });
    let last = '';
    setInterval(() => {   // données changées (nouvelle commande, suivi ZR…) pendant que la page est ouverte
      const sig = allOrders().length + '|' + allOrders().reduce((t, o) => t + ((o.zr && o.zr.updatedAt) || ''), '').length + '|' + allProducts().length;
      if(sig !== last){ last = sig; maybeRender(); }
    }, 3000);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  /* ---------- Styles ---------- */
  function css(){
    if(document.getElementById('st-css')) return;
    const s = document.createElement('style'); s.id = 'st-css';
    s.textContent = `
      #statsPage{max-width:100%;min-width:0;overflow-x:hidden;box-sizing:border-box;--st-cur:#7a3d63;--st-prev:#b8a6b0;--st-ok:#1f8a4c;--st-mid:#c9891a;--st-bad:#c0392b;padding-bottom:40px;}
      html[data-theme="dark"] #statsPage{--st-cur:#d98fbd;--st-prev:#6f6168;--st-ok:#3ecf8e;--st-mid:#e9b04a;--st-bad:#ff7b6b;}
      .st-periods{display:flex;gap:8px;overflow-x:auto;padding:2px 0 8px;scrollbar-width:none;}
      .st-periods::-webkit-scrollbar{display:none;}
      .st-periods .chip{flex-shrink:0;}
      .st-custom{gap:10px;margin:4px 0 8px;flex-wrap:wrap;}
      .st-custom label{display:flex;flex-direction:column;font-size:12px;color:var(--mauve-dark);gap:4px;flex:1;}
      .st-custom input{padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;font:inherit;}
      .st-range{font-size:12px;color:var(--mauve-dark);margin:2px 0 6px;overflow-wrap:anywhere;}
      .st-range span{opacity:.8;}
      .st-sec{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin-top:14px;}
      .st-sec h3{margin:0 0 10px;font-size:16px;}
      .st-sec h4{margin:16px 0 8px;font-size:13px;color:var(--mauve-dark);font-weight:700;}
      .st-hint{font-size:12px;color:var(--mauve-dark);margin:-4px 0 10px;line-height:1.45;}
      .st-tw + .st-hint, .st-empty + .st-hint{margin:10px 0 0;}
      .st-more{border:1px dashed var(--line);background:transparent;color:inherit;border-radius:12px;padding:10px;font:inherit;font-size:13px;cursor:pointer;}
      .st-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
      .st-sec,.st-tile,.st-hb-main,.st-chart{min-width:0;box-sizing:border-box;}
      #view-statistiques{min-width:0;max-width:100%;}
      .app > .main-content{min-width:0;max-width:100%;flex:1 1 0%;}
      .st-tile{border:1px solid var(--line);border-radius:12px;padding:11px 12px;min-width:0;}
      .st-tile.wide{grid-column:1/-1;}
      .st-tile.good{border-color:color-mix(in srgb,var(--st-ok) 45%,transparent);}
      .st-tile.bad{border-color:color-mix(in srgb,var(--st-bad) 45%,transparent);}
      .st-l{font-size:11.5px;color:var(--mauve-dark);}
      .st-v{font-size:clamp(16px,5vw,20px);font-weight:800;color:var(--plum);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      html[data-theme="dark"] .st-v{color:inherit;}
      .st-s{font-size:11px;color:var(--mauve-dark);margin-top:3px;}
      .st-delta{font-size:11.5px;font-weight:700;color:var(--mauve-dark);}
      .st-delta.up{color:var(--st-ok);} .st-delta.down{color:var(--st-bad);}
      .st-warn{margin-top:10px;font-size:12.5px;line-height:1.45;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--st-mid) 14%,transparent);}
      .st-chart{position:relative;}
      .st-chart svg{width:100%;height:170px;display:block;touch-action:pan-y;}
      .st-axis{stroke:var(--line);stroke-width:1;} .st-gl{stroke:var(--line);stroke-width:1;stroke-dasharray:3 4;}
      .st-cur{fill:none;stroke:var(--st-cur);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round;}
      .st-prev{fill:none;stroke:var(--st-prev);stroke-width:2;stroke-dasharray:5 5;vector-effect:non-scaling-stroke;}
      .st-cross{stroke:var(--mauve-dark);stroke-width:1;vector-effect:non-scaling-stroke;}
      .st-dot{fill:var(--st-cur);stroke:var(--card);stroke-width:2;}
      .st-tick{font-size:9px;fill:var(--mauve-dark);}
      .st-tip{position:absolute;top:0;background:var(--plum);color:#fff;font-size:12px;line-height:1.4;padding:7px 10px;border-radius:10px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.2);}
      .st-tip span{opacity:.75;}
      .st-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11.5px;color:var(--mauve-dark);margin-top:8px;align-items:center;}
      .st-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px;}
      .st-legend i.cur{background:var(--st-cur);} .st-legend i.prev{background:var(--st-prev);}
      .st-legend i.ok{background:var(--st-ok);} .st-legend i.mid{background:var(--st-mid);} .st-legend i.bad{background:var(--st-bad);}
      .st-max{margin-left:auto;}
      .st-stack{display:flex;gap:2px;height:14px;border-radius:7px;overflow:hidden;margin-top:12px;background:var(--line);}
      .st-stack div{height:100%;} .st-stack .ok{background:var(--st-ok);} .st-stack .mid{background:var(--st-mid);} .st-stack .bad{background:var(--st-bad);}
      .st-tw{overflow-x:auto;margin:0 -4px;}
      .st-t{width:100%;border-collapse:collapse;font-size:12.5px;}
      .st-t th{text-align:left;font-weight:700;color:var(--mauve-dark);font-size:11px;padding:6px 4px;border-bottom:1px solid var(--line);white-space:nowrap;}
      .st-t td{padding:8px 4px;border-bottom:1px solid var(--line);vertical-align:top;}
      .st-t td small{color:var(--mauve-dark);}
      .st-t tr:last-child td{border-bottom:none;}
      .bad-t{color:var(--st-bad);}
      .st-hb{display:flex;flex-direction:column;gap:10px;}
      .st-hb-row{display:flex;gap:10px;align-items:center;}
      .st-hb-row img{width:40px;height:40px;border-radius:10px;object-fit:cover;flex-shrink:0;background:var(--rose);}
      .st-hb-main{flex:1;min-width:0;}
      .st-hb-top{display:flex;justify-content:space-between;gap:8px;font-size:13px;}
      .st-hb-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .st-hb-val{font-weight:700;white-space:nowrap;}
      .st-hb-val small{font-weight:500;color:var(--mauve-dark);}
      .st-hb-track{height:8px;border-radius:4px;background:color-mix(in srgb,var(--line) 70%,transparent);margin-top:5px;overflow:hidden;}
      .st-hb-fill{height:100%;border-radius:4px;background:var(--st-cur);}
      .st-hb-fill.warn{background:var(--st-mid);} .st-hb-fill.muted{background:var(--st-prev);}
      .st-empty{font-size:13px;color:var(--mauve-dark);padding:8px 0;}
      .st-empty.ok{color:var(--st-ok);font-weight:600;}
      .st-tabs{display:flex;gap:6px;margin-bottom:12px;}
      .st-tabs button{border:1px solid var(--line);background:transparent;color:inherit;border-radius:999px;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer;}
      .st-tabs button.on{background:var(--plum);color:#fff;border-color:var(--plum);}
      .st-watch{display:flex;flex-direction:column;gap:8px;}
      .st-w{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);border-left:4px solid var(--st-prev);font-size:13px;cursor:pointer;}
      .st-w span{color:var(--mauve-dark);font-size:12px;}
      .st-w.lvl3{border-left-color:var(--st-bad);} .st-w.lvl2{border-left-color:var(--st-mid);}
      .st-w-r{text-align:right;font-weight:700;white-space:nowrap;} .st-w-r small{font-weight:500;color:var(--mauve-dark);}
      .st-best{font-size:13.5px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--st-cur) 10%,transparent);}
      .st-vb{display:flex;gap:3px;align-items:flex-end;height:120px;}
      .st-vb-c{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;}
      .st-vb-b{width:100%;max-width:26px;background:var(--st-cur);border-radius:4px 4px 0 0;}
      .st-vb-v{font-size:9.5px;color:var(--mauve-dark);margin-bottom:2px;height:12px;line-height:12px;}
      .st-vb-l{font-size:9.5px;color:var(--mauve-dark);margin-top:4px;height:12px;line-height:12px;white-space:nowrap;flex-shrink:0;}
      .st-vb-b{flex-shrink:1;}
      .pf-big{border-radius:14px;padding:14px;background:color-mix(in srgb,var(--st-ok) 13%,transparent);text-align:center;}
      .pf-big.neg{background:color-mix(in srgb,var(--st-bad) 13%,transparent);}
      .pf-big-l{font-size:12.5px;color:var(--mauve-dark);}
      .pf-big-v{font-size:clamp(26px,8vw,34px);font-weight:900;color:var(--st-ok);margin-top:2px;}
      .pf-big.neg .pf-big-v{color:var(--st-bad);}
      .pf-lines{margin-top:10px;}
      .pf-l{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--line);font-size:13.5px;}
      .pf-l span{min-width:0;} .pf-l small{display:block;font-size:11px;color:var(--mauve-dark);margin-left:22px;}
      .pf-l b{white-space:nowrap;} .pf-l b.neg{color:var(--st-bad);} .pf-l b.pos{color:var(--st-ok);}
      .pf-tot{border-bottom:none;font-size:15px;font-weight:800;}
      .pf-pend{margin-top:10px;font-size:12.5px;line-height:1.45;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--st-cur) 9%,transparent);}
      .pf-sp{display:flex;gap:6px;flex-wrap:wrap;}
      .pf-sp input{flex:1;min-width:0;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;font:inherit;font-size:14px;}
      .pf-sp input[type=date]{flex:1 1 140px;} .pf-sp #pf-eur{flex:1 1 100px;}
      .pf-sp button,.pf-set button{border:none;border-radius:10px;padding:10px 14px;background:var(--plum);color:#fff;font:inherit;font-weight:700;cursor:pointer;}
      .pf-days{margin-top:10px;display:flex;flex-direction:column;gap:4px;}
      .pf-day{display:grid;grid-template-columns:1fr auto auto 20px;gap:10px;align-items:center;font-size:13px;padding:7px 10px;border-radius:10px;background:color-mix(in srgb,var(--line) 35%,transparent);cursor:pointer;}
      .pf-day i{font-style:normal;font-size:12px;opacity:.6;}
      .pf-set{margin-top:12px;font-size:13px;} .pf-set summary{cursor:pointer;color:var(--mauve-dark);font-weight:700;padding:4px 0;}
      .pf-set label{display:flex;flex-direction:column;gap:4px;margin:10px 0;font-size:12.5px;color:var(--mauve-dark);}
      .pf-set input{padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;font:inherit;font-size:14px;}
      .st-warn.nc summary{cursor:pointer;list-style:none;} .st-warn.nc summary::-webkit-details-marker{display:none;}
      .nc-r{display:flex;align-items:center;gap:8px;margin-top:8px;background:var(--card);border-radius:10px;padding:6px;}
      .nc-r img{width:42px;height:42px;border-radius:8px;object-fit:cover;flex-shrink:0;background:var(--rose);cursor:pointer;}
      .nc-n{flex:1;min-width:0;cursor:pointer;} .nc-n b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} .nc-n small{font-size:11px;color:var(--mauve-dark);}
      .nc-r input{width:84px;padding:8px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:inherit;font:inherit;font-size:14px;}
      .nc-r button{border:none;border-radius:9px;padding:8px 12px;background:var(--plum);color:#fff;font-weight:800;cursor:pointer;}
      #spRemind{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10040;display:flex;align-items:flex-end;justify-content:center;}
      #spRemind .spr-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;}
      #spRemind h3{margin:0 0 6px;} #spRemind p{margin:0 0 10px;font-size:14px;}
      #spRemind input{width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--line,#ddd);border-radius:12px;font:inherit;font-size:16px;background:var(--card,#fff);color:inherit;}
      #spRemind button{display:block;width:100%;border:none;border-radius:12px;padding:13px;font:inherit;font-weight:800;margin-top:8px;cursor:pointer;}
      .spr-ok{background:var(--plum,#3b2433);color:#fff;} .spr-none{background:#dcf3e6;color:#1f7a4a;} .spr-later{background:transparent;color:var(--mauve-dark,#7a5a6a);}
      .bk-key code{display:block;margin-top:8px;padding:10px;border-radius:10px;background:color-mix(in srgb,var(--line) 40%,transparent);font-size:13px;word-break:break-all;user-select:all;}
      .st-export{margin-top:18px;}
      .st-export .btn-primary{width:100%;}
      .st-black-alert{margin-top:8px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.45;background:#fde8e6;color:#8f2418;border:1px solid #f3b8b0;}
      html[data-theme="dark"] .st-black-alert{background:#3a1d1a;color:#ffb4a8;border-color:#6b2c25;}
    `;
    document.head.appendChild(s);
  }
})();
