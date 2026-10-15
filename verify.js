/* ============================================================
   🔎 « À vérifier » : en ajoutant une commande (admin ou employé), on peut la marquer à vérifier
   (commune pas sûre, cliente pas encore confirmée…). Elle n'est PAS envoyée à ZR tant que
   quelqu'un n'a pas appuyé sur « ✅ Vérifiée ».
   ============================================================ */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const REASONS = {commune: '📍 Commune à vérifier', confirm: '📞 Cliente pas encore confirmée', autre: '✏️ Autre'};
  const all = () => (typeof orders !== 'undefined' ? orders : []);
  const sent = o => !!(o.zr && (o.zr.parcelId || o.zr.tracking));

  /* ---------- formulaire « Nouvelle commande » ---------- */
  function readForm(){
    const t = document.getElementById('o-verify-toggle');
    if(!t || !t.checked) return null;
    const reasons = [...document.querySelectorAll('#o-verify-box .vf-chip.on')].map(b => b.dataset.r);
    const note = (document.getElementById('o-verify-note') || {}).value || '';
    return {reasons, note: note.trim(), by: (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '', at: new Date().toISOString()};
  }
  function resetForm(){
    const t = document.getElementById('o-verify-toggle'); if(t) t.checked = false;
    const b = document.getElementById('o-verify-box'); if(b) b.style.display = 'none';
    document.querySelectorAll('#o-verify-box .vf-chip').forEach(c => c.classList.remove('on'));
    const n = document.getElementById('o-verify-note'); if(n) n.value = '';
  }
  function bindForm(){
    const t = document.getElementById('o-verify-toggle');
    if(!t || t.dataset.bound) return;
    t.dataset.bound = '1';
    t.addEventListener('change', () => { document.getElementById('o-verify-box').style.display = t.checked ? '' : 'none'; });
    document.querySelectorAll('#o-verify-box .vf-chip').forEach(c => c.addEventListener('click', e => { e.preventDefault(); c.classList.toggle('on'); }));
  }

  /* ---------- bandeau (liste + détail) ---------- */
  function banner(o){
    if(!o || !o.verify || sent(o)) return '';   // envoyée à la main depuis le détail : plus rien à vérifier
    const v = o.verify;
    const why = (v.reasons || []).map(r => REASONS[r] || r).filter(r => r !== REASONS.autre);
    if(v.note) why.push('✏️ ' + v.note);
    return `<div class="vf-note">
      <div><b>🔎 À vérifier</b>${v.by ? ' <small>· ' + esc(v.by) + '</small>' : ''}</div>
      ${why.length ? `<div class="vf-why">${why.map(esc).join('<br>')}</div>` : ''}
      <div class="vf-sub">Pas encore envoyée à ZR.</div>
      <button class="vf-ok" onclick="event.stopPropagation();verifyDone('${esc(o.id)}')">✅ Vérifiée${o.customer && o.customer.deliveryType === 'main' ? '' : ' — envoyer à ZR'}</button>
    </div>`;
  }

  let busy = false;
  async function done(id){
    const o = all().find(x => x.id === id);
    if(!o || !o.verify || busy) return;
    const isHand = o.customer && o.customer.deliveryType === 'main';
    if(!confirm('Commande vérifiée ?' + (isHand ? '' : '\n\nElle sera envoyée à ZR Express maintenant.') + '\n\nVérifiez avant : commune, adresse, téléphone, articles.')) return;
    busy = true;
    const prev = o.verify;
    o.verify = null;
    o.verifiedBy = (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';
    o.verifiedAt = new Date().toISOString();
    if(!isHand && !sent(o) && !o.swapHold && window.zrPrepareOrder){ o._force = true; window.zrPrepareOrder(o); delete o._force; }
    let ok = false;
    try{ ok = await saveOrderDoc(o); }catch(e){}
    busy = false;
    if(!ok){ o.verify = prev; toast('Échec — réessayez', true); refresh(id); return; }
    if(window.zrAfterSave) window.zrAfterSave(o);
    toast('✅ Commande vérifiée' + (isHand ? '' : ' — envoi à ZR'));
    refresh(id);
  }
  function refresh(id){
    try{ if(typeof renderOrdersHistory === 'function') renderOrdersHistory(); }catch(e){}
    try{ if(typeof currentDetailOrderId !== 'undefined' && currentDetailOrderId === id && typeof showOrderDetail === 'function') showOrderDetail(id); }catch(e){}
  }

  /* ---------- compteur + filtre en haut de la liste ---------- */
  window.verifyOnly = false;
  function bar(){
    const n = all().filter(o => o.verify && !sent(o)).length;
    if(!n){ window.verifyOnly = false; return ''; }
    return `<div class="vf-bar" onclick="verifyToggleOnly()">🔎 <b>${n}</b> commande${n > 1 ? 's' : ''} à vérifier — <u>${window.verifyOnly ? 'Tout afficher' : 'Afficher seulement'}</u></div>`;
  }
  window.verifyToggleOnly = () => { window.verifyOnly = !window.verifyOnly; refresh(''); };

  window.verifyReadForm = readForm;
  window.verifyResetForm = resetForm;
  window.verifyBanner = banner;
  window.verifyDone = done;
  window.verifyBar = bar;
  document.addEventListener('DOMContentLoaded', bindForm); bindForm();

  const st = document.createElement('style');
  st.textContent = `
    .vf-note{background:#fff4e0;border:1.5px solid #f59e0b;color:#5a3a00;border-radius:12px;padding:9px 11px;margin:6px 0;font-size:13px;line-height:1.45;}
    .vf-note small{opacity:.8;font-weight:600;} .vf-why{margin-top:3px;font-weight:600;} .vf-sub{opacity:.8;font-size:12px;margin-top:2px;}
    .vf-ok{display:block;width:100%;margin-top:8px;border:none;border-radius:10px;background:#16a34a;color:#fff;font:inherit;font-weight:800;padding:9px;cursor:pointer;}
    .vf-bar{background:#fff4e0;border:1.5px solid #f59e0b;color:#5a3a00;border-radius:12px;padding:10px 12px;margin:0 0 10px;font-size:14px;text-align:center;cursor:pointer;}
    #o-verify-box{background:#fff4e0;border:1px solid #f5c76b;border-radius:10px;padding:10px;margin:-6px 0 14px;}
    #o-verify-box .vf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}
    .vf-chip{border:1.5px solid #f59e0b;background:#fff;color:#5a3a00;border-radius:999px;padding:6px 11px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;}
    .vf-chip.on{background:#f59e0b;color:#fff;}
    #o-verify-note{width:100%;box-sizing:border-box;}
  `;
  document.head.appendChild(st);
})();
