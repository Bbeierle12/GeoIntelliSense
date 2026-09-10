# Self-hosting the backend on Windows

Notes from setting the stack up on Windows 11 with Docker Desktop and reaching
it from a phone over Tailscale. Everything here is a trap that cost real time.

## Line endings will break the database

`git` on Windows defaults to `core.autocrlf=true`. That checks `db/init/02-migrations.sh`
out with CRLF endings, and Postgres — which runs it inside a Linux container —
fails with:

```
/docker-entrypoint-initdb.d/02-migrations.sh: /bin/bash^M: bad interpreter
```

The container still starts and reports healthy, but **no migrations run**, so
every table is missing and the services log `relation "sensor_readings" does not
exist` forever.

`.gitattributes` now pins `*.sh` to LF, so a fresh clone is fine. If you hit it
on an existing clone:

```powershell
git rm --cached -r .
git reset --hard
```

## First boot needs longer than the healthcheck allowed

Initialising a fresh `pgdata` volume takes more than the 30 s `start_period` the
db healthcheck originally used, so `ingestion` and `gateway` gave up with
`dependency failed to start: container geointellisense-db is unhealthy`. Running
`docker compose up -d` a second time fixed it. `start_period` is now 90 s.

## Data sources default to OFF

Every source is off until switched on in Redis, so a correctly configured key
still returns `503 ... source is disabled`. Set `ADMIN_TOKEN` in `.env`, then:

```powershell
curl -X POST -H "X-Admin-Token: $env:ADMIN_TOKEN" http://localhost:8080/api/admin/sources/purpleair/enable
```

Without `ADMIN_TOKEN` the admin endpoints return 401 and the only way in is
editing Redis directly:

```powershell
docker exec geointellisense-redis redis-cli set geointelli:source-toggle:purpleair 1
```

## Docker Desktop needs a signed-in session

Docker Desktop runs inside your user session, not as a service. After a reboot
the stack comes back **once you sign in to Windows**, not at boot. The
containers use `restart: unless-stopped` and recover on their own from there —
but only once the engine exists, and the engine only exists once Docker Desktop
is running.

**Do not rely on Docker Desktop's own autostart.** Enabling *Settings > General
> Start Docker Desktop when you sign in* is not enough. On 2026-09-09 this
machine rebooted at 14:20 and the user signed in at 14:25 with the Run key
present, its Task Manager entry enabled, and `AutoStart: true` in
`settings-store.json` — and Docker Desktop wrote no log line at all. Only
`com.docker.service` (the privileged helper) was up; the `docker-desktop` WSL
distro was Stopped and the engine named pipe did not exist. The backend stayed
down for 2h47m and nothing reported it. The phone just read *Disconnected*.

`scripts/ensure-backend.ps1` is the guard. It waits for the engine, starts
Docker Desktop itself if nothing else did, retries for up to ten minutes, runs
`docker compose up -d`, polls `/health`, checks that both `tailscale serve`
listeners are present, and writes the result to
`Documents\GeoIntelliSense-setup-logs\startup.log`. Install it by putting a
shortcut in the Startup folder (`Win+R` → `shell:startup`) pointing at:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "<repo>\scripts\ensure-backend.ps1"
```

Delete that shortcut to remove it — it touches nothing else. Run it by hand any
time the phone says *Disconnected*; it is idempotent. **After any reboot, read
the log before assuming the stack is up.**

Set the machine's sleep timeout to Never on AC, or the backend disappears
whenever the desk is quiet.

## Reaching it from the phone over Tailscale

`npm run phone:urls` prints every address the phone can use, best first.

**Use the HTTPS ones.** The Capacitor WebView runs on an `https://localhost`
origin, so a plain-`http://` server address is *mixed content*: only a build
that sets both `android.allowMixedContent` (capacitor.config.ts) and
`usesCleartextTraffic` (src/debug/AndroidManifest.xml) can use one at all. In a
build missing either, the WebView drops the request before it reaches the
network — Save & reconnect appears to work, the app reloads, and nothing is ever
sent. HTTPS works in every build, debug or release, and has no such trap.

`tailscale serve` terminates TLS with a real Let's Encrypt certificate issued for
the MagicDNS name, so no self-signed-cert exception is needed. `--https=443`
fails if a Funnel already owns 443, so use spare ports:

```powershell
tailscale serve --bg --https=8443 http://127.0.0.1:8080
tailscale serve --bg --https=8444 http://127.0.0.1:3001
```

```
Gateway URL:   https://<machine>.<tailnet>.ts.net:8443
Ingestion URL: https://<machine>.<tailnet>.ts.net:8444
```

Verify from the phone's side with the gateway access log — the `Caddyfile` has a
`log` block for exactly this reason:

```powershell
docker compose logs --tail 50 gateway
```

A request from the phone shows up with `"X-Forwarded-For": ["100.x.y.z"]`. **No
entry at all means the request never left the phone**, which is the mixed-content
case above, not a firewall or Tailscale problem.

The Tailscale adapter is usually classified as a **Public** network by Windows,
so firewall rules must apply to the Public profile — `-Profile Any` is safest:

```powershell
New-NetFirewallRule -DisplayName "GeoIntelliSense TCP 8080" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -Action Allow -Profile Any
```

## AQI numbers: what to expect

The headline at `/api/aqi/headline` is the **EPA AirNow** value, which is the
maximum across PM2.5, PM10 and ozone. PurpleAir sensors measure PM2.5 only, so a
sensor-derived index cannot match a published AQI on a dust or ozone day — in
Bakersfield that is most of the late summer.

Sensor values are corrected with the EPA/Barkjohn equation before use. Raw
PurpleAir readings over-read regulatory monitors, sometimes by a factor of two.

`/api/aqi/validation` records the gap between the two hourly. A persistent
offset means the correction, the sensor bucketing or the sensor population needs
review. Expect the sensor index to sit slightly **below** the EPA PM2.5
sub-index in the valley, and somewhat **above** it in very clean desert air,
where the correction's constant term dominates.

## Things that are deliberately absent

Communities with no usable sensors (currently Delano, whose only sensor reports
channel confidence 0) are reported as unavailable rather than filled in. The
same applies to pollutants a sensor does not measure: they are omitted from the
JSON instead of being sent as `0`, which the UI would otherwise render as a real
reading of zero.
