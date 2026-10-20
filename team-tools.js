/* ============================================================
   👥 Outils équipe :
   - 📝 Note sur la commande (visible par tous)
   - 💬 Messages prêts à envoyer (copier / WhatsApp), remplis tout seuls
   - 💰 Commission par commande LIVRÉE (réglée par l'admin)
   - 🏆 Classement de l'équipe (admin)
   ============================================================ */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const all = () => (typeof orders !== 'undefined' ? orders : []);
  const me = () => (typeof currentUser !== 'undefined' && currentUser) || null;
  const isAdmin = () => !!(me() && me().role === 'admin');
  const byId = id => all().find(o => o.id === id);

  /* ---------- 💰 commission ---------- */
  let commission = {amount: 0};
  function listenCommission(){
    try{
      if(typeof db === 'undefined' || listenCommission.on) return;
      listenCommission.on = true;
      db.collection('meta').doc('commission').onSnapshot(d => {
        commission = (d && d.exists && d.data()) || {amount: 0};
        if(window.myOrdersRender) try{ window.myOrdersRender(); }catch(e){}
      }, () => {});
    }catch(e){}
  }
  const rateFor = name => { const p = commission.per && commission.per[name]; return Number(p != null && p !== '' ? p : commission.amount) || 0; };
  async function saveCommission(amount){
    commission.amount = Number(amount) || 0;
    try{ await db.collection('meta').doc('commission').set({amount: commission.amount, updated: new Date().toISOString()}, {merge: true}); toast('💰 Commission enregistrée'); }
    catch(e){ toast('Échec — réessayez', true); }
  }

  /* bloc ajouté dans « Mes commandes » (appelé par myorders.js) */
  function myOrdersExtra(ctx){
    listenCommission();
    const {list, by, who} = ctx;
    let html = '';
    if(who !== '*'){
      const r = rateFor(who);
      if(r > 0) html += `<div class="tt-com">💰 Commission : <b>${by.delivered.length}</b> livrée${by.delivered.length > 1 ? 's' : ''} × ${r} DA = <b>${(by.delivered.length * r).toLocaleString('fr-FR')} DA</b><small>Seulement les commandes livrées (pas les retours)</small></div>`;
    }
    if(isAdmin()){
      html += `<div class="tt-set">⚙️ Commission par commande livrée :
        <input type="number" id="tt-com-in" min="0" step="10" value="${Number(commission.amount) || ''}" placeholder="0" inputmode="numeric"> DA
        <button id="tt-com-save">OK</button></div>`;
      if(who === '*') html += ranking(list, ctx.stateOf);
    }
    return html;
  }
  function bindMyOrdersExtra(){
    const b = document.getElementById('tt-com-save');
    if(b) b.onclick = () => saveCommission(document.getElementById('tt-com-in').value);
  }

  /* ---------- 🏆 classement ---------- */
  function ranking(list, stateOf){
    const t = {};
    list.forEach(o => {
      const n = o.createdBy || '—';
      const r = t[n] || (t[n] = {n, add: 0, del: 0, ret: 0, todo: 0});
      r.add++;
      const s = stateOf(o);
      if(s === 'delivered') r.del++; else if(s === 'returned') r.ret++; else if(s === 'todo') r.todo++;
    });
    const rows = Object.values(t).sort((a, b) => b.del - a.del || b.add - a.add);
    if(!rows.length) return '';
    const medal = i => ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
    return `<div class="tt-rank"><div class="tt-rank-h">🏆 Classement de l'équipe</div>
      <div class="tt-row tt-head"><span>Employé</span><span>Ajout.</span><span>Livr.</span><span>Ret.</span><span>Taux</span></div>
      ${rows.map((r, i) => { const f = r.del + r.ret, rate = f ? Math.round(r.del * 100 / f) : null, c = rateFor(r.n);
        return `<div class="tt-row"><span>${medal(i)} ${esc(r.n)}${c > 0 && r.del ? `<small>💰 ${(r.del * c).toLocaleString('fr-FR')} DA</small>` : ''}${r.todo ? `<small class="w">⚠️ ${r.todo} à traiter</small>` : ''}</span><span>${r.add}</span><span class="g">${r.del}</span><span class="r">${r.ret}</span><span class="${rate == null ? '' : rate >= 75 ? 'g' : rate >= 55 ? 'o' : 'r'}">${rate == null ? '—' : rate + '%'}</span></div>`; }).join('')}
      <small class="tt-rank-n">Taux = livrées ÷ (livrées + retours). Période choisie en haut.</small></div>`;
  }

  /* ---------- 📝 note + 💬 messages dans le détail de la commande ---------- */
  function first(o){ return String((o.customer && o.customer.name) || '').trim().split(/\s+/)[0] || ''; }
  function items(o){ return (o.items || []).map(i => (Number(i.qty) > 1 ? i.qty + ' × ' : '') + i.name).join(' + '); }
  const TPL = [
    ['✅ Confirmer la commande', o => `السلام عليكم ${first(o)} 🌸 معاك كلش 100 ألف.\nطلبيتك: ${items(o)}\nالمجموع: ${Math.round(Number(o.total) || 0)} دج${o.customer && o.customer.wilaya ? ' — التوصيل لـ ' + o.customer.wilaya + (o.customer.commune ? ' (' + o.customer.commune + ')' : '') : ''}\nنأكدولك الطلبية؟ ردّي بـ "نعم" 💕`],
    ['📵 Elle ne répond pas (avant envoi)', o => `السلام عليكم ${first(o)} 🌸 عيطنالك باش نأكدو طلبيتك (${items(o)}) وما جاوبتيش.\nوقتاش نقدرو نعيطولك؟ 🙏`],
    ['🚚 Le colis est parti', o => `طلبيتك خرجت مع ZR Express 🚚${o.zr && o.zr.tracking ? '\nرقم التتبع: ' + o.zr.tracking : ''}\nالليفرور يعيطلك قريب، جاوبيه من فضلك 💕`],
    ['📞 Le livreur n\'arrive pas à la joindre', o => `السلام عليكم ${first(o)}، الليفرور تاع ZR عيطلك وما جاوبتيش 📵\nالكولي تاعك (${items(o)}) راهو عندو. جاوبيه من فضلك، ولا قوليلنا وقتاش تكوني متوفرة 🙏`],
    ['🏢 Colis arrivé au bureau (Stop desk)', o => `السلام عليكم ${first(o)} 📦 الكولي تاعك وصل لمكتب ZR Express${o.customer && o.customer.wilaya ? ' فـ ' + o.customer.wilaya : ''}.\nتقدري تروحي تديه${o.zr && o.zr.tracking ? '، رقم التتبع: ' + o.zr.tracking : ''} 💕`],
    ['💝 Merci après livraison', o => `شكراً ${first(o)} على ثقتك 💕 نتمناو السلعة عجبتك!\nكي تحبي موديلات جداد ابعثيلنا، ونستناو صورتك بيها 📸🌸`]
  ];
  function extra(o){
    const el = document.getElementById('od-extra'); if(!el || !o) return;
    el.innerHTML = `<div class="tt-box">
      <div class="tt-h">📝 Note</div>
      <textarea id="tt-note" rows="2" placeholder="Ex : rappeler après 17h · veut une autre couleur si épuisée">${esc(o.note || '')}</textarea>
      ${o.note && o.noteBy ? `<small class="tt-by">par ${esc(o.noteBy)}${o.noteAt ? ' · ' + new Date(o.noteAt).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'}) : ''}</small>` : ''}
      <button class="tt-save" id="tt-note-save">Enregistrer la note</button>
    </div>
    ${isAdmin() ? '' : `<div class="tt-box">
      <div class="tt-h">💬 Messages prêts</div>
      ${TPL.map((t, i) => `<div class="tt-msg"><span>${t[0]}</span><button data-c="${i}">📋</button>${o.customer && o.customer.phone ? `<button data-w="${i}" class="wa">WhatsApp</button>` : ''}</div>`).join('')}
    </div>`}`;   // 💬 messages prêts : seulement pour les employés
    el.querySelector('#tt-note-save').onclick = () => saveNote(o.id, el.querySelector('#tt-note').value);
    el.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
      const txt = TPL[b.dataset.c][1](o);
      try{ await navigator.clipboard.writeText(txt); toast('📋 Message copié — collez-le dans Messenger / WhatsApp'); }
      catch(e){ prompt('Copiez le message :', txt); }
    });
    el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
      const txt = TPL[b.dataset.w][1](o);
      const ph = typeof normalizePhoneForWhatsapp === 'function' ? normalizePhoneForWhatsapp(o.customer.phone) : String(o.customer.phone).replace(/\D/g, '');
      window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(txt), '_blank');
    });
  }
  async function saveNote(id, text){
    const o = byId(id); if(!o) return;
    const note = String(text || '').trim();
    const data = {note, noteBy: (me() && me().name) || '', noteAt: new Date().toISOString()};
    try{
      await db.collection('orders').doc(id).set(data, {merge: true});
      Object.assign(o, data);
      toast(note ? '📝 Note enregistrée' : 'Note supprimée');
      try{ if(typeof renderOrdersHistory === 'function') renderOrdersHistory(); }catch(e){}
      extra(o);
    }catch(e){ toast('Échec — réessayez', true); }
  }
  const noteLine = o => o && o.note ? `<div class="tt-note-line">📝 ${esc(o.note)}</div>` : '';

  window.teamMyOrdersExtra = myOrdersExtra;
  window.teamBindMyOrdersExtra = bindMyOrdersExtra;
  window.orderExtra = extra;
  window.orderNoteLine = noteLine;
  setTimeout(listenCommission, 3000);

  const st = document.createElement('style');
  st.textContent = `
    .tt-com{background:#fff7d6;border:1.5px solid #f5c400;color:#3b2a00;border-radius:12px;padding:9px 12px;margin-bottom:10px;font-size:14px;text-align:center;}
    .tt-com small{display:block;font-size:11px;opacity:.75;margin-top:2px;}
    .tt-set{display:flex;align-items:center;flex-wrap:wrap;gap:6px;background:var(--card,#fff);border:1px dashed var(--line);border-radius:12px;padding:8px 10px;margin-bottom:10px;font-size:13px;}
    .tt-set input{width:90px;padding:6px 8px;} .tt-set button{border:none;border-radius:8px;background:var(--plum);color:var(--cream);font-weight:700;padding:7px 12px;}
    .tt-rank{background:var(--card,#fff);border:1px solid var(--line);border-radius:14px;padding:10px;margin-bottom:12px;}
    .tt-rank-h{font-weight:800;color:var(--plum);margin-bottom:6px;}
    .tt-row{display:grid;grid-template-columns:2.4fr .8fr .8fr .8fr .9fr;gap:4px;align-items:center;padding:7px 2px;border-top:1px solid var(--line);font-size:13px;text-align:center;}
    .tt-row span:first-child{text-align:left;font-weight:700;} .tt-row small{display:block;font-weight:600;font-size:11px;opacity:.85;} .tt-row small.w{color:#c2410c;}
    .tt-head{border-top:none;font-size:11px;opacity:.7;font-weight:700;}
    .tt-row .g{color:#15803d;font-weight:800;} .tt-row .r{color:#b91c1c;font-weight:800;} .tt-row .o{color:#c2410c;font-weight:800;}
    .tt-rank-n{display:block;font-size:11px;opacity:.7;margin-top:6px;}
    .tt-box{border:1px solid var(--line);border-radius:12px;padding:10px;margin-top:10px;}
    .tt-h{font-weight:800;color:var(--plum);margin-bottom:6px;font-size:14px;}
    #tt-note{width:100%;box-sizing:border-box;font:inherit;font-size:14px;}
    .tt-by{display:block;font-size:11px;opacity:.7;margin-top:2px;}
    .tt-save{width:100%;margin-top:6px;border:none;border-radius:10px;background:var(--plum);color:var(--cream);font:inherit;font-weight:700;padding:8px;}
    .tt-msg{display:flex;align-items:center;gap:6px;padding:6px 0;border-top:1px solid var(--line);font-size:13px;}
    .tt-msg:first-of-type{border-top:none;} .tt-msg span{flex:1;}
    .tt-msg button{border:1px solid var(--line);background:var(--cream,#fff);border-radius:8px;padding:5px 9px;font:inherit;font-size:13px;}
    .tt-msg button.wa{background:#25d366;color:#fff;border-color:#25d366;font-weight:700;}
    .tt-note-line{background:#eef2ff;color:#312e81;border-radius:8px;padding:5px 8px;margin-top:6px;font-size:13px;}
  `;
  document.head.appendChild(st);
})();
