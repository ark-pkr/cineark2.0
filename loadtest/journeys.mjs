// Jornadas reais no navegador (Playwright) — usuários anônimos navegando no CINE ARK.
// Uso (dentro de loadtest/): node journeys.mjs [--base https://cineark.com.br] [--users 5] [--rounds 2] [--headed]
// Por padrão bloqueia /mangadex e /api/discover (terceiros com limite/custo). --allow-third-party libera.
/* global window -- usado só dentro de page.evaluate, que roda no navegador */
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const BASE = opt('base', 'https://cineark.com.br').replace(/\/$/, '');
const USERS = Math.min(Number(opt('users', 5)), 20);
const ROUNDS = Number(opt('rounds', 2));
const ALLOW = argv.includes('--allow-third-party');
const OUT = resolve(opt('out', 'results'));
const SEARCHES = ['solo', 'necromante', 'duque', 'herói', 'zzzz-inexistente'];

const browser = await chromium.launch({ headless: !argv.includes('--headed') });

async function user(id) {
    const mobile = id % 2 === 1; // metade celular, metade desktop
    const ctx = await browser.newContext(mobile ? devices['Pixel 7'] : { viewport: { width: 1366, height: 800 } });
    const page = await ctx.newPage();
    const log = {
        id,
        device: mobile ? 'mobile' : 'desktop',
        steps: [],
        consoleErrors: [],
        failed: [],
        blocked: 0,
        http4xx5xx: []
    };
    page.on('console', m => m.type() === 'error' && log.consoleErrors.push(m.text().slice(0, 300)));
    page.on('pageerror', e => log.consoleErrors.push('pageerror: ' + e.message.slice(0, 300)));
    page.on(
        'requestfailed',
        r =>
            !/blocked|aborted/i.test(r.failure()?.errorText || '') &&
            log.failed.push(r.url().slice(0, 200) + ' ' + r.failure()?.errorText)
    );
    page.on('response', r => r.status() >= 400 && log.http4xx5xx.push(r.status() + ' ' + r.url().slice(0, 200)));
    if (!ALLOW)
        await page.route(/\/(mangadex|api\/discover)(\?|\/|$)/, r => {
            log.blocked++;
            return r.abort('blockedbyclient');
        });

    async function step(name, fn) {
        const t0 = performance.now();
        let ok = true,
            note;
        try {
            note = (await fn()) || '';
        } catch (e) {
            ok = false;
            note = e.message.split('\n')[0].slice(0, 200);
        }
        log.steps.push({ name, ms: Math.round(performance.now() - t0), ok, note });
    }
    const pause = () => page.waitForTimeout(800 + Math.random() * 2000);

    for (let round = 0; round < ROUNDS; round++) {
        await step('abrir home', async () => {
            await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
            await page.locator('.ark-rail-card').first().waitFor({ timeout: 15000 });
        });
        await step('pular introdução', async () => {
            // Em produção a introdução ignora cliques até ficar "pronta"; o visitante tenta de novo a cada 0,5 s.
            const open = () => page.locator('.splash-screen:not(.splash-hidden)').count();
            if (!(await open())) return 'sem splash';
            const skip = page.locator('.ark-skip-intro');
            let clicks = 0;
            const t0 = Date.now();
            while ((await open()) && Date.now() - t0 < 20000) {
                if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 2000 }).catch(() => {});
                else await page.mouse.click(40, 40);
                clicks++;
                await page.waitForTimeout(500);
            }
            if (await open()) throw new Error('introdução não fechou em 20 s');
            return `introdução bloqueou ${Date.now() - t0} ms, ${clicks} cliques`;
        });
        await step('métricas UX', async () => {
            await page.waitForTimeout(1500);
            const m = await page.evaluate(() => window.ArkUX?.performance?.() || null);
            log.ux ||= [];
            log.ux.push(m);
            return m ? `FCP ${m.fcpMs} LCP ${m.lcpMs} CLS ${m.cls}` : 'ArkUX indisponível';
        });
        await pause();
        await step('buscar obra', async () => {
            const q = SEARCHES[(id + round) % SEARCHES.length];
            const input = page.getByLabel('Buscar na biblioteca');
            await input.scrollIntoViewIfNeeded();
            await input.fill(q);
            await page.waitForTimeout(700);
            const n = await page.locator('#catalogo button, #catalogo article, #catalogo a').count();
            return `"${q}" → ${n} elementos no catálogo`;
        });
        await pause();
        await step('abrir obra', async () => {
            await page.getByLabel('Buscar na biblioteca').fill('');
            await page.evaluate(() => window.scrollTo(0, 0));
            const card = page.locator('.ark-rail-card').nth((id + round) % 3);
            await card.click({ timeout: 10000 });
            await page.waitForURL(/\/obra\//, { timeout: 15000 });
            const path = new URL(page.url()).pathname;
            const has = await page
                .locator('.ark-chapter-open')
                .first()
                .waitFor({ timeout: 8000 })
                .then(() => true)
                .catch(() => false);
            log.lastWorkHasChapters = has;
            return has ? path : path + ' (obra sem capítulos na nuvem)';
        });
        await pause();
        await step('abrir capítulo', async () => {
            const btn = page.locator('.ark-chapter-open:not([disabled])').first();
            if (!log.lastWorkHasChapters || !(await btn.count())) return 'pulado: obra sem capítulos';
            await btn.click({ timeout: 10000 });
            await page
                .locator('img[src*="supabase"], img[src*="blob:"], .ark-reader img')
                .first()
                .waitFor({ timeout: 20000 });
            const m = await page.evaluate(() => window.ArkUX?.performance?.() || null);
            return m ? `chapterOpen ${m.chapterOpenMs} ms, 1ª imagem ${m.chapterFirstImageMs} ms` : '';
        });
        await pause();
        await step('rolar leitura', async () => {
            for (let i = 0; i < 5; i++) {
                await page.mouse.wheel(0, 900);
                await page.waitForTimeout(400);
            }
        });
    }
    await ctx.close();
    return log;
}

const t0 = Date.now();
// rampa: um usuário novo a cada 3 s
const logs = await Promise.all(
    Array.from({ length: USERS }, (_, i) => new Promise(r => setTimeout(r, i * 3000)).then(() => user(i)))
);
await browser.close();

const byStep = {};
for (const l of logs) for (const s of l.steps) (byStep[s.name] ||= []).push(s);
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const table = Object.entries(byStep).map(([name, list]) => ({
    step: name,
    runs: list.length,
    falhas: list.filter(s => !s.ok).length,
    p50: pct(
        list.map(s => s.ms),
        50
    ),
    p95: pct(
        list.map(s => s.ms),
        95
    ),
    exemploFalha: list.find(s => !s.ok)?.note || ''
}));
await mkdir(OUT, { recursive: true });
const file = resolve(OUT, `journeys-${new Date(t0).toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify({ base: BASE, users: USERS, rounds: ROUNDS, table, logs }, null, 1));
console.table(table);
const uniq = a => [...new Set(a)];
console.log('Erros de console únicos:', uniq(logs.flatMap(l => l.consoleErrors)).slice(0, 15));
console.log('HTTP >= 400 únicos:', uniq(logs.flatMap(l => l.http4xx5xx)).slice(0, 15));
console.log('Requisições falhas:', uniq(logs.flatMap(l => l.failed)).slice(0, 15));
console.log(
    'Bloqueadas (mangadex/discover):',
    logs.reduce((a, l) => a + l.blocked, 0)
);
console.log('Resultados em', file);
