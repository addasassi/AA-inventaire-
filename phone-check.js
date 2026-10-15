/* =====================================================================
   📞 Vérification du numéro de téléphone (nouvelle commande + modification)
   - nettoie : espaces, points, tirets, +213 / 00213, chiffres arabes ٠١٢…
   - vérifie : 10 chiffres, commence par 05 / 06 / 07 (fixe 02x-04x accepté avec avertissement)
   - indique l'opérateur (Ooredoo / Mobilis / Djezzy) en direct sous la case
   - avertit : numéro suspect (0555555555…), commande déjà en cours pour ce numéro
   - bloque l'enregistrement si le numéro est faux (window.phoneGuard)
   ===================================================================== */
(function(){
  const OPS = {'5': 'Ooredoo', '6': 'Mobilis', '7': 'Djezzy'};
  const AR = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};

  function clean(raw){
    let s = String(raw || '').replace(/[٠-٩۰-۹]/g, c => AR[c]).trim();
    const plus = /^\s*\+/.test(s);
    s = s.replace(/\D/g, '');
    if(plus || s.startsWith('00213')) s = s.replace(/^(00)?213/, '');
    else if(s.startsWith('213') && s.length >= 12) s = s.slice(3);
    if(/^[567]\d{8}$/.test(s) || /^[234]\d{7}$/.test(s)) s = '0' + s;   // 0 oublié au début
    return s;
  }

  // → {ok, clean, level:'ok'|'warn'|'bad'|'', msg}
  function check(raw){
    const c = clean(raw);
    if(!c) return {ok: false, empty: true, clean: '', level: '', msg: ''};
    if(!c.startsWith('0')) return {ok: false, clean: c, level: 'bad', msg: 'Le numéro doit commencer par 05, 06 ou 07'};
    const mobile = /^0[567]/.test(c), fixe = /^0[234]/.test(c);
    if(!mobile && !fixe) return {ok: false, clean: c, level: 'bad', msg: 'Le numéro doit commencer par 05, 06 ou 07'};
    const need = mobile ? 10 : 9, diff = c.length - need;
    if(diff < 0) return {ok: false, clean: c, level: 'bad', msg: `Il manque ${-diff} chiffre${diff < -1 ? 's' : ''} (${c.length}/${need})`};
    if(diff > 0) return {ok: false, clean: c, level: 'bad', msg: `${diff} chiffre${diff > 1 ? 's' : ''} en trop (${c.length}/${need})`};
    const rest = c.slice(2);
    if(/^(\d)\1+$/.test(rest) || /(\d)\1{6,}/.test(c) || /^0[567]0{6,}/.test(c) || rest === '12345678' || rest === '87654321')
      return {ok: true, clean: c, level: 'warn', msg: 'Numéro bizarre (chiffres répétés) — vérifiez avec la cliente'};
    if(fixe) return {ok: true, clean: c, level: 'warn', msg: 'Numéro fixe — la cliente doit être joignable dessus'};
    return {ok: true, clean: c, level: 'ok', msg: OPS[c[1]]};
  }

  const fmt = c => c.length === 10 ? c.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : c;
  const key = p => clean(p);

  // commandes encore en cours pour ce numéro (pas livrées, pas retournées)
  function openOrdersFor(c, exceptId){
    if(typeof orders === 'undefined' || !Array.isArray(orders) || !c) return [];
    return orders.filter(o => {
      if(!o || o.id === exceptId || !o.customer) return false;
      if(key(o.customer.phone) !== c && key(o.customer.phone2) !== c) return false;
      const stage = (o.zr && o.zr.stage) || '';
      if(stage === 'delivered' || stage === 'returned') return false;
      if(o.customer.deliveryType === 'main' && (o.handDone || !o.deferred)) return false;
      return true;
    });
  }

  function hintFor(input){
    let h = input.parentNode.querySelector('.ph-hint');
    if(!h){ h = document.createElement('div'); h.className = 'ph-hint'; input.insertAdjacentElement('afterend', h); }
    return h;
  }
  const exceptIdOf = input => input.id.startsWith('eo-') ? (typeof editingOrderId !== 'undefined' ? editingOrderId : '') : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function show(input){
    const r = check(input.value), h = hintFor(input);
    input.classList.toggle('ph-bad', r.level === 'bad');
    input.classList.toggle('ph-good', r.level === 'ok');
    if(r.empty){ h.style.display = 'none'; h.innerHTML = ''; return r; }
    let html = r.level === 'ok' ? `✅ ${fmt(r.clean)} · <b>${r.msg}</b>` : r.level === 'warn' ? `⚠️ ${esc(r.msg)}` : `❌ ${esc(r.msg)}`;
    if(r.ok){
      const open = openOrdersFor(r.clean, exceptIdOf(input));
      if(open.length){
        const o = open[0];
        html += `<div class="ph-dup">📦 Ce numéro a déjà ${open.length > 1 ? open.length + ' commandes' : 'une commande'} en cours : <b>${esc(o.customer.name || '')}</b> · ${new Date(o.createdAt).toLocaleDateString('fr-FR')} · ${Math.round(Number(o.total) || 0)} DA — attention au double envoi</div>`;
      }
    }
    h.className = 'ph-hint ' + r.level; h.innerHTML = html; h.style.display = '';
    return r;
  }

  function bind(id){
    const el = document.getElementById(id);
    if(!el || el.dataset.ph) return;
    el.dataset.ph = '1';
    let last = el.value;
    const run = () => { last = el.value; show(el); };
    el.addEventListener('input', run);
    el.addEventListener('change', run);
    el.addEventListener('blur', () => { const r = check(el.value); if(r.ok && el.value !== r.clean){ el.value = r.clean; } run(); });
    // la valeur est aussi remplie par le code (analyse du message, fiche cliente, modification…)
    setInterval(() => { if(el.value !== last && document.activeElement !== el) run(); }, 600);
    run();
  }

  /* Contrôle avant enregistrement. required = téléphone obligatoire (pas pour « en main propre »).
     → {ok, phone, phone2} ; affiche le message et met le focus sur la case fautive si refus */
  window.phoneGuard = function(prefix, required){
    const p1 = document.getElementById(prefix + '-phone'), p2 = document.getElementById(prefix + '-phone2');
    const r1 = check(p1 ? p1.value : ''), r2 = check(p2 ? p2.value : '');
    const fail = (el, msg) => { if(el){ show(el); el.focus(); el.scrollIntoView({block: 'center', behavior: 'smooth'}); } toast('📞 ' + msg, true); return {ok: false}; };
    if(r1.empty && required) return fail(p1, 'Le téléphone de la cliente est obligatoire');
    if(!r1.empty && !r1.ok) return fail(p1, 'Numéro faux : ' + r1.msg + ' — commande non enregistrée');
    if(!r2.empty && !r2.ok) return fail(p2, '2e numéro faux : ' + r2.msg + ' — corrigez-le ou videz la case');
    if(!r2.empty && r1.empty) return fail(p1, 'Mettez le numéro principal dans la 1re case');
    const phone = r1.clean, phone2 = !r2.empty && r2.clean !== r1.clean ? r2.clean : '';
    if(p1) p1.value = phone; if(p2) p2.value = phone2;
    return {ok: true, phone, phone2};
  };
  window.phoneCheck = check;
  window.phoneClean = clean;

  function css(){
    if(document.getElementById('ph-css')) return;
    const s = document.createElement('style'); s.id = 'ph-css';
    s.textContent = `
      .ph-hint{margin-top:6px;font-size:12.5px;line-height:1.4;padding:6px 10px;border-radius:9px;}
      .ph-hint.ok{color:#1f8a4c;background:rgba(31,138,76,.09);}
      .ph-hint.warn{color:#9a6a10;background:rgba(201,137,26,.12);}
      .ph-hint.bad{color:#c0392b;background:rgba(192,57,43,.1);font-weight:700;}
      html[data-theme="dark"] .ph-hint.ok{color:#3ecf8e;} html[data-theme="dark"] .ph-hint.warn{color:#e9b04a;} html[data-theme="dark"] .ph-hint.bad{color:#ff7b6b;}
      .ph-dup{margin-top:5px;padding-top:5px;border-top:1px dashed currentColor;color:#9a6a10;font-weight:600;}
      html[data-theme="dark"] .ph-dup{color:#e9b04a;}
      input.ph-bad{border-color:#c0392b !important;box-shadow:0 0 0 2px rgba(192,57,43,.15);}
      input.ph-good{border-color:#1f8a4c !important;}
      .ph-opt{font-weight:400;opacity:.7;font-size:.9em;}`;
    document.head.appendChild(s);
  }
  function init(){ css(); ['o-phone', 'o-phone2', 'eo-phone', 'eo-phone2'].forEach(bind); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
