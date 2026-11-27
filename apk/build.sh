#!/usr/bin/env bash
# Construit l'APK (installation directe) + l'AAB (Play Store), signés avec la clé de l'app.
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
rm -rf android
npx cap add android
node patch.mjs
npx cap sync android
if [ -z "${ANDROID_KEY_PASS:-}" ]; then
  # pas encore de clé : on vérifie seulement que l'app se construit (APK de test, non publié)
  (cd android && chmod +x gradlew && ./gradlew --no-daemon assembleDebug)
  echo "❌ Secret GitHub ANDROID_KEY_PASS manquant (Settings → Secrets → Actions) : APK non publié"; exit 1
fi
openssl enc -d -aes-256-cbc -pbkdf2 -in release.jks.enc -out "$RUNNER_TEMP/release.jks" -pass env:ANDROID_KEY_PASS
cd android
chmod +x gradlew
SIGN="-Pandroid.injected.signing.store.file=$RUNNER_TEMP/release.jks -Pandroid.injected.signing.store.password=$ANDROID_KEY_PASS -Pandroid.injected.signing.key.alias=atelier -Pandroid.injected.signing.key.password=$ANDROID_KEY_PASS"
./gradlew --no-daemon assembleRelease bundleRelease $SIGN
mkdir -p ../out
cp app/build/outputs/apk/release/app-release.apk ../out/AtelierStock.apk
cp app/build/outputs/bundle/release/app-release.aab ../out/AtelierStock.aab
ls -la ../out
