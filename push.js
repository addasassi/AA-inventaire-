/* ============================================================
   🔔 Abonnement aux notifications PUSH : le téléphone reçoit les ruptures, nouvelles commandes
   et « Ne répond pas 2/3 / Annulée » même quand l'app est fermée ou en arrière-plan.
   Le relais (Cloudflare) envoie le réveil, sw.js affiche la notification.
   ============================================================ */
(function(){
  const API = 'https://atelier-zr.mohammedsassiadda.workers.dev';
  const u8 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const same = (a, b) => { if(!a || !b) return false; a = new Uint8Array(a); if(a.length !== b.length) return false; for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) return false; return true; };
  const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const set = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
  let running = false;

  async function subscribe(test){
    if(running) return;
    if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if(Notification.permission !== 'granted' || get('notifPref') !== 'on') { window.pushOn = false; return; }
    running = true;
    try{
      const reg = await navigator.serviceWorker.ready;
      const {key} = await (await fetch(API + '/push/key', {cache: 'no-store'})).json();
      const appKey = u8(key);
      let sub = await reg.pushManager.getSubscription();
      if(sub && !same(sub.options && sub.options.applicationServerKey, appKey)){ try{ await sub.unsubscribe(); }catch(e){} sub = null; }
      const fresh = !sub;
      if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: appKey});
      const user = (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';
      const stale = Date.now() - Number(get('pushAt') || 0) > 3 * 86400000;
      if(fresh || test || stale || get('pushEp') !== sub.endpoint || get('pushUser') !== user){
        const r = await fetch(API + '/push/sub', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({endpoint: sub.endpoint, user, test: !!(fresh || test)})});
        if(r.ok){ set('pushEp', sub.endpoint); set('pushUser', user); set('pushAt', String(Date.now())); }
      }
      window.pushOn = true;   // l'app n'affiche plus ses propres notifications (le push le fait) → pas de doublon
    }catch(e){ window.pushOn = false; }
    running = false;
  }
  window.pushSubscribe = subscribe;

  // au démarrage, après la connexion, et quand on active les notifications
  setTimeout(() => subscribe(false), 4000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) subscribe(false); });
  document.addEventListener('change', e => { if(e.target && e.target.id === 'notif-toggle' && e.target.checked) setTimeout(() => subscribe(true), 1500); }, true);
})();
