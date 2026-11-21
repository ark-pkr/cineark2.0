// Teste de carga leve do CINE ARK (sem dependências, Node 24+).
// Uso: node loadtest/load.mjs [--base https://cineark.com.br] [--vus 20] [--minutes 5] [--out loadtest/results]
// Rampa: sobe de 1 até --vus durante 60% do tempo, mantém por 30% e desce nos 10% finais.
// Não chama /mangadex (API de terceiros com limite) nem /api/discover (Gemini, custa por chamada).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const args = Object.fromEntries(
    process.argv
        .slice(2)
        .join(' ')
        .split('--')
        .filter(Boolean)
        .map(s => s.trim().split(/\s+/))
);
const BASE = (args.base || 'https://cineark.com.br').replace(/\/$/, '');
const MAX_VUS = Math.min(Number(args.vus || 20), 50); // teto de segurança
const DURATION = Number(args.minutes || 5) * 60_000;
const OUT = resolve(args.out || 'loadtest/results');
const THINK = [1000, 4000]; // pausa entre ações de um usuário, em ms

const cfg = { window: {} };
vm.runInNewContext(await readFile(resolve('public/assets/js/config.js'), 'utf8'), cfg);
const { supabaseUrl, supabaseAnonKey } = cfg.window.CINE_ARK_CONFIG;
const sbHeaders = { apikey: supabaseAnonKey, Authorization: 'Bearer ' + supabaseAnonKey };

const samples = []; // { name, ms, status, ok, t }
async function hit(name, url, opts = {}) {
    const t0 = performance.now();
    let status = 0,
        ok = false,
        bytes = 0;
    try {
        const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });
        status = res.status;
        bytes = (await res.arrayBuffer()).byteLength;
        ok = res.ok;
        return { res, ok };
    } catch (e) {
        status = e.name === 'TimeoutError' ? 'timeout' : 'neterr';
    } finally {
        samples.push({ name, ms: performance.now() - t0, status, ok, bytes, t: Date.now() });
    }
    return { ok: false };
}

const sitemap = await (await fetch(BASE + '/sitemap.xml')).text();
const works = [...sitemap.matchAll(/<loc>([^<]+\/obra\/[^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
const html = await (await fetch(BASE + '/')).text();
const assets = [...html.matchAll(/(?:src|href)="((?:\.\/)?assets\/[^"]+)"/g)].map(m => '/' + m[1].replace(/^\.\//, ''));
console.log(
    `Alvo ${BASE} | ${works.length} obras no sitemap | ${assets.length} assets | até ${MAX_VUS} VUs por ${DURATION / 60000} min`
);

const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const think = () => sleep(THINK[0] + Math.random() * (THINK[1] - THINK[0]));

const rest = path => supabaseUrl + '/rest/v1/' + path;
const LATEST =
    'ark_chapters?select=id,work_id,number,title,created_at&published=eq.true&archived_at=is.null&order=created_at.desc,id.asc&limit=12';
const AVAIL =
    'itens_catalogo?select=id,ark_chapters(count),latest:ark_chapters(content_updated_at)&ark_chapters.published=eq.true&ark_chapters.archived_at=is.null&latest.published=eq.true&latest.archived_at=is.null&latest.order=content_updated_at.desc.nullslast&latest.limit=1&order=id.asc&offset=0&limit=500';

// Jornada de um visitante anônimo: home (+assets na 1ª visita) → consultas do Supabase → 1 a 3 obras.
async function journey(first) {
    await hit('GET /', BASE + '/');
    if (first) await Promise.all(assets.map(a => hit('asset', BASE + a)));
    await Promise.all([
        hit('supabase latest-chapters', rest(LATEST), { headers: sbHeaders }),
        hit('supabase catalog-availability', rest(AVAIL), { headers: sbHeaders })
    ]);
    await think();
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n && works.length; i++) {
        await hit('GET /obra/:slug', BASE + pick(works));
        await think();
    }
    if (Math.random() < 0.1) await hit('GET /sitemap.xml', BASE + '/sitemap.xml');
}

const start = Date.now();
const end = start + DURATION;
function targetVus(now) {
    const p = (now - start) / DURATION;
    if (p < 0.6) return Math.max(1, Math.ceil((MAX_VUS * p) / 0.6));
    if (p < 0.9) return MAX_VUS;
    return Math.max(1, Math.ceil((MAX_VUS * (1 - p)) / 0.1));
}
let active = 0,
    peak = 0;
async function vu(id) {
    active++;
    peak = Math.max(peak, active);
    let first = true;
    while (Date.now() < end && id < targetVus(Date.now())) {
        await journey(first);
        first = false;
    }
    active--;
}
const running = new Set();
let nextId = 0;
const ticker = setInterval(() => {
    const want = targetVus(Date.now());
    while (active < want && Date.now() < end) {
        const p = vu(nextId++ % MAX_VUS).finally(() => running.delete(p));
        running.add(p);
        if (active >= want) break;
    }
    const recent = samples.filter(s => s.t > Date.now() - 10_000);
    const errs = recent.filter(s => !s.ok).length;
    process.stdout.write(
        `\r${((Date.now() - start) / 1000).toFixed(0)}s  VUs ${active}/${want}  req/10s ${recent.length}  erros/10s ${errs}   `
    );
}, 1000);
await sleep(DURATION);
clearInterval(ticker);
await Promise.allSettled([...running]);

// ---- relatório ----
const pct = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const groups = {};
for (const s of samples) (groups[s.name] ||= []).push(s);
const rows = Object.entries(groups).map(([name, list]) => {
    const ms = list.map(s => s.ms);
    const statuses = {};
    for (const s of list) statuses[s.status] = (statuses[s.status] || 0) + 1;
    return {
        name,
        count: list.length,
        errorRate: +(list.filter(s => !s.ok).length / list.length).toFixed(4),
        p50: Math.round(pct(ms, 50)),
        p95: Math.round(pct(ms, 95)),
        p99: Math.round(pct(ms, 99)),
        max: Math.round(Math.max(...ms)),
        statuses
    };
});
const all = samples.map(s => s.ms);
const summary = {
    base: BASE,
    startedAt: new Date(start).toISOString(),
    durationMin: DURATION / 60000,
    maxVus: MAX_VUS,
    peakVus: peak,
    requests: samples.length,
    rps: +(samples.length / (DURATION / 1000)).toFixed(2),
    errorRate: +(samples.filter(s => !s.ok).length / samples.length).toFixed(4),
    p50: Math.round(pct(all, 50)),
    p95: Math.round(pct(all, 95)),
    endpoints: rows
};
await mkdir(OUT, { recursive: true });
const stamp = new Date(start).toISOString().replace(/[:.]/g, '-');
await writeFile(resolve(OUT, `load-${stamp}.json`), JSON.stringify({ summary, samples }, null, 1));
console.log('\n');
console.table(rows.map(({ statuses, ...r }) => ({ ...r, statuses: JSON.stringify(statuses) })));
console.log(
    `Total ${summary.requests} req, ${summary.rps} req/s, erros ${(summary.errorRate * 100).toFixed(2)}%, p50 ${summary.p50} ms, p95 ${summary.p95} ms`
);
console.log('Resultados em', resolve(OUT, `load-${stamp}.json`));
