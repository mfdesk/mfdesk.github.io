# MFDesk

Publiczna strona prywatnego projektu pulpitu zdalnego MFDesk.

- Strona: https://mfdesk.github.io/
- Instalator Windows: [GitHub Releases](https://github.com/mfdesk/mfdesk.github.io/releases)
- Android: [kafelek pobierania APK alfa](https://mfdesk.github.io/#android) — Android 12+, ARM64; telefon steruje Windows. Testy fizycznego telefonu są jeszcze przed nami.
- [Prywatność](https://mfdesk.github.io/privacy/)
- [Zasady używania i ograniczenia](https://mfdesk.github.io/terms/)

Repozytorium zawiera tylko gotową, statyczną stronę informacyjną. Nie zawiera kodu aplikacji desktopowej, danych kont użytkowników, sejfów ani kluczy zdalnego dostępu. Instalatory są osobnymi plikami w GitHub Releases.

MFDesk jest w wersji testowej. Przed instalacją przeczytaj opis wydania i jego ograniczenia. Używaj aplikacji wyłącznie na własnych komputerach albo za zgodą ich właścicieli.

## Wydania i porządkowanie

Po opublikowaniu wydania (także testowego) GitHub Actions uruchamia
`release-maintenance.yml`: weryfikuje pobieranie i SHA-256 instalatora, aktualizuje
metadane przycisku pobierania i czeka na poprawną stronę GitHub Pages. Następnie
pozostawia bieżące wydanie oraz dwa poprzednie (łącznie maksymalnie trzy).
Starsze release'y wraz z plikami EXE są usuwane; tagi i historia git zostają.
Dotyczy opublikowanych wersji MFDesk beta/stabilnych/diagnostycznych, nie szkiców,
obcych wydań ani danych użytkowników. Nieoczekiwane załączniki, zmiana katalogu,
błędna suma kontrolna lub niedziałająca strona zatrzymują usuwanie.

Limit: `KEEP = 3` w `.github/scripts/release-maintenance.cjs`.
Testy bez sieci: `node --test .github/scripts/release-maintenance.test.cjs`.
Można uruchomić workflow ręcznie w Actions (ponowienie po błędzie jest bezpieczne).
Używa wyłącznie krótkotrwałego tokenu GitHub Actions dla tego repozytorium.
Nie umieszczaj tokenu publikowania ani procedury usuwania w aplikacji desktopowej.

Android używa osobnych tagów `android-v...`, plików APK oraz `android-release.json`.
Nie uczestniczy w wyborze aktualizacji ani retencji Windows (`v...`, pliki EXE).
Pobieranie jest publiczne i nie wymaga konta. Wydania alfa nie są oznaczane jako stabilne.

`release.json` zawiera wyłącznie publiczne metadane pobierania. Przy ponownym
eksporcie strony zsynchronizuj je oraz źródłowe `app/windows-release.ts` z aktualnym
wydaniem. Skrypt zmienia tylko dane instalatora w serwerowo renderowanych
`index.html` i `index.rsc`, bez zmiany designu, płatności, polityk ani aplikacji kont.
