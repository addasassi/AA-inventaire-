// Prépare le projet Android généré par « npx cap add android » :
// icônes, écran de démarrage, autorisations, notifications, Firebase, numéro de version.
// Lancé par .github/workflows/apk.yml (dossier courant : apk/).
import fs from 'node:fs';
import path from 'node:path';

const A = 'android/app';
const RES = A + '/src/main/res';
const MANIFEST = A + '/src/main/AndroidManifest.xml';

function copyDir(src, dst){
  fs.mkdirSync(dst, {recursive: true});
  for(const f of fs.readdirSync(src)){
    const s = path.join(src, f), d = path.join(dst, f);
    if(fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// 1) icônes (lanceur + petite icône blanche des notifications)
for(const d of fs.readdirSync(RES)){
  // on enlève les icônes et l'écran de démarrage par défaut de Capacitor
  const dir = path.join(RES, d);
  for(const f of fs.readdirSync(dir)) if(/^(ic_launcher.*|splash)\.(png|webp|xml)$/.test(f)) fs.rmSync(path.join(dir, f));
}
copyDir('res', RES);

// 2) écran de démarrage : fond prune + logo au milieu
fs.mkdirSync(RES + '/drawable', {recursive: true});
fs.writeFileSync(RES + '/drawable/splash.xml', `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/ic_launcher_background"/>
  <item android:width="160dp" android:height="160dp" android:gravity="center" android:drawable="@mipmap/ic_launcher_round"/>
</layer-list>
`);
// Android 12+ : écran de démarrage système (couleur + icône)
const styles = RES + '/values/styles.xml';
let st = fs.readFileSync(styles, 'utf8');
st = st.replace(/(<style name="AppTheme.NoActionBarLaunch"[^>]*>)/, `$1
        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>`);
fs.writeFileSync(styles, st);

// 3) autorisations + canal de notification par défaut + petite icône
let m = fs.readFileSync(MANIFEST, 'utf8');
const perms = ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE',
  'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.WAKE_LOCK'];
for(const p of perms) if(!m.includes(`"${p}"`)) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
if(!m.includes('android.hardware.camera')) m = m.replace('</manifest>', '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>');
m = m.replace(/<application([^>]*)>/, (all, attrs) => `<application${attrs}>
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="atelier" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_notify" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/notif_color" />`);
fs.writeFileSync(MANIFEST, m);
fs.writeFileSync(RES + '/values/notif_color.xml', '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="notif_color">#BC4FA0</color>\n</resources>\n');

// 3b) code Java : impression + enregistrement du module
const JAVA = A + '/src/main/java/com/aavetements/atelierstock';
fs.mkdirSync(JAVA, {recursive: true});
for(const f of fs.readdirSync('java')) fs.copyFileSync('java/' + f, JAVA + '/' + f);

// 4) Firebase (notifications push)
if(fs.existsSync('google-services.json')){ fs.copyFileSync('google-services.json', A + '/google-services.json'); console.log('google-services.json ✔'); }
else console.log('⚠️ google-services.json absent : l\'APK marche, mais sans notifications push');

// 5) numéro de version (augmente à chaque construction → la mise à jour s'installe par-dessus)
const run = Number(process.env.GITHUB_RUN_NUMBER || 1);
const g = A + '/build.gradle';
let b = fs.readFileSync(g, 'utf8');
b = b.replace(/versionCode\s+\d+/, 'versionCode ' + (100 + run)).replace(/versionName\s+"[^"]*"/, `versionName "1.0.${run}"`);
fs.writeFileSync(g, b);
console.log('version 1.0.' + run);
