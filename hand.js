/* =====================================================================
   🤝 Remise en main propre prévue un autre jour
   - Commande « En main propre » + « Remise prévue » (date) : le stock est
     retiré tout de suite, mais elle n'est comptée « livrée » qu'une fois
     confirmée.
   - Le jour venu (ou après), l'app demande : remise faite / reporter / annulée.
   Dépend de : db, orders, toast, deleteOrder, renderOrdersHistory (index.html)
   ===================================================================== */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  const fmtD = iso => { try{ return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {weekday: 'short', day: 'numeric', month: 'short'}); }catch(e){ return iso; } };
  const isHand = o => !!(o && o.customer && o.customer.deliveryType === 'main');
  const isPlanned = o => isHand(o) && o.deferred && o.deferredDate && !o.handDone;
  const isDue = o => isPlanned(o) && o.deferredDate <= todayIso();
  const snoozeKey = id => 'hand-snooze-' + id;
  const snoozed = id => { try{ return Number(localStorage.getItem(snoozeKey(id)) || 0) > Date.now(); }catch(e){ return false; } };
  const snooze = (id, ms) => { try{ localStorage.setItem(snoozeKey(id), String(Date.now() + ms)); }catch(e){} };

  async function markDone(o){
    const at = new Date().toISOString();
    await db.collection('orders').doc(o.id).set({handDone: at, deferred: false}, {merge: true});
    o.handDone = at; o.deferred = false;
    toast('✅ Remise confirmée — comptée livrée');
    refresh();
  }
  async function reschedule(o, date){
    if(!date){ toast('Choisissez une date', true); return; }
    await db.collection('orders').doc(o.id).set({deferred: true, deferredDate: date}, {merge: true});
    o.deferred = true; o.deferredDate = date;
    try{ localStorage.removeItem(snoozeKey(o.id)); }catch(e){}
    toast('📅 Remise reportée au ' + fmtD(date));
    refresh();
  }
  async function cancel(o){
    if(typeof deleteOrder === 'function') await deleteOrder(o.id);   // demande confirmation et remet le stock
    refresh();
  }
  function refresh(){
    try{ if(typeof renderOrdersHistory === 'function') renderOrdersHistory(); }catch(e){}
    try{ if(typeof updateDeferredBadge === 'function') updateDeferredBadge(); }catch(e){}
    try{ const m = document.getElementById('orderDetailModal'); if(m && m.classList.contains('show') && window.zrOnOrders) window.zrOnOrders(); }catch(e){}
  }

  /* ---------- Encadré dans le détail de la commande ---------- */
  window.handBox = function(o){
    if(!isHand(o)) return '';
    if(!isPlanned(o)){
      const when = o.handDone ? new Date(o.handDone).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'}) : new Date(o.createdAt).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'});
      return `<div class="hd-box ok">🤝 <b>Remise en main propre faite</b><br><span>${when}${o.customer.address ? ' · ' + esc(o.customer.address) : ''}</span></div>`;
    }
    const late = o.deferredDate < todayIso(), today = o.deferredDate === todayIso();
    return `<div class="hd-box ${late ? 'late' : (today ? 'today' : '')}">🤝 <b>Remise prévue ${today ? "aujourd'hui" : 'le ' + fmtD(o.deferredDate)}</b>${late ? ' — <b>date dépassée</b>' : ''}
      ${o.customer.address ? `<br><span>📍 ${esc(o.customer.address)}</span>` : ''}
      <div class="hd-row"><button class="hd-ok" data-hd="done">✅ Remise faite</button><button class="hd-later" data-hd="move">📅 Reporter</button><button class="hd-cancel" data-hd="cancel">❌ Annulée</button></div>
      <div class="hd-move" style="display:none"><input type="date" min="${todayIso()}" value="${o.deferredDate}"><button data-hd="save">OK</button></div></div>`;
  };
  window.handBind = function(root, o){
    if(!root) return;
    root.querySelectorAll('[data-hd]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const k = b.dataset.hd;
      if(k === 'done') await markDone(o);
      else if(k === 'move'){ const m = root.querySelector('.hd-move'); if(m) m.style.display = m.style.display === 'none' ? 'flex' : 'none'; }
      else if(k === 'save'){ const inp = root.querySelector('.hd-move input'); await reschedule(o, inp && inp.value); }
      else if(k === 'cancel') await cancel(o);
    });
  };

  /* ---------- Rappel : remises du jour (ou en retard) ---------- */
  let open = false;
  function check(){
    if(open || typeof orders === 'undefined' || !Array.isArray(orders)) return;
    if(typeof currentUser === 'undefined' || !currentUser) return;
    const due = orders.filter(o => isDue(o) && !snoozed(o.id)).sort((a, b) => a.deferredDate.localeCompare(b.deferredDate));
    if(!due.length) return;
    const o = due[0];
    open = true;
    const m = document.createElement('div'); m.id = 'hdModal';
    const items = (o.items || []).map(i => `<div class="hd-it">${i.img ? `<img src="${esc(i.img)}">` : ''}<span>${esc(i.name)}</span><b>×${i.qty || 1}</b></div>`).join('');
    const late = o.deferredDate < todayIso();
    m.innerHTML = `<div class="hd-card">
      <h3>🤝 Remise ${late ? 'prévue le ' + fmtD(o.deferredDate) : "prévue aujourd'hui"}</h3>
      <p><b>${esc(o.customer.name || 'Cliente')}</b>${o.customer.phone ? ' · ' + esc(o.customer.phone) : ''}${o.customer.address ? '<br>📍 ' + esc(o.customer.address) : ''}<br>💰 ${Number(o.total || 0).toFixed(0)} DA</p>
      ${items}
      <div class="hd-q">La cliente a-t-elle pris sa commande ?</div>
      <button class="hd-ok big" data-hd="done">✅ Oui, remise faite</button>
      <button class="hd-later big" data-hd="move">📅 Elle la prendra un autre jour</button>
      <div class="hd-move" style="display:none"><input type="date" min="${todayIso()}" value="${todayIso()}"><button data-hd="save">OK</button></div>
      <button class="hd-cancel big" data-hd="cancel">❌ Annulée (remettre en stock)</button>
      <button class="hd-snooze" id="hd-snooze">Me le rappeler plus tard</button>${due.length > 1 ? `<div class="hd-more">+ ${due.length - 1} autre${due.length > 2 ? 's' : ''} remise${due.length > 2 ? 's' : ''} à confirmer</div>` : ''}
    </div>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); open = false; setTimeout(check, 600); };
    window.handBind(m, o);
    m.querySelectorAll('[data-hd="done"],[data-hd="save"],[data-hd="cancel"]').forEach(b => {
      const h = b.onclick; b.onclick = async e => { await h(e); if(b.dataset.hd !== 'save' || !m.querySelector('.hd-move input') || m.querySelector('.hd-move input').value) close(); };
    });
    document.getElementById('hd-snooze').onclick = () => { snooze(o.id, 2 * 3600 * 1000); close(); };
  }

  /* ---------- Libellés du formulaire quand « En main propre » est choisi ---------- */
  function relabel(prefix, hand){
    const t = document.getElementById(prefix + '-deferred-toggle');
    const row = t && t.closest('.account-row');
    if(row){
      const main = row.querySelector('span');
      if(main){
        if(!main.dataset.orig) main.dataset.orig = main.innerHTML;
        main.innerHTML = hand ? 'Remise prévue un autre jour<span style="display:block;font-size:11px;font-weight:600;color:var(--mauve-dark);margin-top:2px;">Le stock est retiré maintenant · l\'app vous le rappellera le jour venu</span>' : main.dataset.orig;
      }
    }
    const f = document.getElementById(prefix + '-deferred-date-field');
    const lb = f && f.querySelector('label');
    if(lb){ if(!lb.dataset.orig) lb.dataset.orig = lb.textContent; lb.textContent = hand ? '📅 Date du rendez-vous' : lb.dataset.orig; }
  }
  function wrap(name, prefix){
    const orig = window[name];
    if(typeof orig !== 'function') return;
    window[name] = function(type){ const r = orig.apply(this, arguments); try{ relabel(prefix, type === 'main'); }catch(e){} return r; };
  }
  wrap('setDeliveryType', 'o');
  wrap('setEoDeliveryType', 'eo');

  const st = document.createElement('style');
  st.textContent = `
    .hd-box{border-radius:14px;padding:12px;margin:10px 0;background:#fff4d6;color:#6b4b00;font-size:14px;line-height:1.5;}
    .hd-box.ok{background:#dcf3e6;color:#16502f;} .hd-box.late{background:#f8dedb;color:#8e2f27;} .hd-box.today{background:#e3f0ff;color:#1d4f86;}
    .hd-box span{font-size:13px;opacity:.85;}
    .hd-row{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
    .hd-row button{flex:1;min-width:90px;border:none;border-radius:10px;padding:10px 6px;font-weight:800;font-size:13px;}
    .hd-ok{background:#1e7b45;color:#fff;} .hd-later{background:#fff;color:#1d4f86;border:1px solid #b9d3f0 !important;} .hd-cancel{background:#fff;color:#b3261e;border:1px solid #e7b1aa !important;}
    .hd-move{gap:6px;margin-top:8px;} .hd-move input{flex:1;min-width:0;padding:9px;border-radius:9px;border:1px solid #ccc;font-size:14px;}
    .hd-move button{border:none;border-radius:9px;padding:0 14px;background:#1d4f86;color:#fff;font-weight:800;}
    #hdModal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10050;display:flex;align-items:flex-end;justify-content:center;}
    #hdModal .hd-card{background:var(--card,#fff);color:var(--plum,#222);width:100%;max-width:520px;max-height:90vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;}
    #hdModal h3{margin:0 0 6px;} #hdModal p{margin:0 0 10px;font-size:14px;line-height:1.5;}
    .hd-it{display:flex;align-items:center;gap:10px;background:var(--cream,#f6efe9);border-radius:10px;padding:6px;margin-bottom:6px;font-size:13px;}
    .hd-it img{width:42px;height:42px;border-radius:8px;object-fit:cover;} .hd-it span{flex:1;}
    .hd-q{font-weight:800;margin:12px 0 8px;}
    #hdModal .big{display:block;width:100%;border-radius:12px;padding:13px;font-size:15px;font-weight:800;margin-top:8px;border:none;}
    .hd-snooze{display:block;width:100%;margin-top:10px;background:none;border:none;color:var(--mauve-dark,#7a5a6a);font-weight:700;padding:8px;}
    .hd-more{text-align:center;font-size:12.5px;opacity:.75;margin-top:4px;}`;
  document.head.appendChild(st);

  setInterval(check, 60 * 1000);
  setTimeout(check, 5000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) setTimeout(check, 1500); });
  window.handCheck = check;
  window.handRelabel = relabel;
  window.handIsPlanned = isPlanned;
})();
