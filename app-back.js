/* =====================================================================
   Bouton / geste « Retour » du téléphone
   Comme dans les autres applications :
   1) ferme le menu latéral s'il est ouvert,
   2) sinon ferme la fenêtre ouverte (produit, commande, couleurs…),
   3) sinon revient à l'écran précédent (« ← Retour… » de la page),
   4) sinon revient à l'Accueil,
   5) à l'Accueil : « Appuyez encore pour quitter ».
   ===================================================================== */
(function(){
  let exitArmed = false, exitTimer = null;

  const visible = el => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'
    && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);

  function closeSidebar(){
    const sb = document.getElementById('appSidebar');
    if(sb && sb.classList.contains('open')){
      sb.classList.remove('open');
      const bd = document.getElementById('sidebarBackdrop'); if(bd) bd.classList.remove('open');
      return true;
    }
    return false;
  }

  function closeTopModal(){
    const list = [...document.querySelectorAll('[id$="Modal"].show, [id$="modal"].show, .lightbox.show, .sheet.show')]
      .filter(visible);
    if(!list.length) return false;
    // la fenêtre la plus haute (z-index), sinon la dernière dans la page
    const z = el => parseInt(getComputedStyle(el).zIndex, 10) || 0;
    const m = list.sort((a, b) => z(a) - z(b) || (a.compareDocumentPosition(b) & 4 ? -1 : 1)).pop();
    // on préfère cliquer le vrai bouton Fermer/Annuler/Retour de la fenêtre (il fait le nettoyage prévu)
    const btns = [...m.querySelectorAll('button')].filter(visible);
    const btn = btns.find(b => /(^|[-_])(close|cancel|back|fermer|annuler)([-_]|$)/i.test(b.id || ''))
             || btns.find(b => /^\s*(✕|×|←|fermer|annuler|retour|close)/i.test(b.textContent || ''));
    if(btn) btn.click(); else m.classList.remove('show');
    return true;
  }

  function pageBack(){
    const view = document.querySelector('section.view.active');
    if(!view) return false;
    const backs = [...view.querySelectorAll('.back-btn')].filter(visible);
    if(!backs.length) return false;
    backs[backs.length - 1].click();
    return true;
  }

  function goHome(){
    const active = document.querySelector('section.view.active');
    if(active && active.id !== 'view-accueil'){
      const home = document.querySelector('.tab-btn[data-tab="accueil"]');
      if(home){ home.click(); window.scrollTo(0, 0); return true; }
    }
    return false;
  }

  function onBack(){
    // écran de connexion : on laisse le téléphone fermer l'application
    const appVisible = document.querySelector('section.view.active');
    if(!appVisible || !visible(appVisible)) return 'exit';
    if(closeSidebar() || closeTopModal() || pageBack() || goHome()){ exitArmed = false; return 'handled'; }
    if(exitArmed) return 'exit';
    exitArmed = true;
    clearTimeout(exitTimer); exitTimer = setTimeout(() => exitArmed = false, 2000);
    if(typeof toast === 'function') toast('Appuyez encore pour quitter');
    return 'handled';
  }

  /* Historique : base (0) + quelques « marches » (1..DEPTH) au-dessus.
     Chrome ignore les marches ajoutées sans geste de l'utilisateur (sur téléphone, un toucher
     ne compte qu'à la fin : click / touchend). On n'ajoute donc des marches QUE pendant un geste,
     jamais dans le gestionnaire « retour », et on en garde plusieurs d'avance pour enchaîner
     plusieurs « retour » sans toucher l'écran entre deux. */
  const DEPTH = 4;
  const level = () => (history.state && history.state.atelierLvl) || 0;

  function topUp(){
    try{
      if(!(history.state && 'atelierLvl' in history.state)) history.replaceState({atelierLvl: 0}, '');
      for(let l = level() + 1; l <= DEPTH; l++) history.pushState({atelierLvl: l}, '');
    }catch(e){}
  }

  window.addEventListener('popstate', () => {
    if(onBack() === 'exit'){ history.go(-(level() + 1)); return; }   // quitte l'application
    // pas de pushState ici (il serait ignoré par Chrome) : on recomplète au prochain toucher
  });

  ['click', 'touchend', 'keydown'].forEach(ev =>
    document.addEventListener(ev, () => { if(level() < DEPTH) topUp(); }, true));
})();
