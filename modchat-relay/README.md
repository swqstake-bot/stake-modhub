# ModChat Relay

Kleiner WebSocket-Server für den ModHub Team-Chat (nur DE-Mods).

## Schnellstart (LAN)

```bash
npm install
node server.js
```

Windows: `start-relay.bat` · Port **3847**

ModHub Settings: `ws://192.168.178.177:3847`

## Cloudflare Tunnel (Remote-Mods, kein Port-Freigeben nötig)

1. Relay starten: `node server.js` (Port 3847)
2. **Zweites** Tunnel-Fenster (oder Ingress auf 3847):

```bash
cloudflared tunnel --url http://127.0.0.1:3847
```

3. Ausgabe z. B. `https://gratis-automatically-ministry-measurements.trycloudflare.com`
4. **Alle Mods** in ModHub Settings eintragen:

   - Server: `wss://gratis-automatically-ministry-measurements.trycloudflare.com`
   - **wss** (nicht ws), **kein** `/` am Ende

5. **Sicherheit (Pflicht bei öffentlicher URL):** gemeinsames Token setzen

```bash
set MODCHAT_TOKEN=euer-geheimes-passwort
node server.js
```

Gleiches Token in ModHub → Settings → Mod-Chat Token (alle vier Mods).

**Hinweis:** `trycloudflare.com`-URLs sind temporär — bei jedem `cloudflared`-Neustart neue URL. Für dauerhaft: Named Tunnel in Cloudflare Dashboard.

## Erlaubte Mods

`swaqline`, `droz`, `wheelyboy321`, `kartenstapel` — in `config.js`

## Firewall (nur LAN ohne Tunnel)

TCP **3847** eingehend auf dem Relay-PC, wenn andere Rechner im WLAN direkt `192.168.178.177` nutzen.

## Logs

- `[modchat] + swaqline` — verbunden
- `[modchat] REJECTED name=…` — Name nicht in Whitelist
- `[modchat] REJECTED bad token` — falsches MODCHAT_TOKEN
- Kein Log bei Verbindungsversuch — Client erreicht Relay nicht (falsche URL / Tunnel zeigt woanders hin)
