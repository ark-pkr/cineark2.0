// Builds a Font Awesome stylesheet and fonts containing only the icons the app references.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import subsetFont from 'subset-font';

const FREE_FAMILY = '"Font Awesome 6 Free"';
const ICON_RULE = /^--fa:"(\\[0-9a-f]+|.)"$/i;
// Brand/duotone/v4 selectors are unused; ".fab" also collides with the app's floating action button.
const DROPPED_SELECTORS = new Set([
    '.fab',
    '.fa-brands',
    '.fad',
    '.fa-duotone',
    '.fal',
    '.fa-light',
    '.fat',
    '.fa-thin'
]);

export async function usedIconClasses(root) {
    const sources = [resolve(root, 'public/index.html')];
    for (const file of await readdir(resolve(root, 'public/assets/js')))
        if (file.endsWith('.js')) sources.push(resolve(root, 'public/assets/js', file));
    const used = new Set();
    for (const file of sources)
        for (const match of (await readFile(file, 'utf8')).matchAll(/\bfa-[a-z0-9-]+/g)) used.add(match[0]);
    return used;
}

// Splits a stylesheet into top-level "prelude{body}" blocks, keeping nested blocks (@media, @keyframes) intact.
function topLevelRules(css) {
    const rules = [];
    let depth = 0,
        start = 0,
        open = -1;
    for (let i = 0; i < css.length; i++) {
        if (css[i] === '{' && depth++ === 0) open = i;
        else if (css[i] === '}' && --depth === 0) {
            rules.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
            start = i + 1;
        }
    }
    return rules;
}

export function buildIconStylesheet(css, used) {
    const codepoints = new Set();
    const output = [];
    for (const { prelude, body } of topLevelRules(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
        if (prelude === '@font-face') {
            if (!body.includes(`font-family:${FREE_FAMILY}`)) continue;
            output.push(`@font-face{${body.replace(/,url\([^)]*\.ttf\) format\("truetype"\)/g, '')}}`);
            continue;
        }
        const icon = ICON_RULE.exec(body.trim());
        if (icon && !prelude.startsWith('@')) {
            const kept = prelude.split(',').filter(selector => used.has(selector.slice(1)));
            if (!kept.length) continue;
            const value = icon[1].startsWith('\\') ? parseInt(icon[1].slice(1), 16) : icon[1].codePointAt(0);
            codepoints.add(value);
            output.push(`${kept.join(',')}{${body}}`);
            continue;
        }
        if (prelude.startsWith('@')) {
            output.push(`${prelude}{${body}}`);
            continue;
        }
        const kept = prelude.split(',').filter(selector => !DROPPED_SELECTORS.has(selector.trim()));
        if (kept.length) output.push(`${kept.join(',')}{${body}}`);
    }
    const missing = [...used].filter(
        name =>
            !output.some(rule =>
                rule
                    .split('{')[0]
                    .split(',')
                    .includes('.' + name)
            )
    );
    return { css: output.join('\n'), codepoints, missing };
}

export async function subsetIconFont(buffer, codepoints) {
    return subsetFont(buffer, String.fromCodePoint(...codepoints), { targetFormat: 'woff2' });
}
