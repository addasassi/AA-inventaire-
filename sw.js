// Service worker :
// 1) garde une copie de l'application sur le téléphone → elle s'ouvre tout de suite,
//    même avec une connexion lente ; la nouvelle version est récupérée en arrière-plan
//    et le bandeau « Mettre à jour » (app-update.js) la propose.
// 2) affiche les notifications locales (nouvelles commandes).
// Les données (Firebase) ne passent PAS par ici : seulement les fichiers de l'app.

const CACHE = 'atelier-app-v1';
const SHELL = ['./', 'shopify-sync.js', 'zr-bureaux.js', 'zr-sync.js', 'app-update.js', 'app-back.js', 'select-search.js', 'stats.js', 'phone-check.js', 'returns.js', 'hand.js', 'zr-suivi.js', 'order-parse.js', 'swap.js', 'verify.js', 'push.js', 'kolech-logo.png',
  'manifest.json', 'icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u =>
    fetch(u, {cache: 'no-cache'}).then(r => r.ok && c.put(stripSearch(new URL(u, self.registration.scope).href), r)).catch(() => {})
  ))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for(const k of await caches.keys()) if(k !== CACHE && k.startsWith('atelier-app-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

function stripSearch(href){ const u = new URL(href); u.search = ''; u.hash = ''; return u.href; }

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // bibliothèques versionnées (Firebase, polices) : jamais modifiées → copie locale d'abord
  if(url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net'){
    event.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if(hit) return hit;
      const r = await fetch(req);
      if(r.ok || r.type === 'opaque') c.put(req, r.clone());
      return r;
    }));
    return;
  }
  if(url.hostname === 'fonts.googleapis.com'){ event.respondWith(staleWhileRevalidate(req, req.url)); return; }
  if(!sameOrigin) return;
  // vérification de mise à jour (app-update.js) : toujours le réseau
  if(url.searchParams.has('_v')) return;
  // page + scripts de l'app : copie locale tout de suite, mise à jour en arrière-plan
  if(req.mode === 'navigate' || /\.(js|json|png|html)$/.test(url.pathname) || url.pathname.endsWith('/')){
    event.respondWith(staleWhileRevalidate(req, stripSearch(req.url)));
  }
});

async function staleWhileRevalidate(req, key){
  const c = await caches.open(CACHE);
  const hit = await c.match(key);
  const net = fetch(req.url.startsWith(self.location.origin) ? new Request(key, {cache: 'no-cache'}) : req)
    .then(r => { if(r.ok) c.put(key, r.clone()); return r; })
    .catch(() => null);
  if(hit) return hit;
  return (await net) || new Response('Hors connexion', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
}

/* 🔔 push du relais (app fermée / en arrière-plan) : le message est lu sur /push/recent */
const PUSH_API = 'https://atelier-zr.mohammedsassiadda.workers.dev';
self.addEventListener('push', (event) => { event.waitUntil(onPush()); });
async function onPush(){
  let items = [];
  try{ const r = await fetch(PUSH_API + '/push/recent', {cache: 'no-store'}); items = (await r.json()).items || []; }catch(e){}
  const c = await caches.open('atelier-push');
  let seen = [];
  try{ const h = await c.match('/seen'); if(h) seen = await h.json(); }catch(e){}
  const fresh = items.filter(x => x && x.id && !seen.includes(x.id));
  const wins = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
  const visible = wins.some(w => w.visibilityState === 'visible');   // app ouverte devant les yeux : notification discrète
  if(!fresh.length && !items.length){
    await self.registration.showNotification('Atelier Stock', {body: 'Nouvelle activité', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'atelier-activity', silent: true});
    return;
  }
  for(const x of fresh){
    await self.registration.showNotification(x.title || 'Atelier Stock', {
      body: x.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: x.id, silent: visible,
      vibrate: x.kind === 'rupture' ? [300, 150, 300, 150, 500] : [200, 100, 200], requireInteraction: x.kind === 'rupture' || x.kind === 'nrp'
    });
  }
  seen = seen.concat(fresh.map(x => x.id)).slice(-200);
  await c.put('/seen', new Response(JSON.stringify(seen), {headers: {'Content-Type': 'application/json'}}));
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
