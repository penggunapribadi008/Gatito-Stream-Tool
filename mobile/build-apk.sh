#!/bin/bash
# Semua langkah build APK ada di sini, supaya build.yml tidak perlu diubah-ubah lagi.
set -e
npm install
mkdir -p www
JQ=$(find node_modules/jsqr -name jsQR.js | head -n 1)
if [ -n "$JQ" ]; then cp "$JQ" www/jsQR.js; fi
test -s www/jsQR.js || { echo "jsQR.js tidak ditemukan"; exit 1; }
npx cap add android
M=android/app/src/main/AndroidManifest.xml
grep -q 'permission.CAMERA' "$M" || sed -i 's#</manifest>#    <uses-permission android:name="android.permission.CAMERA" />\n</manifest>#' "$M"
D=android/app/src/main/java/com/streamdeckhp/app
mkdir -p "$D"
cp native/MainActivity.java "$D/MainActivity.java"
cp -r android-res/. android/app/src/main/res/
npx cap sync android
cd android
chmod +x gradlew
sed -i "s/versionCode 1/versionCode ${GITHUB_RUN_NUMBER:-1}/" app/build.gradle || true
if [ -n "$KEYSTORE_B64" ] && [ -n "$KEYSTORE_PASSWORD" ]; then
  echo "Membuat APK rilis yang ditandatangani"
  ./gradlew assembleRelease
  echo "$KEYSTORE_B64" | base64 -d > /tmp/sd.keystore
  BT=$(ls -d "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/* | sort -V | tail -n 1)
  UNS=$(ls app/build/outputs/apk/release/*.apk | head -n 1)
  "$BT/zipalign" -f -p 4 "$UNS" /tmp/aligned.apk
  "$BT/apksigner" sign --ks /tmp/sd.keystore --ks-key-alias streamdeckhp --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEYSTORE_PASSWORD --out ../StreamDeckHP.apk /tmp/aligned.apk
  "$BT/apksigner" verify ../StreamDeckHP.apk
else
  echo "Kunci belum diisi, membuat APK debug"
  ./gradlew assembleDebug
  cp app/build/outputs/apk/debug/app-debug.apk ../StreamDeckHP.apk
fi
