# Stake Mod Hub

Electron-App für Stake-Moderation (Live-Chat, Validate, RH, Blueprints).

## Entwicklung

```bash
npm install
npm start
```

## Lokaler Installer-Build

```bash
npm run dist
```

Ergebnis: `dist/Stake-ModHub-<version>-Setup.exe`

## Releases (GitHub)

**Kollegen laden den Setup-Installer** von [Releases](https://github.com/swqstake-bot/stake-modhub/releases):

1. `Stake-ModHub-<version>-Setup.exe` ausführen und installieren
2. Beim ersten Start legt die App `Datengrube/` neben der EXE an (Standard-Blueprints werden importiert)
3. Auto-Update läuft über `latest.yml` auf GitHub

Neues Release bauen:

1. Version in `package.json` erhöhen
2. `git tag v0.4.21 && git push origin v0.4.21`
3. GitHub Action erzeugt Setup-EXE + `latest.yml`
