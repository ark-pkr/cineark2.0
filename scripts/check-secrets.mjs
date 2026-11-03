#!/usr/bin/env node
// Blocks commits/CI runs that contain credentials. Usage:
//   node scripts/check-secrets.mjs           -> scans every tracked file
//   node scripts/check-secrets.mjs --staged  -> scans only staged content (pre-commit)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const staged = process.argv.includes('--staged');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const RULES = [
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['Google AI Studio key', /\bAQ\.[0-9A-Za-z_-]{30,}/],
    ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
    ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{36,}/],
    ['OpenAI/Anthropic key', /\bsk-(?:ant-)?[0-9A-Za-z_-]{32,}/],
    [
        'Supabase service_role JWT',
        /eyJ[0-9A-Za-z_-]+\.eyJ[0-9A-Za-z_-]*?(?:c2VydmljZV9yb2xl|InNlcnZpY2Vfcm9sZS)[0-9A-Za-z_-]*\.[0-9A-Za-z_-]+/
    ],
    [
        'Filled secret variable',
        /^[ \t]*(?:GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|[A-Z_]*SECRET[A-Z_]*)[ \t]*=[ \t]*\S{8,}/m
    ]
];
const SKIP =
    /(^|\/)(node_modules|dist|public\/assets\/vendor)\/|\.(png|jpe?g|webp|gif|ico|woff2?|ttf|zip|pdf)$|package-lock\.json$/;

const files = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR') : git('ls-files'))
    .split('\n')
    .filter(f => f && !SKIP.test(f));
const findings = [];
for (const file of files) {
    let text;
    try {
        text = staged ? git('show', ':' + file) : fs.readFileSync(file, 'utf8');
    } catch {
        continue;
    }
    if (text.includes('\0')) continue;
    for (const [name, rule] of RULES) {
        const match = rule.exec(text);
        if (match) {
            const line = text.slice(0, match.index).split('\n').length;
            findings.push(`${file}:${line}  ${name}`);
        }
    }
}
if (findings.length) {
    console.error('Possíveis segredos encontrados (o commit/CI foi bloqueado):\n  ' + findings.join('\n  '));
    console.error(
        '\nMova o valor para .env.local ou para as variáveis do servidor. Se ele já foi publicado, revogue-o.'
    );
    process.exit(1);
}
console.log(`check-secrets: ${files.length} arquivo(s) verificados, nenhum segredo encontrado.`);
