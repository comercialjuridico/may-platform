#!/bin/bash
# ─── Build APK do May para Android ───────────────────────────────────────────
# Pré-requisitos: Android Studio instalado, JAVA_HOME configurado
# Rode: chmod +x build-android.sh && ./build-android.sh

set -e
echo "📱 Iniciando build do May para Android..."

# 1. Inicializa o Capacitor (só precisa rodar uma vez)
if [ ! -d "android" ]; then
  echo "→ Adicionando plataforma Android..."
  npx cap add android
fi

# 2. Sincroniza o web com o Android
echo "→ Sincronizando..."
npx cap sync android

# 3. Build do APK debug (para testar)
echo "→ Gerando APK..."
cd android && ./gradlew assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "✅ APK gerado com sucesso!"
echo "📁 Caminho: android/$APK_PATH"
echo ""
echo "Para instalar no celular conectado via USB:"
echo "  adb install android/$APK_PATH"
echo ""
echo "Para gerar APK de release (Play Store):"
echo "  cd android && ./gradlew bundleRelease"
