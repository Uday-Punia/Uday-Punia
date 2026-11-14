// Builds the README stats cards from public GitHub data and writes them into
// assets/images/stats/. Runs locally (`node scripts/generate-stats.mjs`) or from
// the update-stats workflow. No dependencies.
//
// If any request fails or the data looks wrong, the script exits non-zero
// WITHOUT touching the existing SVGs, so the README keeps the last good cards
// instead of showing a broken image.

import { writeFile, mkdir } from 'node:fs/promises';

const USER = process.env.GH_USER || 'Uday-Punia';
const OUT = new URL('../assets/images/stats/', import.meta.url);
const headers = { 'User-Agent': 'profile-stats-generator', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const C = {
  bg: '#0b0f14', panel: '#070a0e', line: '#1f2a37', grid: '#141c26',
  green: '#39ff88', cyan: '#22d3ee', blue: '#2f6bff', text: '#e6edf3', dim: '#6b7a8c',
};
const FONT = `'JetBrains Mono','Fira Code',Consolas,'Courier New',monospace`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function get(url, as = 'json') {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return as === 'json' ? res.json() : res.text();
}

// ---- contribution calendar (public profile markup) -------------------------
async function contributions() {
  const html = await get(`https://github.com/users/${USER}/contributions`, 'text');
  const days = new Map();
  for (const m of html.matchAll(/<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="([^"]+)"[^>]*data-level="(\d)"/g)) {
    days.set(m[2], { date: m[1], level: +m[3], count: 0 });
  }
  for (const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const d = days.get(m[1]);
    const n = m[2].match(/^(\d[\d,]*) contribution/);
    if (d && n) d.count = +n[1].replace(/,/g, '');
  }
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (list.length < 300) throw new Error(`contribution calendar parse failed (${list.length} days)`);
  return list;
}

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = days.length - 1;
  if (days[i].count === 0) i--; // today not counted yet → streak still alive
  let current = 0;
  for (; i >= 0 && days[i].count > 0; i--) current++;
  return { current, longest };
}

// ---- repositories + languages -----------------------------------------------
async function repoStats() {
  const repos = (await get(`https://api.github.com/users/${USER}/repos?per_page=100&type=owner`))
    .filter((r) => !r.fork && r.name !== USER);
  const bytes = {};
  for (const r of repos) {
    const langs = await get(r.languages_url);
    for (const [k, v] of Object.entries(langs)) bytes[k] = (bytes[k] || 0) + v;
  }
  const total = Object.values(bytes).reduce((a, b) => a + b, 0);
  if (!total) throw new Error('no language data');
  const top = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([name, v]) => ({ name, pct: (v / total) * 100 }));
  return { repoCount: repos.length + 1, top }; // +1 = this profile repo
}

// ---- SVG builders -------------------------------------------------------------
function frame(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect width="${w}" height="${h}" rx="12" fill="${C.bg}"/>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="none" stroke="${C.line}"/>
<g font-family="${FONT}">${body}</g>
</svg>
`;
}

function overviewSvg({ repoCount, top }, total, { current, longest }, updated) {
  const tiles = [
    ['PUBLIC REPOS', repoCount, C.cyan],
    ['CONTRIBUTIONS · 1Y', total, C.green],
    ['CURRENT STREAK', `${current}d`, C.green],
    ['LONGEST STREAK · 1Y', `${longest}d`, C.blue],
  ];
  let body = `<text x="24" y="34" font-size="12" fill="${C.dim}" letter-spacing="2">GITHUB TELEMETRY</text>`;
  tiles.forEach(([label, value, color], i) => {
    const x = 24 + (i % 2) * 196, y = 54 + Math.floor(i / 2) * 88;
    body += `<rect x="${x}" y="${y}" width="184" height="76" rx="8" fill="${C.panel}" stroke="${C.line}"/>
<text x="${x + 14}" y="${y + 24}" font-size="10.5" fill="${C.dim}" letter-spacing="1">${label}</text>
<text x="${x + 14}" y="${y + 60}" font-size="28" font-weight="700" fill="${color}">${esc(value)}</text>`;
  });
  const lx = 440;
  body += `<text x="${lx}" y="34" font-size="12" fill="${C.dim}" letter-spacing="2">LANGUAGES · PUBLIC REPOS</text>`;
  const palette = [C.green, C.cyan, C.blue, '#7dd3fc', '#a3e635', '#94a3b8'];
  top.forEach(({ name, pct }, i) => {
    const y = 62 + i * 25;
    body += `<text x="${lx}" y="${y + 9}" font-size="12.5" fill="${C.text}">${esc(name)}</text>
<rect x="${lx + 120}" y="${y}" width="250" height="8" rx="4" fill="${C.grid}"/>
<rect x="${lx + 120}" y="${y}" width="${Math.max(3, (pct / 100) * 250).toFixed(1)}" height="8" rx="4" fill="${palette[i]}"/>
<text x="${lx + 412}" y="${y + 9}" font-size="11.5" fill="${C.dim}" text-anchor="end">${pct.toFixed(1)}%</text>`;
  });
  body += `<text x="876" y="230" font-size="10" fill="${C.dim}" text-anchor="end">updated ${updated} · self-hosted</text>`;
  return frame(900, 244, `GitHub stats for ${USER}`, body);
}

function activitySvg(days, total, updated) {
  const cell = 13, gap = 3, x0 = 46, y0 = 52;
  const shades = [C.grid, '#0f5132', '#16834a', '#22c06a', C.green];
  const firstDow = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
  let body = `<text x="24" y="32" font-size="12" fill="${C.dim}" letter-spacing="2">CONTRIBUTION ACTIVITY · LAST 12 MONTHS</text>
<text x="876" y="32" font-size="12" fill="${C.green}" text-anchor="end">${total} contributions</text>`;
  ['Mon', 'Wed', 'Fri'].forEach((d, i) => {
    body += `<text x="${x0 - 8}" y="${y0 + (1 + i * 2) * (cell + gap) + 10}" font-size="9.5" fill="${C.dim}" text-anchor="end">${d}</text>`;
  });
  let lastMonth = -1;
  days.forEach((d, i) => {
    const idx = i + firstDow, col = Math.floor(idx / 7), row = idx % 7;
    const x = x0 + col * (cell + gap), y = y0 + row * (cell + gap);
    const month = new Date(d.date + 'T00:00:00Z').getUTCMonth();
    if (row === 0 && month !== lastMonth && col < 52) {
      body += `<text x="${x}" y="${y0 - 8}" font-size="9.5" fill="${C.dim}">${'JanFebMarAprMayJunJulAugSepOctNovDec'.slice(month * 3, month * 3 + 3)}</text>`;
      lastMonth = month;
    }
    body += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${shades[d.level] || shades[0]}"><title>${d.count} on ${d.date}</title></rect>`;
  });
  const ly = y0 + 7 * (cell + gap) + 18;
  body += `<text x="24" y="${ly + 9}" font-size="10" fill="${C.dim}">updated ${updated} · self-hosted</text>
<text x="${876 - 32 - 5 * 17 - 8}" y="${ly + 9}" font-size="10" fill="${C.dim}" text-anchor="end">less</text>
<text x="876" y="${ly + 9}" font-size="10" fill="${C.dim}" text-anchor="end">more</text>`;
  shades.forEach((s, i) => { body += `<rect x="${876 - 32 - (5 - i) * 17}" y="${ly}" width="12" height="12" rx="2.5" fill="${s}"/>`; });
  return frame(900, ly + 30, `Contribution activity for ${USER}`, body);
}

// ---- main ---------------------------------------------------------------------
const [days, repos] = await Promise.all([contributions(), repoStats()]);
const total = days.reduce((a, d) => a + d.count, 0);
const updated = new Date().toISOString().slice(0, 10);
await mkdir(OUT, { recursive: true });
await writeFile(new URL('overview.svg', OUT), overviewSvg(repos, total, streaks(days), updated));
await writeFile(new URL('activity.svg', OUT), activitySvg(days, total, updated));
console.log(`ok: ${repos.repoCount} repos, ${total} contributions, ${days.length} days, langs=${repos.top.map((l) => l.name).join(',')}`);
