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

  let subscribe = async function(test){
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
  };
  /* 📱 APK (Capacitor) : vraies notifications Android (Firebase Cloud Messaging), affichées par le
     téléphone lui-même → instantanées et même quand l'app est fermée */
  let nativeReady = false, nativeTest = false;
  async function nativeSubscribe(test){
    const PN = window.Capacitor.Plugins.PushNotifications;
    if(!PN) return;
    if(get('notifPref') !== 'on'){ window.pushOn = false; return; }
    if(running) return;
    running = true;
    try{
      let p = await PN.checkPermissions();
      if(p.receive === 'prompt' || p.receive === 'prompt-with-rationale') p = await PN.requestPermissions();
      if(p.receive !== 'granted'){ window.pushOn = false; running = false; return; }
      if(!nativeReady){
        nativeReady = true;
        await PN.addListener('registration', async t => {
          const user = (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';
          const stale = Date.now() - Number(get('pushAt') || 0) > 3 * 86400000;
          const fresh = get('pushFcm') !== t.value;
          if(!(fresh || nativeTest || stale || get('pushUser') !== user)) return;
          try{
            const r = await fetch(API + '/push/sub', {method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({fcm: t.value, user, test: !!(fresh || nativeTest)})});
            if(r.ok){ set('pushFcm', t.value); set('pushUser', user); set('pushAt', String(Date.now())); }
          }catch(e){}
          nativeTest = false;
        });
        await PN.addListener('registrationError', () => { window.pushOn = false; });
      }
      nativeTest = nativeTest || !!test;
      await PN.register();
      window.pushOn = true;   // le téléphone affiche les notifications du relais (même app ouverte) → l'app n'en ajoute pas
    }catch(e){ window.pushOn = false; }
    running = false;
  }
  if(window.isNativeApp){ subscribe = nativeSubscribe; }
  window.pushSubscribe = subscribe;
  /* 🔔 demande au relais d'envoyer TOUT DE SUITE (sans attendre son passage de chaque minute) */
  let nowT = null;
  window.pushNow = () => { clearTimeout(nowT); nowT = setTimeout(() => { fetch(API + '/push/now', {method: 'POST', keepalive: true}).catch(() => {}); }, 400); };
  /* l'app (ouverte) vient d'afficher elle-même une notification avec son son → le push du relais
     pour le même type (rupture / commande / nrp), qui arrive jusqu'à 1 minute après, n'est pas répété ici */
  window.pushMute = async (kind) => {
    try{
      const c = await caches.open('atelier-push');
      let m = {}; const h = await c.match('/mute'); if(h) m = await h.json();
      m[kind] = Date.now() + 90 * 1000;
      await c.put('/mute', new Response(JSON.stringify(m), {headers: {'Content-Type': 'application/json'}}));
    }catch(e){}
  };

  // au démarrage, après la connexion, et quand on active les notifications
  setTimeout(() => subscribe(false), 4000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) subscribe(false); });
  document.addEventListener('change', e => { if(e.target && e.target.id === 'notif-toggle' && e.target.checked) setTimeout(() => subscribe(true), 1500); }, true);
})();
