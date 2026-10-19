// Only public catalog descriptions are translated automatically. No credentials are sent.
window.ArkTranslation = (() => {
    const cache = new Map(), encoder = new TextEncoder();
    try {
        const entries = JSON.parse(localStorage.getItem('ark-translations-pt-v1') || '[]');
        if (Array.isArray(entries)) for (const entry of entries.slice(-60)) {
            if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') cache.set(entry[0], entry[1]);
        }
    } catch (_) {}
    function chunks(text, limit = 480) {
        const output = []; let current = '';
        for (const token of text.match(/\S+\s*|\s+/gu) || []) {
            if (encoder.encode(current + token).length <= limit) { current += token; continue; }
            if (current) { output.push(current); current = ''; }
            for (const char of token) {
                if (encoder.encode(current + char).length > limit) { output.push(current); current = ''; }
                current += char;
            }
        }
        if (current) output.push(current);
        return output;
    }
    async function segment(text, signal) {
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        if (cache.has(text)) return cache.get(text);
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, 10000);
        try {
            const params = new URLSearchParams({ q: text, langpair: 'en|pt-BR' });
            const response = await fetch('https://api.mymemory.translated.net/get?' + params, { signal: controller.signal });
            if (!response.ok) throw new Error('O serviço de tradução está indisponível.');
            const body = await response.json();
            if (Number(body.responseStatus) !== 200 || body.quotaFinished) throw new Error('O serviço de tradução atingiu o limite ou recusou a consulta. Tente novamente mais tarde.');
            const value = body.responseData?.translatedText;
            if (typeof value !== 'string' || !value.trim()) throw new Error('O serviço não retornou uma tradução válida.');
            if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
            const translated = value.replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name.toLowerCase()]);
            if (cache.size >= 60) cache.delete(cache.keys().next().value);
            cache.set(text, translated);
            try { localStorage.setItem('ark-translations-pt-v1', JSON.stringify([...cache])); } catch (_) {}
            return translated;
        } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
    }
    return {
        chunks,
        async toPortuguese(text, signal, onProgress = () => {}) {
            const parts = chunks(String(text || '')), output = [];
            for (let index = 0; index < parts.length; index++) {
                if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
                const part = parts[index], trimmed = part.trim();
                if (!trimmed) output.push(part);
                else output.push((part.match(/^\s*/u)?.[0] || '') + await segment(trimmed, signal) + (part.match(/\s*$/u)?.[0] || ''));
                onProgress(index + 1, parts.length);
            }
            return output.join('');
        }
    };
})();
