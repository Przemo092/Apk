# CMR PRO

Aplikacja PWA do wystawiania międzynarodowych listów przewozowych CMR —
stworzona przez kierowcę, dla kierowców firmy Nolan Transport.

**Na żywo:** https://przemo092.github.io/Apk/

## Struktura projektu

```
index.html            – szkielet strony, widoki (Start, CMR, Historia, Baza, Profil),
                        ekran startowy; ładuje styles.css i app.js
styles.css            – wszystkie style (splash, menu, formularz CMR, edytor, druk)
app.js                – cała logika: formularz, podpisy, PDF, druk, edytor układu,
                        historia, baza, profil, GPS, tłumaczenia, aktualizacje
manifest.webmanifest  – manifest PWA (instalacja na telefonie)
sw.js                 – service worker (network-first + cache offline)
layout.json           – oficjalny układ pól, synchronizowany na wszystkie urządzenia
android/              – pliki do zbudowania APK w Android Studio (patrz android/README.md)
```

## Wersjonowanie i aktualizacje

Numer wersji (`window.APP_BUILD`) jest w `index.html`. Przy każdej zmianie
podbij go — aplikacja przy starcie porównuje go z wersją na serwerze i sama
pobiera nowszą (czyści cache i przeładowuje się). Numer widać w zakładce
**Profil** na dole.

## Rozwój

To czysta aplikacja HTML/CSS/JS bez kroku budowania — wystarczy edytować pliki
i wypchnąć na `main`. GitHub Pages publikuje je automatycznie.

Po zmianie w `app.js` lub `styles.css` **zawsze podbij `window.APP_BUILD`**
w `index.html`, żeby urządzenia pobrały nową wersję.

© 2026 Przemek Plewka · Wszelkie prawa zastrzeżone
