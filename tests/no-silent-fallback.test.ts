/**
 * Mechanised fail-loud rule.
 *
 * Every guardrail in this project that has a mechanism holds. The one that was
 * only written down — "loud/fail-fast error handling" — did not, and produced
 * the same defect four times:
 *
 *   1. mock AQI readings back-filled into live station responses
 *   2. those mock rows persisted to the database every 5 seconds
 *   3. /api/aqi-history returning a random walk with no source field
 *   4. getHistoricalWeatherFallback() drawing Math.random() humidity as a chart
 *      while /api/historical-weather had never once returned successfully
 *
 * Each one survived review because the symptom is invisible: a populated chart
 * looks identical whether the data is measured or generated. So the rule is
 * enforced here instead of trusted.
 *
 * RULE A  A catch block may return empty or null. It may never return
 *         generated data — no object/array literals, no *Fallback() call.
 * RULE B  Math.random() is banned in data paths. Visual randomness is fine and
 *         goes in ALLOWLIST with a stated reason.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const SCANNED = ['services', 'hooks', 'components', 'utils', 'contexts'];
const SKIP = new Set(['node_modules', 'dist', 'android', 'tests', 'build', '.git']);

/**
 * Files permitted to call Math.random(). Each needs a reason, and the reason
 * must be "this randomness is never displayed as a measurement".
 */
const ALLOWLIST: Record<string, string> = {
  'data/dashboardData.ts':
    'Declared placeholder corpus. Its own header states the numbers are not measurements.',
  'components/3d/WindField.tsx':
    'Particle scatter, size and lifetime for rendering the wind field. Visual only — ' +
    'speed and direction come from the observed-wind payload.',
  'hooks/useRealtimeAQI.ts':
    'Simulated AQI when the SSE stream is down. Permitted ONLY because it sets ' +
    "error='Using simulated data (server unavailable)' and AirQualityMapView renders " +
    'that banner plus a Live/Last-Updated indicator. Remove the label and this ' +
    'allowlist entry must go with it.',
};

const listFiles = (dir: string): string[] => {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(listFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
};

const sourceFiles = SCANNED.flatMap((d) => {
  try {
    return listFiles(join(ROOT, d));
  } catch {
    return [];
  }
});

const rel = (f: string) => relative(ROOT, f).split(sep).join('/');

/** Strip comments and string literals so prose about Math.random isn't a hit. */
const stripNoise = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => `'${' '.repeat(Math.max(0, m.length - 2))}'`)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${' '.repeat(Math.max(0, m.length - 2))}"`);

interface Finding {
  file: string;
  line: number;
  text: string;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

/** Body of every catch block, with its absolute offset, via brace matching. */
const catchBodies = (src: string): { body: string; offset: number }[] => {
  const out: { body: string; offset: number }[] = [];
  const re = /\bcatch\b\s*(?:\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({ body: src.slice(start, i - 1), offset: start });
  }
  return out;
};

// A catch may `return []`, `return null`, `return {}` is NOT allowed because an
// empty object is still a shape the caller will render. Empty array and null
// are the two honest "nothing here" answers.
const BANNED_IN_CATCH = [
  { re: /\breturn\s*\{\s*[^}\s]/g, why: 'returns a populated object literal' },
  { re: /\breturn\s*\[\s*[^\]\s]/g, why: 'returns a populated array literal' },
  { re: /\breturn\s+(?:this\.)?\w*Fallback\s*\(/g, why: 'calls a *Fallback() generator' },
  { re: /\breturn\s+(?:this\.)?generateMock\w*\s*\(/g, why: 'calls a generateMock*() generator' },
];

describe('fail-loud is mechanised, not just documented', () => {
  it('scans a non-trivial number of source files', () => {
    // Guards the guard: a broken path would make everything below vacuously pass.
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it('RULE A — no catch block returns generated data', () => {
    const findings: Finding[] = [];

    for (const file of sourceFiles) {
      const raw = readFileSync(file, 'utf8');
      const rawLines = raw.split('\n');
      // Site-local opt-out: `// fail-loud-ok: <reason>` within the two lines
      // above the return. Kept at the site rather than in a list at the top of
      // this file, so the reason is visible in the diff that needs it and
      // cannot rot away from the code it excuses.
      const excused = (line: number) =>
        rawLines
          .slice(Math.max(0, line - 3), line)
          .some((l) => /fail-loud-ok:\s*\S/.test(l));

      const src = stripNoise(raw);
      for (const { body, offset } of catchBodies(src)) {
        for (const { re, why } of BANNED_IN_CATCH) {
          re.lastIndex = 0;
          let hit: RegExpExecArray | null;
          while ((hit = re.exec(body)) !== null) {
            const line = lineOf(src, offset + hit.index);
            if (excused(line)) continue;
            findings.push({ file: rel(file), line, text: `${why}: ${hit[0].trim()}` });
          }
        }
      }
    }

    expect(
      findings.map((f) => `${f.file}:${f.line} — ${f.text}`),
      'A catch block must return [] or null, never generated data. ' +
        'Substituting a plausible value here is how a broken endpoint renders as a chart.',
    ).toEqual([]);
  });

  it('RULE B — Math.random() only where it is never shown as a measurement', () => {
    const findings: Finding[] = [];

    for (const file of sourceFiles) {
      const path = rel(file);
      if (ALLOWLIST[path]) continue;

      const src = stripNoise(readFileSync(file, 'utf8'));
      const re = /Math\.random\s*\(/g;
      let hit: RegExpExecArray | null;
      while ((hit = re.exec(src)) !== null) {
        findings.push({ file: path, line: lineOf(src, hit.index), text: 'Math.random()' });
      }
    }

    expect(
      findings.map((f) => `${f.file}:${f.line}`),
      'Math.random() in a data path produces numbers indistinguishable from ' +
        'measurements. If this randomness is genuinely visual, add the file to ' +
        'ALLOWLIST in this test with a reason.',
    ).toEqual([]);
  });

  it('every allowlist entry still exists and still calls Math.random()', () => {
    // Stops the allowlist rotting into permission for files that moved or changed.
    const stale: string[] = [];
    for (const path of Object.keys(ALLOWLIST)) {
      try {
        if (!/Math\.random\s*\(/.test(stripNoise(readFileSync(join(ROOT, path), 'utf8')))) {
          stale.push(`${path} — no longer calls Math.random(); drop the exemption`);
        }
      } catch {
        stale.push(`${path} — file not found; drop the exemption`);
      }
    }
    expect(stale).toEqual([]);
  });
});
