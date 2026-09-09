#!/usr/bin/env node
// Prints the addresses to enter in the GeoIntelliSense Android app
// (Settings > API & Connection > Server Connection) when the backend runs on
// this machine, and checks that both services answer.
//
//   npm run phone:urls
//
// Ports follow docker-compose.yml (override with GATEWAY_PORT / INGESTION_PORT).

import os from 'node:os';

const GATEWAY_PORT = process.env.GATEWAY_PORT || '8080';
const INGESTION_PORT = process.env.INGESTION_PORT || '3001';
const HEALTH_TIMEOUT_MS = 4000;

const isTailscale = (ip) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
};

const candidates = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const addr of addrs ?? []) {
    if (addr.family !== 'IPv4' || addr.internal) continue;
    candidates.push({ name, ip: addr.address, tailscale: isTailscale(addr.address) });
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

if (candidates.length === 0) {
  console.log('No LAN IPv4 address found. Connect this machine to Wi-Fi or Ethernet and retry.');
  process.exit(1);
}

console.log('Enter these in the app (Settings > API & Connection > Server Connection):');
for (const c of candidates) {
  const label = c.tailscale ? 'via Tailscale, works off Wi-Fi' : `on Wi-Fi/LAN (${c.name})`;
  console.log(`\n  ${label}`);
  console.log(`    Gateway URL:   http://${c.ip}:${GATEWAY_PORT}`);
  console.log(`    Ingestion URL: http://${c.ip}:${INGESTION_PORT}`);
}
console.log('\nPlain http works only with the debug APK. If the phone shows "Disconnected",');
console.log('allow inbound TCP ' + GATEWAY_PORT + ' and ' + INGESTION_PORT + ' in this machine\'s firewall.');
