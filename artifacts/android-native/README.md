# The Legends Online — Native Android (Kotlin + Compose)

Application Android **100% native** (pas de WebView), branchée sur le même backend que la Web App / PWA / APK Capacitor.

## État actuel — MVP

Livré dans cette première itération :

- Projet Gradle complet (Kotlin DSL), Material 3, Compose, Java 17 (Android 8.0+ — `minSdk = 26`)
- Authentification : Login + Register (JWT stocké en `EncryptedSharedPreferences` AES256-GCM, clé Keystore Android — `MasterKey.AES256_GCM`)
- Liste des conversations
- Vue chat : lecture des messages + envoi de texte
- Temps réel via Socket.io (event `new_message`, JWT passé au serveur via `IO.Options.setAuth({token})` pour matcher `socket.handshake.auth.token` côté backend)
- Push FCM **optionnel** (voir section ci-dessous)
- Pipeline CI GitHub Actions, signature en release avec le keystore existant
- DTOs Kotlin générés automatiquement depuis `lib/api-spec/openapi.yaml` via le plugin Gradle `org.openapi.generator` (configuré au préBuild) — une seule source de vérité pour le contrat API entre la Web App et le natif

## En attente (suivi par tâches dédiées)

Ces fonctionnalités existent côté Web/PWA et seront portées progressivement :

- Appels audio/vidéo Agora natifs (SDK `agora-rtc-sdk` Android)
- Upload d'images / albums / vidéos (composer média)
- Voice messages (`MediaRecorder` natif)
- Sondages, réactions, citations, transferts, traductions
- Recherche, mentions, GIF picker
- Canaux, panel admin
- Indicateur de présence et de saisie en temps réel
- Notifications de mise à jour APK (in-app updater)

## Build local

Prérequis : Android Studio Ladybug+ ou JDK 17 + Android SDK 35.

```bash
cd artifacts/android-native
# Bootstrap le wrapper si absent :
gradle wrapper --gradle-version 8.10.2 --distribution-type bin
# Debug build (pas besoin de keystore) :
./gradlew :app:assembleDebug
```

L'APK debug atterrit dans `app/build/outputs/apk/debug/app-debug.apk`.

## Build release (CI)

Le workflow `.github/workflows/build-android-native.yml` se déclenche sur tout push vers `main` qui touche `artifacts/android-native/**`, ou manuellement (`workflow_dispatch`).

Il publie l'APK signé sur la GitHub Release `native-kotlin-latest` sous le nom `The Legends Online Native.apk`.

Secrets GitHub réutilisés (déjà configurés pour le pipeline Capacitor) :

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## Push FCM — à activer manuellement (étape utilisateur)

Le module Capacitor possède son propre `google-services.json` pinné au package `social.thelegendsonline.app`. Il **ne peut pas être réutilisé** ici : le plugin `com.google.gms.google-services` rejetterait le build natif (`No matching client found for package name social.thelegendsonline.native_app`).

Le module est livré sans `google-services.json` ; le plugin gms est appliqué **conditionnellement** (`app/build.gradle.kts`), et l'init FCM côté Kotlin est gardée par `FirebaseApp.getApps(this).isEmpty()`. **L'app build et tourne sans push** en l'état — juste les notifications hors-app sont muettes.

Pour activer les push :

1. Console Firebase → projet existant → Ajouter une application Android.
2. Renseigner `social.thelegendsonline.native_app` comme nom de package.
3. Télécharger le nouveau `google-services.json` (qui contiendra désormais les deux clients : Capacitor + natif).
4. Le déposer dans `artifacts/android-native/app/google-services.json`.
5. Rebuild — le plugin gms s'applique automatiquement, `FirebaseApp` s'initialise au démarrage, `LegendsApp.registerFcmIfAuthenticated()` enregistre le token sur le serveur via `POST /api/push/fcm-register` (`platform=android`).

En CI, soit committer le `google-services.json` mis à jour (acceptable — pas de secret dedans, c'est une config publique liée au package name), soit l'injecter via un secret GitHub `GOOGLE_SERVICES_JSON_BASE64` décodé en début de job (non automatisé pour l'instant).

## Architecture

Service-locator manuel dans `LegendsApp.kt` — pas de Hilt/Koin tant que le graphe reste sous ~10 services. Couches :

- `data/api` : Retrofit + OkHttp + kotlinx.serialization (JSON)
- `data/openapi/model` : DTOs **générés** depuis `lib/api-spec/openapi.yaml` (ne pas éditer à la main — régénération à chaque build via la tâche `openApiGenerate`)
- `data/repo` : façade au-dessus des API + `TokenStore` (EncryptedSharedPreferences)
- `data/socket` : `RealtimeClient` Socket.io (mirror minimal du `socket-context.tsx` web)
- `data/fcm` : `LegendsFcmService` (dormant tant que Firebase n'est pas initialisé)
- `ui/auth`, `ui/conversations`, `ui/chat` : écrans Compose

## Coexistence avec l'APK Capacitor

L'APK Capacitor (`social.thelegendsonline.app`) reste actif et inchangé. L'APK natif utilise un `applicationId` différent (`social.thelegendsonline.native_app`) afin que les deux puissent être installés côte à côte sur le même appareil pendant la phase de migration.
