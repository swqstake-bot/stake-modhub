# Stake Mod Hub

Electron-App für Stake-Moderation (Live-Chat, Validate, RH, Blueprints).

## Entwicklung

```bash
npm install
npm start
```

## Kollegen-Paket (lokal, ohne Auto-Update-Metadaten)

```bash
npm run dist
```

Ergebnis: `dist/Stake-ModHub-v0.3.0-Windows.zip`

## Releases & Auto-Update

Die installierte App nutzt [electron-updater](https://www.electron.build/auto-update) und lädt Updates von **GitHub Releases** (`swqstake-bot/stake-modhub`).

1. Version in `package.json` erhöhen (z. B. `0.3.1`)
2. Tag pushen: `git tag v0.3.1 && git push origin v0.3.1`
3. GitHub Action baut Windows-Portable und veröffentlicht `latest.yml` + EXE

Manuell (mit `GH_TOKEN`):

```bash
npm run dist:publish
```

Kollegen: App starten → bei neuem Release erscheint ein Dialog; unter **Settings → Nach Updates suchen** manuell prüfen.
