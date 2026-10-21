/* =====================================================================
   🧠 Analyse du message de la cliente (nom, téléphone, wilaya, commune…)
   1) Analyse locale renforcée : arabe / français / darija, surnoms (دزاير,
      بقاية…), numéros de wilaya, fautes de frappe, commune seule → wilaya.
   2) Si un doute reste (wilaya ou commune introuvable) : l'IA Cloudflare
      (relais ZR, route /parse) lit le message, puis on recale sur les listes
      officielles.
   3) Les champs remplis automatiquement sont surlignés : à vérifier.
   Dépend de : wilayasList, wilayaArList, communesByWilaya, communeArByCode,
   ZR_OFFICES, officesForWilaya, applyImportedOrder, toast (index.html)
   ===================================================================== */
(function(){
  const N = s => String(s || '')
    .replace(/[​-‏‪-‮﻿]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ئ/g, 'ي').replace(/ؤ/g, 'و')
    .replace(/[ً-ٰٟـ]/g, '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`\-_.,;:!?()«»"/\\|]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const stripAl = w => w.replace(/^(ال|el |al |l )/, '');
  function lev(a, b){
    const m = a.length, n = b.length; if(!m) return n; if(!n) return m;
    let prev = Array.from({length: n + 1}, (_, j) => j);
    for(let i = 1; i <= m; i++){
      const cur = [i];
      for(let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  // surnoms courants (en plus des noms officiels FR / AR)
  const ALIAS = {
    16: ['دزاير', 'الدزاير', 'العاصمه', 'الجزاير العاصمه', 'alger centre', 'algiers', 'dzair', 'dz', 'alger'],
    6: ['بقايه', 'بجايه', 'bgayet', 'bougie', 'bejaia', 'vgayet'],
    15: ['تيزي', 'تيزي وزو', 'tizi'],
    31: ['وهران', 'wahran', 'oran'],
    25: ['قسنطينه', 'ksentina', 'constantine', 'qsentina'],
    22: ['بلعباس', 'سيدي بلعباس', 'sba', 'sidi bel abbes', 'bel abbes'],
    34: ['برج', 'برج بوعريريج', 'bba', 'bordj'],
    27: ['مستغانم', 'mosta', 'mostaganem'],
    9: ['البليده', 'blida'], 35: ['بومرداس', 'boumerdes'], 39: ['الوادي', 'وادي سوف', 'el oued', 'oued souf'],
    23: ['عنابه', 'annaba'], 19: ['سطيف', 'setif', 'stif'], 13: ['تلمسان', 'tlemcen'], 26: ['المديه', 'medea'],
    44: ['عين الدفلي', 'ain defla'], 2: ['الشلف', 'chlef'], 42: ['تيبازه', 'tipaza', 'tipasa'], 48: ['غليزان', 'relizane'],
    14: ['تيارت', 'tiaret'], 29: ['معسكر', 'mascara'], 10: ['البويره', 'bouira'], 18: ['جيجل', 'jijel'], 21: ['سكيكده', 'skikda'],
    24: ['قالمه', 'guelma'], 43: ['ميله', 'mila'], 36: ['الطارف', 'el tarf'], 3: ['الاغواط', 'laghouat'], 30: ['ورقله', 'ouargla'],
    8: ['بشار', 'bechar'], 1: ['ادرار', 'adrar'], 11: ['تمنراست', 'tamanrasset'], 47: ['غردايه', 'ghardaia'], 17: ['الجلفه', 'djelfa'],
    28: ['المسيله', 'msila', 'm sila'], 4: ['ام البواقي', 'oum el bouaghi'], 40: ['خنشله', 'khenchela'], 41: ['سوق اهراس', 'souk ahras'],
    12: ['تبسه', 'tebessa'], 7: ['بسكره', 'biskra'], 5: ['باتنه', 'batna'], 20: ['سعيده', 'saida'], 45: ['النعامه', 'naama'],
    32: ['البيض', 'el bayadh'], 38: ['تيسمسيلت', 'tissemsilt'], 46: ['عين تموشنت', 'ain temouchent', 'temouchent'], 33: ['اليزي', 'illizi'],
    37: ['تندوف', 'tindouf']
  };

  /* ---------- index des lieux ---------- */
  let IDX = null;
  function buildIndex(){
    const W = (typeof wilayasList !== 'undefined' && wilayasList) || [];
    if(!W.length) return null;
    const wil = [];   // {code, name, keys:[norm]}
    W.forEach(w => {
      const keys = new Set([N(w.name)]);
      const ar = ((typeof wilayaArList !== 'undefined' && wilayaArList) || []).find(x => Number(x.code) === Number(w.code));
      if(ar && ar.ar) keys.add(N(ar.ar));
      (ALIAS[w.code] || []).forEach(a => keys.add(N(a)));
      wil.push({code: Number(w.code), name: w.name, keys: [...keys].filter(Boolean)});
    });
    const com = [];   // {code, fr, keys}
    const byCode = (typeof communesByWilaya !== 'undefined' && communesByWilaya) || {};
    const arByCode = (typeof communeArByCode !== 'undefined' && communeArByCode) || {};
    Object.keys(byCode).forEach(code => {
      (byCode[code] || []).forEach(fr => {
        const keys = new Set([N(fr)]);
        (arByCode[code] || []).filter(x => x.fr === fr && x.ar).forEach(x => keys.add(N(x.ar)));
        com.push({code: Number(code), fr, keys: [...keys].filter(k => k.length >= 3)});
      });
    });
    return {wil, com};
  }
  function idx(){ if(!IDX || !IDX.com.length) IDX = buildIndex(); return IDX; }

  // trouve les correspondances d'une liste de lieux dans un texte (exact puis approché)
  // mots collés en darija : فالعلمة، بالبليدة، لوهران، في العلمة…
  const unglue = s => s.split(' ').map(w => w.length > 4 ? w.replace(/^(فال|بال|وال|لل|في|ف|ب|ل)(?=..)/, m => m.length >= 3 ? 'ال' : '') : w).join(' ');
  function findIn(text, list){
    const base = N(text);
    const t = ' ' + base + ' ' + unglue(base) + ' ';
    const tc = t.replace(/\s/g, '');
    const words = t.trim().split(' ').filter(Boolean);
    const grams = [];
    for(let i = 0; i < words.length; i++) for(let k = 1; k <= 4 && i + k <= words.length; k++) grams.push(words.slice(i, i + k).join(' '));
    const hits = [];
    list.forEach(item => {
      let best = 0;
      item.keys.forEach(key => {
        if(key.length < 3) return;
        if(t.includes(' ' + key + ' ') || t.includes(' ' + stripAl(key) + ' ')) best = Math.max(best, 100 + key.length);
        else if(key.replace(/\s/g, '').length >= 6 && tc.includes(key.replace(/\s/g, ''))) best = Math.max(best, 95 + key.length);
        else if(key.length >= 5){
          const ks = stripAl(key);
          grams.forEach(g => {
            const gs = stripAl(g);
            if(Math.abs(gs.length - ks.length) > 2) return;
            const d = lev(gs, ks);
            const ok = ks.length >= 8 ? d <= 2 : d <= 1;
            if(ok) best = Math.max(best, 60 + ks.length - d * 10);
          });
        }
      });
      if(best) hits.push({item, score: best});
    });
    return hits.sort((a, b) => b.score - a.score);
  }

  const STOP_RE = /(مكتب|بيرو|بورو|ستوب|stop ?desk|stopdesk|bureau|agence|point relais|نجي نديه|نجي نجيبه|نديه من|من عندكم|من المكتب|nedih|njib)/i;
  const HOME_RE = /(للدار|للمنزل|الدار|domicile|maison|lel dar|f dar)/i;
  const ADDR_RE = /(حي|شارع|نهج|طريق|عماره|زنقه|قرب|بجانب|مقابل|cite|rue|route|lotissement|residence|quartier|en face|pres de|حومه)/i;

  function localParse(text){
    const I = idx();
    const raw = String(text || '').replace(/[​-‏‪-‮﻿]/g, '');
    const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const r = {name: '', phone: '', wilaya: '', commune: '', address: '', deliveryType: 'domicile', officeOption: null, total: null, sure: {}};

    // téléphone (avec +213 / espaces / points)
    // chiffres arabes → normaux ; jusqu'à 2 numéros différents (2e = phone2)
    const rawD = raw.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6F0));
    const cands = (rawD.match(/(?:\+?213|00213|0)?[\s.\-]*[5-7](?:[\s.\-]*\d){7,9}/g) || [])
      .map(x => window.phoneClean ? window.phoneClean(x) : x.replace(/\D/g, '')).filter(Boolean);
    const good = [...new Set(cands.filter(x => /^0[5-7]\d{8}$/.test(x)))];
    if(good[0]) r.phone = good[0];
    if(good[1]) r.phone2 = good[1];
    if(!r.phone && cands[0]) r.phoneBad = cands[0];   // numéro incomplet/faux : on le montre quand même pour le corriger

    // stop desk ?
    if(STOP_RE.test(N(raw)) || STOP_RE.test(raw)) r.deliveryType = 'stopdesk';
    if(HOME_RE.test(N(raw)) && !/مكتب|bureau|stop/i.test(raw)) r.deliveryType = 'domicile';

    // lignes utiles pour les lieux (sans téléphone ni total)
    const PHONE_IN = /(\+?213|0)\s*[5-7](?:[\s.\-]*\d){8}/g;
    const placeLines = lines.filter(l => !/(المجموع|مجموع|total|سعر|prix)/i.test(l)).map(l => l.replace(PHONE_IN, ' ').trim()).filter(Boolean);
    const placeText = placeLines.join('\n');

    let W = null, C = null;
    if(I){
      // numéro de wilaya écrit seul (« 16 », « w16 », « ولاية 31 »)
      for(const l of placeLines){
        const m = N(l).match(/^(?:w|wilaya|ولايه|ولاية)?\s*(\d{1,2})$/) || N(l).match(/(?:wilaya|ولايه)\s*(\d{1,2})\b/);
        if(m && Number(m[1]) >= 1 && Number(m[1]) <= 58){ W = I.wil.find(w => w.code === Number(m[1])) || null; if(W) break; }
      }
      const wh = W ? [] : findIn(placeText, I.wil);
      if(!W && wh.length) W = wh[0].item;
      // une commune écrite exactement l'emporte sur une wilaya seulement « ressemblante » (ex. بوقرة ≠ البويرة)
      if(W && wh.length && wh[0].score < 100){
        const exactC = findIn(placeText, I.com).filter(h => h.score >= 100);
        if(exactC.length && [...new Set(exactC.filter(h => h.score === exactC[0].score).map(h => h.item.code))].length === 1){ W = null; }
      }
      const ch = findIn(placeText, W ? I.com.filter(c => c.code === W.code) : I.com);
      if(ch.length){
        if(W){
          // « Béjaïa Akbou » : la commune chef-lieu (même nom que la wilaya) passe après une autre commune citée
          const wk = new Set(W.keys.map(k => stripAl(k).replace(/\s/g, '')));
          const isCapital = h => h.item.keys.some(k => wk.has(stripAl(k).replace(/\s/g, ''))) || wk.has(N(h.item.fr).replace(/\s/g, ''));
          const other = ch.find(h => !isCapital(h));
          C = (isCapital(ch[0]) && other) ? other.item : ch[0].item;
        }
        else{
          // commune seule : on en déduit la wilaya si elle n'est pas ambiguë
          const top = ch.filter(h => h.score === ch[0].score);
          const codes = [...new Set(top.map(h => h.item.code))];
          if(codes.length === 1){ C = top[0].item; W = I.wil.find(w => w.code === C.code) || null; r.sure.inferred = true; }
        }
      }
      // la wilaya trouvée n'est peut-être que le nom de la commune chef-lieu : si une commune d'une autre wilaya colle mieux, on garde la commune
      if(W && !C){
        const all = findIn(placeText, I.com);
        if(all.length && all[0].score >= 100 && all[0].item.code !== W.code && !wh.some(h => h.item.code === W.code && h.score >= 100)){
          C = all[0].item; W = I.wil.find(w => w.code === C.code) || W;
        }
      }
    }
    if(W){ r.wilaya = W.name; r.sure.wilaya = true; }
    if(C && r.deliveryType !== 'stopdesk'){ r.commune = C.fr; r.sure.commune = true; }

    // bureau stop desk
    if(r.deliveryType === 'stopdesk' && r.wilaya && typeof officesForWilaya === 'function'){
      const offices = officesForWilaya(r.wilaya) || [];
      let off = null;
      if(offices.length === 1) off = offices[0];
      else{
        const nt = ' ' + N(raw) + ' ';
        off = offices.find(o => nt.includes(' ' + N(o.commune) + ' ') || (o.ar && nt.includes(N(o.ar).replace(/^مكتب /, ''))))
          || (C && offices.find(o => N(o.commune) === N(C.fr))) || null;
      }
      if(off){ r.officeOption = off.commune + ' (' + off.type + ')'; r.sure.office = true; }
    }

    // nom : étiquette (« الاسم و اللقب », « اسم و لقب », « اسمي », « يسموني », « nom »…), sinon 1re ligne sans chiffres qui n'est pas un lieu
    const lab = lines.map(l => { const m = l.match(NAME_LBL); const rest = m ? l.slice(m[0].length).trim() : ''; return rest && !/\d{6,}/.test(rest) ? [l, rest] : null; }).find(Boolean);
    if(lab) r.name = cleanName(lab[1]);
    else{
      const cand = lines.map(l => l.replace(PHONE_IN, ' | ').split('|')[0].trim()).find(l => l && !/\d/.test(l) && l.length <= 40 && !STOP_RE.test(l) && !ADDR_RE.test(N(l))
        && !(I && (findIn(l, I.wil).some(h => h.score >= 100) || findIn(l, I.com).some(h => h.score >= 100)))
        && !(I && (findIn(l, I.wil).some(h => h.score >= 95) || findIn(l, I.com).some(h => h.score >= 95)))
        && !/^(ولايه|بلديه|wilaya|commune|السلام|سلام|عسلامه|salam|slm|bonjour|bonsoir|مرحبا|راني|انا|نحب|حبيت|بغيت|من فضلك|السلعه|المنتوج)/i.test(N(l))
        && !/(حبيت|نحب|نطلب|بغيت|عليكم|commande|نشري)/i.test(N(l)));
      if(cand) r.name = cleanName(cand);
    }
    r.sure.name = !!lab;

    // adresse : ligne avec حي / شارع / cité…
    const ad = lines.map(l => l.replace(/^\s*(العنوان|عنوان|adresse|address)\s*[:：\-]\s*/i, '')).find(l => ADDR_RE.test(N(l)) && !/0[5-7]\d{8}/.test(l.replace(/\s/g, '')));
    if(ad) r.address = ad.trim();

    // total (« 365 الف » = 3650 DA)
    for(const l of lines){
      if(/(المجموع|مجموع|total)/i.test(l)){
        const m = l.match(/(\d[\d\s]*\d|\d)/);
        if(m){ let n = parseFloat(m[0].replace(/\s/g, '')); if(/الف|ألف/.test(l)) n *= 10; r.total = n; }
        break;
      }
    }
    return r;
  }

  /* ---------- étiquette du nom à enlever : « اسم و لقب بودية مريم » → « بودية مريم » ---------- */
  // (le mot doit être suivi d'un espace ou de « : » : « أسماء » reste un prénom)
  var NAME_LBL = /^\s*(?:(?:انا|أنا|نا)\s+)?(?:(?:ال)?[اإأ]سم(?:ي)?|يسموني|سموني|سميتي|سمي)(?:\s+(?:و\s*)?(?:ال)?لقب(?:ي)?)?(?:\s+الكامل)?(?=[\s:：\-–])\s*[:：\-–]?\s*|^\s*(?:nom\s*(?:et|&)?\s*pr[ée]nom|pr[ée]nom\s*(?:et|&)?\s*nom|nom\s+complet|full\s*name|nom|pr[ée]nom|name)(?=[\s:：\-–])\s*[:：\-–]?\s*/i;
  function cleanName(v){
    let t = String(v || '').trim();
    for(let i = 0; i < 2; i++) t = t.replace(NAME_LBL, '').trim();   // « انا اسمي : … » ou étiquette répétée
    return t.replace(/^[:：\-–\s]+/, '').trim();
  }

  /* ---------- IA (relais ZR) ---------- */
  async function aiParse(text){
    if(!window.zrCall) return null;
    try{
      const j = await window.zrCall('/parse', {text});
      return j && j.ok ? j.data : null;
    }catch(e){ return null; }
  }
  function mergeAi(r, a){
    if(!a) return r;
    const I = idx();
    if(!r.phone && a.phone){ const p = String(a.phone).replace(/\+?213/, '0').replace(/\D/g, ''); if(/^0[5-7]\d{8}$/.test(p)) r.phone = p; }
    if(!r.sure.name && a.name && cleanName(a.name).length >= 2) r.name = cleanName(a.name);
    if(a.delivery === 'stopdesk') r.deliveryType = 'stopdesk';
    else if(a.delivery === 'domicile' && !STOP_RE.test(N(r._text || ''))) r.deliveryType = 'domicile';
    if(I){
      let W = null;
      if(!r.wilaya){
        if(a.wilaya_code && Number(a.wilaya_code) >= 1 && Number(a.wilaya_code) <= 58) W = I.wil.find(w => w.code === Number(a.wilaya_code));
        if(!W && a.wilaya){ const h = findIn(a.wilaya, I.wil); if(h.length) W = h[0].item; }
        if(W){ r.wilaya = W.name; r.ai = true; }
      }else W = I.wil.find(w => w.name === r.wilaya);
      if(W && r.deliveryType !== 'stopdesk' && !r.commune && a.commune){
        const h = findIn(a.commune, I.com.filter(c => c.code === W.code));
        if(h.length){ r.commune = h[0].item.fr; r.ai = true; }
      }
      if(W && r.deliveryType === 'stopdesk' && !r.officeOption && typeof officesForWilaya === 'function'){
        const offices = officesForWilaya(W.name) || [];
        const key = N(a.office || a.commune || '');
        const off = offices.length === 1 ? offices[0] : offices.find(o => key && (N(o.commune).includes(key) || key.includes(N(o.commune))));
        if(off){ r.officeOption = off.commune + ' (' + off.type + ')'; r.ai = true; }
      }
    }
    if(!r.address && a.address) r.address = String(a.address).trim();
    return r;
  }

  /* ---------- surlignage des champs remplis ---------- */
  function mark(ids){
    ['o-name', 'o-phone', 'o-wilaya', 'o-commune', 'o-address'].forEach(id => {
      const el = document.getElementById(id); if(!el) return;
      el.classList.toggle('auto-filled', ids.includes(id) && !!el.value);
      if(!el._afBound){ el._afBound = true; ['input', 'change'].forEach(ev => el.addEventListener(ev, () => el.classList.remove('auto-filled'))); }
    });
  }

  function install(){
    const old = document.getElementById('text-import-btn');
    if(!old || old._smart) return;
    const btn = old.cloneNode(true); btn._smart = true;
    old.replaceWith(btn);
    btn.addEventListener('click', async () => {
      const text = document.getElementById('text-import').value;
      const statusEl = document.getElementById('text-import-status');
      if(!text.trim()){ toast('Collez le texte du client d\'abord', true); return; }
      if(!idx()){ toast('La liste des wilayas se charge… réessayez dans 2 secondes', true); return; }
      const label = btn.textContent;
      let r = localParse(text); r._text = text;
      const needAi = !r.wilaya || (r.deliveryType !== 'stopdesk' && !r.commune) || (r.deliveryType === 'stopdesk' && !r.officeOption) || !r.phone || !r.name;
      if(needAi && window.zrCall){
        btn.disabled = true; btn.textContent = '🤖 Analyse…';
        r = mergeAi(r, await aiParse(text));
        btn.disabled = false; btn.textContent = label;
      }
      if(typeof applyImportedOrder === 'function') applyImportedOrder(r);
      { const p1 = document.getElementById('o-phone'), p2 = document.getElementById('o-phone2');
        if(p1 && !r.phone && r.phoneBad && !p1.value) p1.value = r.phoneBad;
        if(p2) p2.value = r.phone2 || ''; }
      const filled = [];
      if(r.name) filled.push('o-name'); if(r.phone) filled.push('o-phone'); if(r.wilaya) filled.push('o-wilaya');
      if(r.commune || r.officeOption) filled.push('o-commune'); if(r.address) filled.push('o-address');
      mark(filled);
      const miss = [];
      if(!r.phone) miss.push(r.phoneBad ? 'téléphone (faux/incomplet)' : 'téléphone'); if(!r.wilaya) miss.push('wilaya');
      if(r.wilaya && r.deliveryType !== 'stopdesk' && !r.commune) miss.push('commune');
      if(r.wilaya && r.deliveryType === 'stopdesk' && !r.officeOption) miss.push('bureau');
      statusEl.style.display = 'block';
      statusEl.innerHTML = (miss.length ? '⚠️ À compléter : <b>' + miss.join(', ') + '</b>. ' : '✅ ')
        + 'Les champs <span class="af-key">surlignés</span> ont été remplis automatiquement' + (r.ai ? ' (avec l\'aide de l\'IA 🤖)' : '') + ' — vérifiez-les avant d\'enregistrer.';
      clearTimeout(statusEl._t); statusEl._t = setTimeout(() => { statusEl.style.display = 'none'; }, 9000);
    });
    const st = document.createElement('style');
    st.textContent = `.auto-filled{background:#fff6d6 !important;border-color:#f2c14e !important;box-shadow:0 0 0 2px rgba(242,193,78,.25);}
      html[data-theme="dark"] .auto-filled{background:#3a3218 !important;}
      .af-key{background:#fff6d6;border:1px solid #f2c14e;border-radius:6px;padding:0 5px;color:#5a4300;}`;
    document.head.appendChild(st);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  window.smartParseOrder = localParse;
})();
