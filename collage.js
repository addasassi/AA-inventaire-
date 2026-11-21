/* ============================================================
   🧩 Collage numéroté des modèles disponibles (pour Messenger)
   - seulement les photos en stock (> 0), produit + couleurs
   - 12 modèles maximum par image ; s'il y en a plus → plusieurs images
   - chaque modèle : un grand numéro (1, 2, 3…) + le prix
   - logo كلش 100 ألف + nom de la catégorie en haut
   La cliente répond « رقم 5 » et on retrouve le modèle sur le même collage.
   ============================================================ */
(function(){
  const PER = 12, COLS = 3;
  const W = 1440, PAD = 28, GAP = 18;
  const TW = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);
  const TH = Math.round(TW * 4 / 3);          // cases verticales (vêtements)
  const HEAD = 230;
  const PINK = '#b8459f', PLUM = '#3a2632', CREAM = '#fbf6f3';
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif';

  function rr(g, x, y, w, h, r){
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function drawCover(g, im, x, y, w, h){
    const k = Math.max(w / im.width, h / im.height);
    const sw = w / k, sh = h / k;
    const sx = (im.width - sw) / 2, sy = Math.max(0, (im.height - sh) * 0.35);   // un peu vers le haut
    g.drawImage(im, sx, sy, sw, sh, x, y, w, h);
  }

  async function makeCollage(cat, items, startNum, page, pages){
    const rows = Math.ceil(items.length / COLS);
    const H = HEAD + PAD + rows * TH + (rows - 1) * GAP + PAD;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.fillStyle = CREAM; g.fillRect(0, 0, W, H);

    /* ---- en-tête : logo + catégorie ---- */
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, HEAD);
    g.fillStyle = PINK; g.fillRect(0, HEAD - 8, W, 8);
    const logo = await getBrandLogo();
    const ls = 170, lx = PAD, ly = (HEAD - 8 - ls) / 2;
    if(logo){
      g.save(); g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 14;
      g.beginPath(); g.arc(lx + ls / 2, ly + ls / 2, ls / 2, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.restore();
      g.drawImage(logo, lx, ly, ls, ls);
    }
    const tx = lx + ls + 34;
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = PLUM;
    g.font = '800 70px ' + FONT;
    let title = cat;
    while(g.measureText(title).width > W - tx - PAD - 150 && title.length > 4) title = title.slice(0, -2);
    if(title !== cat) title += '…';
    g.fillText(title, tx, HEAD * 0.38);
    g.fillStyle = PINK; g.font = '700 44px ' + FONT;
    g.fillText('ابعثيلنا رقم الموديل', tx, HEAD * 0.72);
    if(pages > 1){
      g.textAlign = 'right'; g.fillStyle = PLUM; g.font = '800 48px ' + FONT;
      g.fillText(page + '/' + pages, W - PAD, HEAD * 0.38);
    }

    /* ---- les modèles ---- */
    for(let i = 0; i < items.length; i++){
      const x = PAD + (i % COLS) * (TW + GAP);
      const y = HEAD + PAD + Math.floor(i / COLS) * (TH + GAP);
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.12)'; g.shadowBlur = 12; g.shadowOffsetY = 4;
      rr(g, x, y, TW, TH, 22); g.fillStyle = '#fff'; g.fill();
      g.restore();
      g.save(); rr(g, x, y, TW, TH, 22); g.clip();
      try{ drawCover(g, await loadImg(await fullImg(items[i].obj)), x, y, TW, TH); }
      catch(e){ g.fillStyle = '#e3c9c2'; g.fillRect(x, y, TW, TH); }
      g.restore();

      // grand numéro en haut à gauche
      const n = String(startNum + i);
      const d = 132, cx = x + 16 + d / 2, cy = y + 16 + d / 2;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 14; g.shadowOffsetY = 4;
      g.beginPath(); g.arc(cx, cy, d / 2, 0, Math.PI * 2); g.fillStyle = PINK; g.fill(); g.restore();
      g.beginPath(); g.arc(cx, cy, d / 2 - 4, 0, Math.PI * 2); g.lineWidth = 7; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 ' + (n.length > 2 ? 62 : 78) + 'px ' + FONT;
      g.fillText(n, cx, cy + 4);

      // prix en bas
      const label = Math.round(Number(items[i].price) || 0) + ' DA';
      g.font = '800 50px ' + FONT;
      const bw = g.measureText(label).width + 56, bh = 78;
      const bx = x + (TW - bw) / 2, by = y + TH - bh - 18;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 12; g.shadowOffsetY = 3;
      rr(g, bx, by, bw, bh, bh / 2); g.fillStyle = '#fff'; g.fill(); g.restore();
      g.fillStyle = PLUM; g.fillText(label, x + TW / 2, by + bh / 2 + 3);
    }
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));
    return blob;
  }

  async function prepareCollages(cats, btn){
    const groups = cats.map(c => ({cat: c, list: availablePhotos(c, false)})).filter(x => x.list.length);
    if(!groups.length){ toast('Aucun modèle disponible (stock à 0)', true); return; }
    const old = btn.textContent; btn.disabled = true; btn.textContent = '⏳ Préparation du collage...';
    try{
      const files = [];
      const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '');
      for(const grp of groups){
        // 12 modèles par image ; le reste passe sur l'image suivante
        const pages = Math.ceil(grp.list.length / PER);
        const per = PER;
        for(let pg = 0; pg < pages; pg++){
          btn.textContent = '⏳ ' + grp.cat + ' ' + (pg + 1) + '/' + pages + '...';
          const part = grp.list.slice(pg * per, pg * per + per);
          try{
            const blob = await makeCollage(grp.cat, part, pg * per + 1, pg + 1, pages);
            const f = new File([blob], 'collage-' + slugForFilename(grp.cat) + '-' + stamp + '-' + (pg + 1) + '.jpg', {type: 'image/jpeg'});
            f.catName = grp.cat; files.push(f);
          }catch(e){}
        }
      }
      if(!files.length){ toast('Erreur de préparation du collage', true); return; }
      shareQueue = files;
      shareZipName = cats.length === 1 ? ('Collage ' + cats[0]) : ('Collages A&A ' + stamp);
      showShareNext();
    }finally{ btn.textContent = old; btn.disabled = false; }
  }
  window.prepareCollages = prepareCollages;

  /* bouton dans une catégorie */
  const anchor = document.getElementById('btn-share-available');
  if(anchor){
    const b = document.createElement('button');
    b.className = 'btn-primary'; b.id = 'btn-collage-cat'; b.style.width = '100%';
    b.textContent = '🧩 Collage numéroté (disponibles + prix)';
    anchor.insertAdjacentElement('afterend', b);
    b.addEventListener('click', () => {
      if(typeof currentStockFilterType !== 'undefined' && currentStockFilterType){ toast('Ouvrez une catégorie', true); return; }
      prepareCollages([document.getElementById('catProductsTitle').textContent], b);
    });
  }

  /* bouton sur la page des catégories : un collage par catégorie */
  if(typeof renderCatFolders === 'function'){
    const orig = renderCatFolders;
    window.renderCatFolders = renderCatFolders = function(){
      orig.apply(this, arguments);
      const wrap = document.getElementById('catFolders');
      if(!wrap || wrap.querySelector('#btn-collage-all')) return;
      const b = document.createElement('button');
      b.className = 'btn-primary'; b.id = 'btn-collage-all';
      b.style.cssText = 'width:100%;margin:0 0 12px;';
      b.textContent = '🧩 Collages numérotés — toutes les catégories';
      b.onclick = () => prepareCollages(CATS.slice(), b);
      const grid = wrap.querySelector('.folder-grid');
      wrap.insertBefore(b, grid || null);
    };
    try{ if(document.getElementById('catFolders').innerHTML) renderCatFolders(); }catch(e){}
  }
})();
