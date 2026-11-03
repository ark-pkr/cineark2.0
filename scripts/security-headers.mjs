// Content-Security-Policy derived from the exact HTML being served, so inline scripts are allowed by hash only.
import { createHash } from 'node:crypto';

// Report-Only until the policy has been checked in production browsers; switch to 'Content-Security-Policy' then.
export const CSP_HEADER = 'Content-Security-Policy-Report-Only';

const sha256 = source => `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;

export function inlineScriptHashes(html) {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => sha256(match[1]));
    const handlers = [...html.matchAll(/\son[a-z]+="([^"]*)"/gi)].map(match => sha256(match[1]));
    return { scripts: [...new Set(scripts)], handlers: [...new Set(handlers)] };
}

export function contentSecurityPolicy(html, { supabaseUrl }) {
    const supabase = new URL(supabaseUrl);
    const { scripts, handlers } = inlineScriptHashes(html);
    const directives = {
        'default-src': ["'self'"],
        // 'unsafe-eval': the full Vue build compiles the in-DOM template at runtime.
        'script-src': [
            "'self'",
            "'unsafe-eval'",
            ...scripts,
            ...(handlers.length ? ["'unsafe-hashes'", ...handlers] : [])
        ],
        'style-src': ["'self'", "'unsafe-inline'"],
        // Covers and MangaDex pages come from arbitrary HTTPS hosts; chapter pages may be local blobs.
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'font-src': ["'self'"],
        'connect-src': [
            "'self'",
            supabase.origin,
            'wss://' + supabase.host,
            'https://graphql.anilist.co',
            'https://api.jikan.moe',
            'https://api.mymemory.translated.net'
        ],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"]
    };
    return Object.entries(directives)
        .map(([name, values]) => `${name} ${values.join(' ')}`)
        .join('; ');
}

export function securityHeaders(html, settings) {
    return { [CSP_HEADER]: contentSecurityPolicy(html, settings) };
}
