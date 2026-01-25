PATCH do repo GitHub Pages (żeby pojawiło się „Zainstaluj aplikację”, a nie tylko skrót)

1) Wgraj do ROOT repo (tam gdzie masz index.html, app.js, style.css):
   - manifest.webmanifest
   - sw.js
   - .nojekyll
   - folder icons/ (z icon-192.png i icon-512.png)

2) Edytuj index.html:
   - w <head> wklej zawartość pliku INDEX_HEAD_SNIPPET.txt
   - przed </body> wklej zawartość pliku INDEX_SW_SNIPPET.txt

3) Po deploy (czasem 1-2 min) sprawdź w telefonie:
   https://przemo092.github.io/Nowa-/manifest.webmanifest  (ma otworzyć JSON)
   https://przemo092.github.io/Nowa-/sw.js                 (ma otworzyć kod)

4) Chrome na Androidzie:
   - usuń stary skrót
   - otwórz stronę, poczekaj 10-15 sekund
   - menu ⋮ → „Zainstaluj aplikację”
