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

## Releases (GitHub)

**Kollegen laden das ZIP** von [Releases](https://github.com/swqstake-bot/stake-modhub/releases) — nicht die alte Einzel-EXE.

1. ZIP entpacken  
2. `START.bat` oder `Stake Mod Hub.exe` im Ordner starten  

Neues Release bauen:

1. Version in `package.json` erhöhen  
2. `git tag v0.3.2 && git push origin v0.3.2`  
3. GitHub Action erzeugt `Stake-ModHub-v…-Windows.zip`

Lokal: `npm run dist` → `dist/Stake-ModHub-v…-Windows.zip`
