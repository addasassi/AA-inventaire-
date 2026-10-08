/* =====================================================================
   Wilaya / Commune : recherche en tapant (comme ZR Express)
   Les listes déroulantes restent la référence (même valeurs, mêmes
   événements « change ») : on ajoute seulement une fenêtre de recherche.
   Tape 1 ou 2 lettres, le numéro (« 46 ») ou le nom en arabe.
   ===================================================================== */
(function(){
  const IDS = ['o-wilaya', 'o-commune', 'eo-wilaya', 'eo-commune'];
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // nom arabe d'une wilaya / commune (données déjà chargées par l'app)
  function arabicFor(sel, value){
    try{
      if(/wilaya/.test(sel.id)){
        const w = (typeof wilayaArList !== 'undefined' ? wilayaArList : []).find(x => x.fr === value);
        return w ? w.ar : '';
      }
      const wSel = document.getElementById(sel.id.replace('commune', 'wilaya'));
      const opt = wSel && wSel.selectedOptions[0];
      const code = opt && opt.dataset.code;
      const list = (typeof communeArByCode !== 'undefined' && code) ? (communeArByCode[String(Number(code))] || communeArByCode[code] || []) : [];
      const c = list.find(x => x.fr === value);
      return c ? c.ar : '';
    }catch(e){ return ''; }
  }

  function css(){
    if(document.getElementById('sel-search-css')) return;
    const st = document.createElement('style');
    st.id = 'sel-search-css';
    st.textContent = `
      .sel-btn{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;
        padding:14px 16px;border:1px solid var(--line,#ddd);border-radius:14px;background:var(--card,#fff);color:inherit;
        font:inherit;font-size:16px;text-align:start;cursor:pointer;}
      .sel-btn .sel-txt{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .sel-btn .sel-txt.ph{opacity:.55;}
      .sel-btn:disabled{opacity:.55;}
      .sel-btn svg{flex-shrink:0;opacity:.6;}
      #selectSearchModal{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;}
      #selectSearchModal.show{display:flex;}
      #selectSearchModal .sel-card{background:var(--cream,#f7f2ef);color:var(--plum,#222);width:100%;max-width:560px;height:85vh;
        border-radius:20px 20px 0 0;display:flex;flex-direction:column;overflow:hidden;}
      #selectSearchModal .sel-head{display:flex;gap:8px;align-items:center;padding:14px 14px 10px;}
      #selectSearchModal .sel-head input{flex:1;min-width:0;padding:13px 14px;border:1.5px solid var(--plum,#3a2632);border-radius:12px;
        font:inherit;font-size:16px;background:var(--card,#fff);color:inherit;outline:none;}
      #selectSearchModal .sel-head button{border:none;background:var(--card,#fff);border-radius:12px;width:46px;height:46px;font-size:18px;cursor:pointer;color:inherit;}
      #selectSearchModal .sel-title{padding:0 16px 6px;font-size:13px;font-weight:700;opacity:.7;}
      #selectSearchModal .sel-list{flex:1;overflow-y:auto;padding:0 10px 20px;}
      #selectSearchModal .sel-item{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:14px 12px;
        border-radius:12px;cursor:pointer;font-size:15.5px;}
      #selectSearchModal .sel-item:active,#selectSearchModal .sel-item.on{background:var(--rose,#e3c9c2);}
      #selectSearchModal .sel-item .ar{opacity:.65;font-size:14px;direction:rtl;}
      #selectSearchModal .sel-empty{padding:30px;text-align:center;opacity:.6;}`;
    document.head.appendChild(st);
  }

  let modal, input, list, title, current = null, items = [];
  function ensureModal(){
    if(modal) return;
    modal = document.createElement('div');
    modal.id = 'selectSearchModal';
    modal.innerHTML = `<div class="sel-card">
      <div class="sel-head"><input type="search" placeholder="Tapez quelques lettres…" autocomplete="off"><button id="sel-close" aria-label="Fermer">✕</button></div>
      <div class="sel-title"></div><div class="sel-list"></div></div>`;
    document.body.appendChild(modal);
    input = modal.querySelector('input'); list = modal.querySelector('.sel-list'); title = modal.querySelector('.sel-title');
    modal.addEventListener('click', e => { if(e.target === modal) close(); });
    modal.querySelector('#sel-close').onclick = close;
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => { if(e.key === 'Enter'){ const f = list.querySelector('.sel-item'); if(f) f.click(); } });
  }
  function close(){ modal.classList.remove('show'); current = null; }

  function open(sel){
    ensureModal();
    current = sel;
    items = [...sel.options].filter(o => o.value).map(o => {
      const ar = arabicFor(sel, o.value);
      return {value: o.value, text: o.textContent, ar, key: norm(o.textContent + ' ' + o.value + ' ' + ar)};
    });
    const label = sel.closest('.field') && sel.closest('.field').querySelector('label');
    title.textContent = (label ? label.textContent : '') + ' — ' + items.length;
    input.value = '';
    render();
    modal.classList.add('show');
    setTimeout(() => input.focus(), 50);
  }

  function render(){
    const q = norm(input.value);
    let res = items;
    if(q){
      res = items.map(it => {
        const words = it.key.split(' ');
        const score = it.key.startsWith(q) ? 0 : words.some(w => w.startsWith(q)) ? 1 : it.key.includes(q) ? 2 : 9;
        return [score, it];
      }).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    }
    if(!res.length){ list.innerHTML = '<div class="sel-empty">Aucun résultat</div>'; return; }
    list.innerHTML = res.map(it => `<div class="sel-item${current && current.value === it.value ? ' on' : ''}" data-v="${esc(it.value)}">
      <span>${esc(it.text)}</span>${it.ar ? `<span class="ar">${esc(it.ar)}</span>` : ''}</div>`).join('');
    list.querySelectorAll('.sel-item').forEach(el => el.onclick = () => {
      const sel = current;
      sel.value = el.dataset.v;
      sel.dispatchEvent(new Event('change', {bubbles: true}));
      close();
      refresh(sel);
    });
  }

  const CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
  function refresh(sel){
    const btn = sel._selBtn; if(!btn) return;
    const opt = sel.selectedOptions[0];
    const txt = btn.querySelector('.sel-txt');
    const empty = !opt || !opt.value;
    txt.textContent = opt ? opt.textContent : '';
    txt.classList.toggle('ph', empty);
    btn.disabled = sel.disabled;
  }

  function enhance(sel){
    if(!sel || sel._selBtn) return;
    css();
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sel-btn';
    btn.innerHTML = '<span class="sel-txt"></span>' + CHEVRON;
    btn.onclick = () => { if(!sel.disabled) open(sel); };
    sel.after(btn);
    sel.style.display = 'none';
    sel._selBtn = btn;
    sel.addEventListener('change', () => refresh(sel));
    new MutationObserver(() => refresh(sel)).observe(sel, {childList: true, attributes: true, attributeFilter: ['disabled']});
    // valeur changée par le code (analyse du texte, modification d'une commande…)
    let last = null;
    setInterval(() => { const k = sel.value + '|' + sel.disabled + '|' + sel.options.length; if(k !== last){ last = k; refresh(sel); } }, 400);
    refresh(sel);
  }

  function init(){ IDS.forEach(id => enhance(document.getElementById(id))); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
