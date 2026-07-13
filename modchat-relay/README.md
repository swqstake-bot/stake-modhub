# ModChat Relay

Kleiner WebSocket-Server für den ModHub Team-Chat (nur DE-Mods).

## Schnellstart

```bash
npm install
node server.js
```

Windows: `start-relay.bat` · Port **3847**

## Cloudflare Tunnel

```bash
node server.js
cloudflared tunnel --url http://127.0.0.1:3847
```

ModHub (Standard): `wss://announcement-anaheim-filled-ripe.trycloudflare.com`

## Erlaubte Mods

`swaqline`, `droz`, `wheelyboy321`, `kartenstapel` — in `config.js`

## Automute-Hierarchie (Team)

In `config.js` → `AUTOMUTE_EXECUTOR_HIERARCHY` (höchste Priorität zuerst):

```js
['swaqline', 'kartenstapel', 'droz', 'wheelyboy321']
```

Wenn mehrere Mods **Live-Automute** haben: nur der **erste Online-Mod** aus dieser Liste führt Mutes aus. Strike-Zähler liegen zentral auf dem Relay (`automute-strikes-shared.json`).

Nach Änderung: Relay neu starten (`node server.js`).

## Firewall (nur direktes LAN)

```powershell
New-NetFirewallRule -DisplayName "ModHub ModChat" -Direction Inbound -Protocol TCP -LocalPort 3847 -Action Allow -Profile Private
```

Mit Cloudflare-Tunnel ist keine Port-Freigabe nötig.
