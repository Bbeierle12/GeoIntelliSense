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
the stack comes back **once you sign in to Windows**, not at boot. Enable
*Settings > General > Start Docker Desktop when you sign in*; the containers use
`restart: unless-stopped` and recover on their own from there.

Set the machine's sleep timeout to Never on AC, or the backend disappears
whenever the desk is quiet.

## Reaching it from the phone over Tailscale

`npm run phone:urls` prints the MagicDNS name and Tailscale IP. Plain HTTP works
with the debug APK:

```
Gateway URL:   http://<machine>.<tailnet>.ts.net:8080
Ingestion URL: http://<machine>.<tailnet>.ts.net:3001
```

For HTTPS (required by a release build), note that `tailscale serve --https=443`
fails if you already run a Funnel on 443. Use spare ports:

```powershell
tailscale serve --bg --https=8443 http://127.0.0.1:8080
tailscale serve --bg --https=8444 http://127.0.0.1:3001
```

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
