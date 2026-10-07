/* =====================================================================
   Détection des mises à jour de l'application
   Vérifie toutes les 3 minutes (et au retour dans l'app) si une nouvelle
   version a été publiée. Si oui, un bandeau propose « Mettre à jour » :
   l'app se recharge avec la nouvelle version.
   ===================================================================== */
(function(){
  const FILES = [location.pathname, 'shopify-sync.js', 'zr-bureaux.js', 'zr-sync.js'];
  const base = {};
  let shown = false;

  function hash(s){ let h = 2166136261; for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h>>>0) + ':' + s.length; }
  async function get(url, mode){
    const r = await fetch(url + (mode === 'no-store' ? (url.includes('?') ? '&' : '?') + '_v=' + Date.now() : ''), {cache: mode});
    if(!r.ok) throw new Error(r.status);
    return hash(await r.text());
  }

  // Version de départ : la page (copie déjà en cache = celle affichée) + les scripts (chargés frais au démarrage)
  async function init(){
    for(const f of FILES){
      try{ base[f] = await get(f, f === FILES[0] ? 'default' : 'no-store'); }catch(e){}
    }
  }

  async function check(){
    if(shown || document.hidden || !navigator.onLine) return;
    for(const f of FILES){
      if(!base[f]) continue;
      try{
        if(await get(f, 'no-store') !== base[f]){ showBanner(); return; }
      }catch(e){}
    }
  }

  function showBanner(){
    if(shown) return;
    shown = true;
    const st = document.createElement('style');
    st.textContent = `
      #app-update{position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:99999;
        display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;border-radius:16px;
        background:#2b1a24;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:inherit;
        animation:au-in .3s ease;}
      @keyframes au-in{from{transform:translateY(30px);opacity:0;}to{transform:none;opacity:1;}}
      #app-update .au-t{flex:1;font-size:14px;font-weight:700;line-height:1.3;}
      #app-update .au-t small{display:block;font-weight:500;font-size:12px;opacity:.75;}
      #app-update button{border:none;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;}
      #app-update .au-go{background:#3ecf8e;color:#0f2a1c;padding:11px 16px;white-space:nowrap;}
      #app-update .au-x{background:transparent;color:#fff;opacity:.6;font-size:18px;padding:6px 8px;}`;
    document.head.appendChild(st);
    const bar = document.createElement('div');
    bar.id = 'app-update';
    bar.innerHTML = '<div class="au-t">🔄 Nouvelle mise à jour<small>Appuyez pour avoir la dernière version</small></div>'
      + '<button class="au-go">Mettre à jour</button><button class="au-x" aria-label="Plus tard">✕</button>';
    document.body.appendChild(bar);
    bar.querySelector('.au-go').onclick = update;
    bar.querySelector('.au-x').onclick = ()=>{ bar.remove(); shown = false; setTimeout(check, 10*60*1000); };
  }

  async function update(){
    const b = document.querySelector('#app-update .au-go');
    if(b){ b.disabled = true; b.textContent = '⏳'; }
    // remplace la copie en cache par la nouvelle avant de recharger
    try{ await fetch(FILES[0], {cache:'reload'}); }catch(e){}
    location.reload();
  }

  window.addEventListener('load', ()=> setTimeout(async ()=>{
    await init();
    setInterval(check, 3*60*1000);
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) check(); });
    window.addEventListener('online', check);
  }, 4000));
})();
