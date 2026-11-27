/* =====================================================================
   📱 Application Android (Capacitor) — rien ne change dans le navigateur.
   Dans l'APK, la WebView n'a pas : service worker, notifications web, partage, téléchargement,
   impression. Ce fichier les remplace par les fonctions natives du téléphone, pour que le reste
   de l'app marche sans modification. Doit être chargé AVANT les autres scripts.
   ===================================================================== */
(function(){
  const C = window.Capacitor;
  if(!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  window.isNativeApp = true;
  const P = C.Plugins || {};
  const LN = P.LocalNotifications, PN = P.PushNotifications;
  document.documentElement.classList.add('native-app');
  try{ if(localStorage.getItem('notifPref') === null) localStorage.setItem('notifPref', 'on'); }catch(e){}

  // canal « Atelier Stock » : son + vibration + bandeau en haut de l'écran
  const CH = {id: 'atelier', name: 'Atelier Stock', description: 'Commandes, ruptures, Ne répond pas', importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#BC4FA0'};
  try{ (PN || LN).createChannel(CH).catch(() => {}); }catch(e){}

  /* ---------- notifications locales (remplacent new Notification / reg.showNotification) ---------- */
  const idOf = s => { let h = 2166136261; s = String(s); for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 1) || 1; };
  function localNotify(title, o){
    o = o || {};
    if(!LN) return Promise.resolve();
    return LN.schedule({notifications: [{id: idOf(o.tag || (title + Date.now())), title: String(title || 'Atelier Stock'), body: String(o.body || ''),
      channelId: 'atelier', smallIcon: 'ic_stat_notify', iconColor: '#BC4FA0', extra: {tag: o.tag || ''}}]}).catch(() => {});
  }
  let perm = 'default';
  const map = s => s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'default';
  if(LN) LN.checkPermissions().then(r => { perm = map(r.display); }).catch(() => {});
  function NativeNotification(title, opts){ localNotify(title, opts); this.close = () => {}; this.addEventListener = () => {}; }
  Object.defineProperty(NativeNotification, 'permission', {get: () => perm});
  NativeNotification.requestPermission = async (cb) => {
    try{ if(LN) perm = map((await LN.requestPermissions()).display); }catch(e){}
    if(typeof cb === 'function') cb(perm);
    return perm;
  };
  window.Notification = NativeNotification;

  /* ---------- pas de service worker dans l'APK (les fichiers viennent directement du site) ---------- */
  const fakeReg = {showNotification: localNotify, getNotifications: () => Promise.resolve([]), update: () => Promise.resolve(), unregister: () => Promise.resolve(true), active: null, pushManager: null};
  try{ const real = navigator.serviceWorker; if(real && real.getRegistrations) real.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {}); }catch(e){}
  try{
    Object.defineProperty(navigator, 'serviceWorker', {configurable: true, value: {
      register: () => Promise.resolve(fakeReg), ready: Promise.resolve(fakeReg), getRegistration: () => Promise.resolve(fakeReg),
      getRegistrations: () => Promise.resolve([]), controller: null, addEventListener(){}, removeEventListener(){}}});
  }catch(e){}

  /* ---------- fichiers : enregistrer / partager (remplace les téléchargements et navigator.share) ---------- */
  const b64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = ko; r.readAsDataURL(blob); });
  const safe = n => String(n || 'fichier').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  async function toCacheFile(blob, name){
    const r = await P.Filesystem.writeFile({path: Date.now().toString(36) + '-' + safe(name), data: await b64(blob), directory: 'CACHE'});
    return r.uri;
  }
  async function shareFiles(files, title, text){
    const uris = [];
    for(const f of files) uris.push(await toCacheFile(f, f.name));
    await P.Share.share({title: title || (files[0] && files[0].name) || 'Atelier Stock', text: text || undefined, files: uris, dialogTitle: 'Enregistrer ou envoyer'});
  }
  async function saveUrl(url, name){
    try{
      const blob = await (await fetch(url)).blob();
      await shareFiles([new File([blob], safe(name), {type: blob.type})], name);
    }catch(e){ if(!/cancel/i.test(String(e && e.message))) alert('Fichier non enregistré : ' + (e && e.message || e)); }
  }
  // les liens blob: sont souvent supprimés juste après le clic → on les garde 1 minute
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = u => setTimeout(() => revoke(u), 60000);
  const isFileLink = a => a && a.hasAttribute && a.hasAttribute('download') && /^(blob:|data:)/.test(a.href || '');
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest && e.target.closest('a');
    if(isFileLink(a)){ e.preventDefault(); e.stopPropagation(); saveUrl(a.href, a.getAttribute('download') || 'fichier'); }
  }, true);
  const aClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){ if(isFileLink(this)){ saveUrl(this.href, this.getAttribute('download') || 'fichier'); return; } return aClick.call(this); };
  if(P.Share){
    navigator.canShare = d => !!d && (!!d.files || !!d.text || !!d.url || !!d.title);
    navigator.share = async d => {
      d = d || {};
      try{
        if(d.files && d.files.length) return await shareFiles(d.files, d.title, [d.text, d.url].filter(Boolean).join('\n'));
        return await P.Share.share({title: d.title, text: d.text, url: d.url, dialogTitle: 'Partager'});
      }catch(e){ const err = new Error(String(e && e.message || e)); err.name = /cancel/i.test(err.message) ? 'AbortError' : 'Error'; throw err; }
    };
  }

  /* ---------- impression (étiquettes, bordereaux ZR) ---------- */
  if(P.Printer){
    window.print = () => { P.Printer.print({name: document.title || 'Atelier Stock'}).catch(() => {}); };
    // window.open('') + document.write(...) + print() → on imprime ce HTML directement
    const wOpen = window.open.bind(window);
    window.open = function(url, target, feat){
      if(url && url !== 'about:blank') return wOpen(url, target, feat);
      let html = '';
      const doc = {write: s => { html += s; }, writeln: s => { html += s + '\n'; }, open(){ html = ''; }, title: '',
        close(){ const h = html.replace(/onload="[^"]*print\(\)[^"]*"/i, ''); P.Printer.printHtml({html: h, base: location.href}).catch(() => {}); }};
      return {document: doc, print(){}, close(){}, focus(){}, closed: false};
    };
  }

  // touche / geste « retour » du téléphone
  // (même logique que dans le navigateur : menu, fenêtre, page précédente, Accueil, « Appuyez encore pour quitter »)
  if(P.App) P.App.addListener('backButton', () => {
    let r = 'exit';
    try{ if(typeof window.appOnBack === 'function') r = window.appOnBack(); }catch(e){}
    if(r === 'exit') P.App.minimizeApp();
  });
})();
