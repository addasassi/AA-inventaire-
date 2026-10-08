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
  const stageOf = o => (o.zr && o.zr.stage) || '';
  const isDelivered = o => stageOf(o) === 'delivered';
  const isReturned = o => stageOf(o) === 'returned';
  const wilayaOf = o => (o.customer && o.customer.wilaya) || '—';

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
  function lineChart(R, cur, prev){
    const byHour = R.days <= 1;
    const n = byHour ? 24 : R.days;
    const bucket = (list, start) => {
      const arr = new Array(n).fill(0);
      list.forEach(o => {
        const t = Date.parse(o.createdAt);
        const i = byHour ? new Date(t).getHours() : Math.floor((dayStart(t) - start) / DAY);
        if(i >= 0 && i < n) arr[i] += Number(o.total) || 0;
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
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chiffre d'affaires ${byHour ? 'par heure' : 'par jour'}">
        <line x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}" class="st-axis"/>
        <line x1="${L}" x2="${W - Rr}" y1="${y(max / 2)}" y2="${y(max / 2)}" class="st-gl"/>
        ${b ? `<path d="${path(b)}" class="st-prev"/>` : ''}
        <path d="${path(a)}" class="st-cur"/>
        ${ticks.map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="st-tick">${esc(labels[i])}</text>`).join('')}
        <line id="st-cross" x1="0" x2="0" y1="${T}" y2="${y(0)}" class="st-cross" style="display:none"/>
        <circle id="st-dot" r="4" class="st-dot" style="display:none"/>
      </svg>
      <div class="st-tip" id="st-tip" style="display:none"></div>
      <div class="st-legend"><span><i class="cur"></i>Cette période</span>${b ? '<span><i class="prev"></i>Période précédente</span>' : ''}<span class="st-max">max ${money(max)}</span></div>
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
      tip.innerHTML = `<b>${esc(labels[i])}</b><br>${money(a[i])}${b ? `<br><span>avant : ${money(b[i])}</span>` : ''}`;
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
    const fees = sum(delivered, o => o.zr.deliveryPrice) + sum(returned, o => o.zr.returnPrice);
    const net = sum(delivered, o => o.profit != null ? o.profit : o.total) - fees;
    const atZr = ALL.filter(o => isDelivered(o) && o.zr.finalAt && !o.zr.paid);   // suivi de l'encaissement depuis la v8 du relais
    const atZrMoney = sum(atZr, o => (Number(o.total) || 0) - (Number(o.zr.deliveryPrice) || 0));
    const noCost = P.filter(p => !(Number(p.cost) > 0)).length;

    // livraison par wilaya + type + délai
    const wil = {};
    cur.forEach(o => {
      const w = wilayaOf(o); const x = wil[w] || (wil[w] = {n: 0, ca: 0, d: 0, r: 0, days: [], fee: 0});
      x.n++; x.ca += Number(o.total) || 0;
      if(isDelivered(o)){ x.d++; if(o.zr.sentAt && o.zr.finalAt) x.days.push((Date.parse(o.zr.finalAt) - Date.parse(o.zr.sentAt)) / DAY); }
      if(isReturned(o)) x.r++;
    });
    const types = {domicile: {n: 0, d: 0, r: 0}, stopdesk: {n: 0, d: 0, r: 0}};
    cur.forEach(o => { const t = types[(o.customer && o.customer.deliveryType) === 'stopdesk' ? 'stopdesk' : 'domicile']; t.n++; if(isDelivered(o)) t.d++; if(isReturned(o)) t.r++; });
    const allDays = [].concat(...Object.values(wil).map(x => x.days));
    const avgDays = allDays.length ? allDays.reduce((a, b) => a + b, 0) / allDays.length : 0;
    const nrp = cur.filter(o => o.zr && (Number(o.zr.nrp) > 0 || /r[eé]pond pas/i.test(o.zr.situation || '')));

    // commandes à surveiller (toutes périodes)
    const now = Date.now(), todayIso = dayKey(now);
    const watch = [];
    ALL.forEach(o => {
      const z = o.zr || {};
      if(isDelivered(o) || isReturned(o)) return;
      const age = (now - Date.parse(o.createdAt)) / DAY;
      if(z.status === 'error') watch.push({o, why: '❌ Erreur ZR : ' + (z.error || ''), lvl: 3});
      else if(o.deferred && o.deferredDate && o.deferredDate <= todayIso && !z.parcelId) watch.push({o, why: '🕓 Reportée — à envoyer (' + new Date(o.deferredDate + 'T00:00:00').toLocaleDateString('fr-FR') + ')', lvl: 2});
      else if(o.zr && !z.parcelId && !o.deferred && age > 1 / 24) watch.push({o, why: '📦 Pas encore envoyée à ZR', lvl: 2});
      else if(z.situation) watch.push({o, why: '📞 ' + z.situation, lvl: 2});
      else if(z.sentAt && (now - Date.parse(z.sentAt)) / DAY > 5) watch.push({o, why: '🐢 En route depuis ' + Math.floor((now - Date.parse(z.sentAt)) / DAY) + ' jours', lvl: 1});
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
      const c = (p && p.cat) || 'Autre'; cats[c] = (cats[c] || 0) + v;
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

    return {R, cur, prev, ca, caP, profit, profitP, delivered, returned, inProgress, fees, net, atZr, atZrMoney, noCost,
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
    const wilRows = Object.entries(S.wil).sort((a, b) => b[1].ca - a[1].ca);
    const tops = Object.values(S.top).sort((a, b) => b.v - a.v).slice(0, 10);
    const topModels = Object.values(S.topModel).sort((a, b) => b.v - a.v).slice(0, 10);
    const orderClick = id => `zrStatsOpen('${id}')`;
    const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const bestH = S.hours.indexOf(Math.max(...S.hours)), bestD = S.wdays.indexOf(Math.max(...S.wdays));

    root.innerHTML = `
      <div class="st-periods">${PERIODS.map(([k, l]) => `<button class="chip${period === k ? ' active' : ''}" onclick="zrStatsPeriod('${k}')">${l}</button>`).join('')}</div>
      <div class="st-custom" style="display:${period === 'custom' ? 'flex' : 'none'}">
        <label>Du <input type="date" id="st-from" value="${customFrom}"></label><label>Au <input type="date" id="st-to" value="${customTo}"></label>
      </div>
      <div class="st-range">${S.R.from.toLocaleDateString('fr-FR')} → ${new Date(S.R.to - 1).toLocaleDateString('fr-FR')}${S.historyDays < 30 ? ` · <span>historique : ${S.historyDays + 1} jour(s) de commandes</span>` : ''}</div>

      ${section('💰 Chiffres clés', `<div class="st-grid">
        ${tile("Chiffre d'affaires", money(S.ca), delta(S.ca, S.caP))}
        ${tile('Commandes', num(n), delta(n, nP))}
        ${tile('Bénéfice (articles)', money(S.profit), delta(S.profit, S.profitP))}
        ${tile('Panier moyen', money(n ? S.ca / n : 0), nP ? 'avant : ' + money(S.caP / nP) : '')}
        ${tile('Bénéfice net estimé', money(S.net), 'livrées − frais ZR (' + money(S.fees) + ')', 'wide')}
      </div>${S.noCost ? `<div class="st-warn">⚠️ ${S.noCost} produit(s) sans <b>coût d'achat</b> : leur bénéfice est compté comme le prix de vente. Ajoutez le coût dans la fiche produit pour un bénéfice juste.</div>` : ''}`)}

      ${section('📈 Ventes ' + (S.R.days <= 1 ? 'heure par heure' : 'jour par jour'), lineChart(S.R, S.cur, S.prev), 'Touchez la courbe pour voir le détail.')}

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
        ${table(['Type', 'Commandes', 'Livrées', 'Retours', 'Taux'], [['🏠 Domicile', S.types.domicile], ['🏢 Stop desk', S.types.stopdesk]].map(([l, t]) => ({cells: [l, t.n, t.d, t.r, t.d + t.r ? pct(t.d, t.d + t.r) : '—']})))}
        <h4>Par wilaya</h4>
        ${table(['Wilaya', 'Cmd', 'Livrées', 'Retours', 'Taux', 'Délai'], wilRows.map(([w, x]) => ({cells: [esc(w), x.n, x.d, x.r ? `<b class="bad-t">${x.r}</b>` : 0, x.d + x.r ? pct(x.d, x.d + x.r) : '—', x.days.length ? (x.days.reduce((a, b) => a + b, 0) / x.days.length).toFixed(1).replace('.', ',') + ' j' : '—']})))}
      `)}

      ${section('⏳ À surveiller (' + S.watch.length + ')', S.watch.length ? '<div class="st-watch">' + S.watch.slice(0, 60).map((w, i) => `<div class="st-w lvl${w.lvl}"${i >= 12 ? ' data-more style="display:none"' : ''} onclick="${orderClick(w.o.id)}">
          <div><b>${esc((w.o.customer && w.o.customer.name) || 'Client')}</b> · ${esc(wilayaOf(w.o))}<br><span>${esc(w.why)}</span></div>
          <div class="st-w-r">${money(w.o.total)}<br><small>${new Date(w.o.createdAt).toLocaleDateString('fr-FR')}</small></div></div>`).join('')
          + (S.watch.length > 12 ? `<button class="st-more" onclick="this.parentNode.querySelectorAll('[data-more]').forEach(e=>e.style.display='');this.remove()">Voir tout (${Math.min(60, S.watch.length)})</button>` : '') + '</div>'
        : '<div class="st-empty ok">✅ Rien à signaler</div>', 'Toutes périodes : erreurs ZR, commandes pas envoyées, reportées arrivées à échéance, « Ne répond pas », colis en route depuis plus de 5 jours.')}

      ${section('👗 Les plus vendus', `
        <div class="st-tabs"><button class="on" onclick="zrStatsTab(this,'st-top-c')">Par couleur</button><button onclick="zrStatsTab(this,'st-top-m')">Par modèle</button></div>
        <div id="st-top-c">${hbars(tops.map(t => ({label: t.label, v: t.v, img: t.img, note: money(t.ca)})), v => v + ' pcs')}</div>
        <div id="st-top-m" style="display:none">${hbars(topModels.map(t => ({label: t.label, v: t.v, img: t.img, note: money(t.ca)})), v => v + ' pcs')}</div>
        <h4>Ventes par catégorie</h4>
        ${hbars(Object.entries(S.cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({label: c, v, note: pct(v, S.ca)})), money)}
      `)}

      ${section('🔁 À racheter bientôt', S.reorder.length ? hbars(S.reorder.map(x => ({label: x.name, v: x.s, img: x.img, note: x.qty <= 0 ? '— <b class="bad-t">rupture</b>' : `— reste ${x.qty}, ≈ ${Math.max(1, Math.round(x.left))} j`})), v => v + ' vendus/14 j', {cls: 'warn'}) : '<div class="st-empty ok">✅ Aucun article ne va manquer cette semaine</div>', 'Pièces vendues au moins 2 fois en 14 jours dont le stock tiendra moins d\'une semaine à ce rythme.')}

      ${section('😴 Modèles qui dorment', S.dormant.length ? hbars(S.dormant, v => v + ' en stock', {cls: 'muted'}) : '<div class="st-empty ok">✅ Tout se vend</div>', 'En stock mais aucune vente depuis 30 jours — pensez à une promo ou une nouvelle photo.' + (S.historyDays < 30 ? ' (Historique de commandes encore court : liste plus fiable dans quelques semaines.)' : ''))}

      ${section('📦 Valeur du stock', `<div class="st-grid">
        ${tile('Pièces en stock', num(S.stockN))}
        ${tile('Au prix de vente', money(S.stockPrice))}
        ${tile("Au coût d'achat", money(S.stockCost), S.noCost ? S.noCost + ' produit(s) sans coût' : '', 'wide')}
      </div>`)}

      ${section('🗺️ Wilayas', hbars(wilRows.slice(0, 15).map(([w, x]) => ({label: w, v: x.ca, note: x.n + ' cmd'})), money))}

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

      ${section('👩‍💼 Équipe', table(['Employé', 'Cmd', 'CA', 'Livrées', 'Retours', 'Taux'], Object.entries(S.team).sort((a, b) => b[1].ca - a[1].ca).map(([k, t]) => ({cells: [esc(k), t.n, money(t.ca), t.d, t.r, t.d + t.r ? pct(t.d, t.d + t.r) : '—']}))), 'Un taux de livraison bas pour un employé = commandes mal confirmées avec la cliente.')}

      ${section('⏰ Quand vend-on le plus ?', `
        ${n ? `<div class="st-best">Meilleur moment : <b>${WD[bestD]}</b> vers <b>${bestH}h</b> — publiez sur Facebook un peu avant.</div>` : ''}
        <h4>Par jour</h4>${vbars(S.wdays, WD)}
        <h4>Par heure</h4>${vbars(S.hours, S.hours.map((_, i) => i % 3 === 0 ? i + 'h' : ''))}
      `)}

      <div class="st-export"><button class="btn-primary" onclick="zrStatsExport()">⬇️ Exporter ces statistiques (Excel)</button></div>`;
    const f = document.getElementById('st-from'), t = document.getElementById('st-to');
    if(f) f.onchange = () => { customFrom = f.value; if(!customTo || customTo < customFrom) customTo = customFrom; render(); };
    if(t) t.onchange = () => { customTo = t.value; render(); };
    bindChart();
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
      ['Bénéfice net estimé', Math.round(S.net)], ['Frais ZR', Math.round(S.fees)], ['Livrées', S.delivered.length], ['Retours', S.returned.length],
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
      const now = new Date(); if(now.getHours() < 21) return;
      const key = 'stEvening-' + dayKey(now);
      if(localStorage.getItem(key)) return;
      if(typeof notifPrefEnabled === 'function' && !notifPrefEnabled()) return;
      const today = allOrders().filter(o => dayKey(o.createdAt) === dayKey(now));
      const ca = today.reduce((t, o) => t + (Number(o.total) || 0), 0);
      const ret = allOrders().filter(o => isReturned(o) && o.zr.finalAt && dayKey(o.zr.finalAt) === dayKey(now)).length;
      const del = allOrders().filter(o => isDelivered(o) && o.zr.finalAt && dayKey(o.zr.finalAt) === dayKey(now)).length;
      localStorage.setItem(key, '1');
      const body = `${today.length} commande(s) · ${money(ca)} · ${del} livrée(s) · ${ret} retour(s)`;
      if('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker){
        navigator.serviceWorker.ready.then(reg => reg.showNotification('📊 Résumé du jour', {body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'evening-' + dayKey(now)})).catch(() => {});
      }else if(typeof toast === 'function') toast('📊 Aujourd\'hui : ' + body);
    }catch(e){}
  }

  /* ---------- Rafraîchissement ---------- */
  let t = null;
  function maybeRender(){
    const v = document.getElementById('view-statistiques');
    if(v && v.classList.contains('active')){ clearTimeout(t); t = setTimeout(render, 400); }
  }
  window.renderStatsPage = render;
  window.statsOnData = maybeRender;
  function init(){
    css();
    bindBlacklist('o-phone'); bindBlacklist('eo-phone');
    setInterval(eveningSummary, 5 * 60 * 1000); setTimeout(eveningSummary, 20000);
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
      .st-export{margin-top:18px;}
      .st-export .btn-primary{width:100%;}
      .st-black-alert{margin-top:8px;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.45;background:#fde8e6;color:#8f2418;border:1px solid #f3b8b0;}
      html[data-theme="dark"] .st-black-alert{background:#3a1d1a;color:#ffb4a8;border-color:#6b2c25;}
    `;
    document.head.appendChild(s);
  }
})();
