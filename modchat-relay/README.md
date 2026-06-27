# ModChat Relay

Kleiner WebSocket-Server für den ModHub Team-Chat (nur DE-Mods).

## Schnellstart

```bash
npm install
node server.js
```

Windows: `start-relay.bat`

Standard-Port: **3847** (`ws://192.168.178.177:3847`)

## Erlaubte Mods

`swaqline`, `droz`, `wheelyboy321`, `kartenstapel` — in `config.js` anpassbar.

## Deploy

Nur den Ordner `modchat-relay/` auf den Server kopieren (enthält alles Nötige):

- `server.js`
- `config.js`
- `package.json`

Dann `npm install` und `node server.js`. **Firewall:** TCP **3847** eingehend im LAN freigeben.

Optional: `MODCHAT_PORT=3847 node server.js`

## Remote-Mods (nicht im gleichen WLAN)

`192.168.178.x` ist nur im lokalen Netz erreichbar. Mods von unterwegs brauchen z. B. **Tailscale** auf dem Relay-Server und in ModHub unter Settings die Tailscale-IP eintragen (`ws://100.x.x.x:3847`).

Bei Verbindungsproblemen im Relay-Fenster: `[modchat] REJECTED …` = falscher Name; kein Log = Client kommt gar nicht an (Firewall/VPN).
