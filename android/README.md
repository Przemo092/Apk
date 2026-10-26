# CMR PRO — budowa aplikacji APK w Android Studio

Aplikacja webowa (`index.html`, `styles.css`, `app.js`, `manifest.webmanifest`,
`sw.js`, `layout.json`) jest kompletna i działa w przeglądarce. Poniżej krok po
kroku, jak zapakować ją w plik APK przez **Android Studio** (metoda WebView —
aplikacja działa też offline, bo pliki są wbudowane).

## Wymagania
- Android Studio (najnowsze, np. Ladybug)
- Zainstalowany Android SDK (API 34+)

## Krok 1 — nowy projekt
1. Android Studio → **New Project** → **Empty Views Activity** → **Next**
2. Ustaw:
   - **Name:** `CMR PRO`
   - **Package name:** `com.przemekplewka.cmrpro`
   - **Language:** Java
   - **Minimum SDK:** API 24 (Android 7.0)
3. **Finish** i poczekaj aż Gradle zsynchronizuje projekt.

## Krok 2 — podmień pliki
1. **MainActivity** — otwórz `app/src/main/java/com/przemekplewka/cmrpro/MainActivity.java`
   i zastąp jego całą zawartość plikiem `android/MainActivity.java` z tego repo.
2. **Manifest** — otwórz `app/src/main/AndroidManifest.xml` i zastąp go plikiem
   `android/AndroidManifest.xml` z tego repo (dodaje uprawnienia: internet,
   lokalizacja, zapis pliku).

## Krok 3 — wgraj pliki aplikacji webowej (assets)
1. W panelu **Project** kliknij prawym na `app/src/main` → **New → Directory** →
   nazwij katalog `assets`.
2. Skopiuj do `app/src/main/assets/` **te pliki z tego repo**:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `manifest.webmanifest`
   - `layout.json`
   - `sw.js`
   - **cały katalog `vendor/`** (html2canvas, jsPDF, pdf.js + worker — PDF
     działa wtedy bez internetu)
   - (opcjonalnie ikony, jeśli używasz)

   Dodatkowo (FileProvider do udostępniania PDF): skopiuj
   `android/file_paths.xml` do `app/src/main/res/xml/file_paths.xml`
   (utwórz katalog `xml`, jeśli go nie ma). Projekt musi mieć zależność
   `androidx.core` (jest domyślnie w szablonie *Empty Views Activity*).

   > Uwaga: `MainActivity.java` ładuje `file:///android_asset/index.html`.
   > Jeśli wolisz zawsze najnowszą wersję z internetu, w `MainActivity.java`
   > zamień tę linię na `web.loadUrl("https://przemo092.github.io/Apk/");`

## Krok 4 — ikona (opcjonalnie)
Prawym na `app` → **New → Image Asset** → wybierz obrazek logo → **Finish**.

## Krok 5 — zbuduj APK
1. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Po zakończeniu kliknij **locate** — plik `app-debug.apk` możesz zainstalować
   na telefonie (włącz „Instalowanie z nieznanych źródeł").

## Krok 6 — wersja podpisana (do publikacji)
**Build → Generate Signed Bundle / APK → APK** → utwórz keystore → zbuduj
`app-release.apk`. Ten plik nadaje się do udostępniania lub Google Play.

---

## Uwagi techniczne
- **localStorage** działa (WebView ma włączone `setDomStorageEnabled(true)`),
  więc profil, układ, historia i baza są zapamiętywane w aplikacji.
- **GPS** (pola lokalizacji, firmy w pobliżu) wymaga zgody na lokalizację —
  aplikacja poprosi przy pierwszym uruchomieniu.
- **PDF / udostępnianie** — WebView nie obsługuje `blob:` w `DownloadListener`
  ani Web Share API z plikami, dlatego `MainActivity` udostępnia JS-owi most
  `window.AndroidBridge` (`beginFile` → `appendChunk` × N → `finishFile`).
  Android 10+: PDF trafia do **Pobranych** przez MediaStore (bez uprawnień do
  pamięci) i od razu otwiera się okno „Udostępnij” (FileProvider). Android 7–9:
  tylko okno „Udostępnij” (stamtąd można zapisać plik).
- **Wgrywanie skanu/podpisu** — obsługuje `onShowFileChooser` (wybór pliku/zdjęcia).
- Biblioteki PDF są wbudowane lokalnie (`vendor/`), więc generowanie i import
  PDF działają offline. `INTERNET` jest potrzebny tylko do GPS-owych podpowiedzi
  firm (OpenStreetMap). Ruch HTTP (cleartext) jest wyłączony.
- Eksport backupu / CSV / `layout.json` używa jeszcze linków `blob:` — w APK
  nie zadziałają, dopóki nie zostaną przepięte na `AndroidBridge` (osobne zadanie).

## Podgląd wersji
Numer wersji aplikacji widać w zakładce **Profil** na dole
(np. `Wersja aplikacji: B-2026-07-03-05`).

© 2026 Przemek Plewka
