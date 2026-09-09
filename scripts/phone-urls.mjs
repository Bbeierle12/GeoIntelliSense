#!/usr/bin/env node
// Prints the addresses to enter in the GeoIntelliSense Android app
// (Settings > API & Connection > Server Connection) when the backend runs on
// this machine, and checks that both services answer.
//
//   npm run phone:urls
//
// Ports follow docker-compose.yml (override with GATEWAY_PORT / INGESTION_PORT).

import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TAILSCALE_TIMEOUT_MS = 3000;
const HEALTH_TIMEOUT_MS = 4000;

const GATEWAY_PORT = process.env.GATEWAY_PORT || '8080';
const INGESTION_PORT = process.env.INGESTION_PORT || '3001';

const TAILSCALE_BINS = [
  'tailscale',
  'C:/Program Files/Tailscale/tailscale.exe',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

const tailscale = async (args) => {
  for (const bin of TAILSCALE_BINS) {
    try {
      const { stdout } = await execFileAsync(bin, args, { timeout: TAILSCALE_TIMEOUT_MS });
      return stdout;
    } catch {
      // not installed, not running, or not on PATH
    }
  }
  return null;
};

// MagicDNS name of this machine, if the Tailscale CLI is installed and up.
const tailscaleDnsName = async () => {
  const out = await tailscale(['status', '--json']);
  if (!out) return null;
  try {
    const name = JSON.parse(out)?.Self?.DNSName;
    return typeof name === 'string' && name ? name.replace(/\.$/, '') : null;
  } catch {
    return null;
  }
};

// `tailscale serve` terminates TLS with a real Let's Encrypt certificate issued
// for the MagicDNS name, so the URLs it exposes are https://. Prefer them: the
// Capacitor WebView runs on an https://localhost origin, so a plain-http server
// address is mixed content and is blocked outright in any build that does not
// set android.allowMixedContent — the failure looks like "saved, but nothing
// happens". https:// works in every build, debug or release.
//
// Set it up once (any spare ports; 443 is often taken by Funnel):
//   tailscale serve --bg --https=8443 http://127.0.0.1:8080
//   tailscale serve --bg --https=8444 http://127.0.0.1:3001
const tailscaleServeUrls = async () => {
  const out = await tailscale(['serve', 'status', '--json']);
  if (!out) return {};
  let web;
  try {
    web = JSON.parse(out)?.Web;
  } catch {
    return {};
  }
  const found = {};
  for (const [hostPort, entry] of Object.entries(web ?? {})) {
    const proxy = entry?.Handlers?.['/']?.Proxy ?? '';
    const target = proxy.match(/:(\d+)\/?$/)?.[1];
    if (target === GATEWAY_PORT) found.gateway = `https://${hostPort}`;
    if (target === INGESTION_PORT) found.ingestion = `https://${hostPort}`;
  }
  return found;
};

const isTailscaleIp = (ip) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
};

const candidates = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const addr of addrs ?? []) {
    if (addr.family !== 'IPv4' || addr.internal) continue;
    candidates.push({ name, ip: addr.address, tailscale: isTailscaleIp(addr.address) });
  }
}

const check = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return res.ok ? 'OK' : `HTTP ${res.status}`;
  } catch (err) {
    return `unreachable (${err?.cause?.code || err?.name || err})`;
  }
};

const gatewayLocal = await check(`http://127.0.0.1:${GATEWAY_PORT}/health`);
const ingestionLocal = await check(`http://127.0.0.1:${INGESTION_PORT}/health`);

console.log('Backend on this machine');
console.log(`  gateway   http://127.0.0.1:${GATEWAY_PORT}/health   -> ${gatewayLocal}`);
console.log(`  ingestion http://127.0.0.1:${INGESTION_PORT}/health   -> ${ingestionLocal}`);
if (gatewayLocal !== 'OK' || ingestionLocal !== 'OK') {
  console.log('  Start it with: docker compose up -d   (first run builds images; allow several minutes)');
}
console.log('');

const serve = await tailscaleServeUrls();
const dnsName = await tailscaleDnsName();

console.log('Enter these in the app (Settings > API & Connection > Server Connection):');

if (serve.gateway && serve.ingestion) {
  const [g, i] = await Promise.all([
    check(`${serve.gateway}/health`),
    check(`${serve.ingestion}/health`),
  ]);
  console.log('\n  over Tailscale with HTTPS — RECOMMENDED, works in every build');
  console.log(`    Gateway URL:   ${serve.gateway}     -> ${g}`);
  console.log(`    Ingestion URL: ${serve.ingestion}     -> ${i}`);
} else {
  console.log('\n  No `tailscale serve` HTTPS listener found. Plain http below only works in');
  console.log('  a debug build. To get https (recommended), run:');
  console.log(`    tailscale serve --bg --https=8443 http://127.0.0.1:${GATEWAY_PORT}`);
  console.log(`    tailscale serve --bg --https=8444 http://127.0.0.1:${INGESTION_PORT}`);
}

if (dnsName) {
  console.log('\n  over Tailscale with plain http (debug builds only)');
  console.log(`    Gateway URL:   http://${dnsName}:${GATEWAY_PORT}`);
  console.log(`    Ingestion URL: http://${dnsName}:${INGESTION_PORT}`);
}

if (candidates.length === 0) {
  console.log('\nNo LAN IPv4 address found. Connect this machine to Wi-Fi or Ethernet and retry.');
  process.exit(1);
}

for (const c of candidates) {
  if (c.tailscale) continue; // covered by the MagicDNS entry above
  console.log(`\n  on Wi-Fi/LAN (${c.name}, debug builds only, same network required)`);
  console.log(`    Gateway URL:   http://${c.ip}:${GATEWAY_PORT}`);
  console.log(`    Ingestion URL: http://${c.ip}:${INGESTION_PORT}`);
}

console.log('\nIf the phone still shows "Disconnected" after Save & reconnect, check the');
console.log('gateway access log for the phone\'s tailnet IP:');
console.log('    docker compose logs --tail 50 gateway');
console.log('No entry there means the request never left the phone — use the https URLs.');
console.log('Otherwise allow inbound TCP ' + GATEWAY_PORT + ' and ' + INGESTION_PORT + ' in this machine\'s firewall.');
