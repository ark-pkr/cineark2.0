// Read-only checks. Uses only the public anon key already shipped with the site.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8'), context);
const config = context.window.CINE_ARK_CONFIG;
const base = new URL(config.supabaseUrl);
if (base.protocol !== 'https:') throw new Error('Supabase URL must use HTTPS');
if (base.username || base.password) throw new Error('Do not put credentials in the URL');
const headers = { apikey: config.supabaseAnonKey };
// Publishable keys are API keys, not user JWTs. Legacy anon JWTs also work as bearer tokens.
if (config.supabaseAnonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.supabaseAnonKey}`;

async function check(name, endpoint, summarize) {
    try {
        const response = await fetch(new URL(endpoint, base), { headers, signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
            let code = null;
            try { code = (await response.json()).code; } catch (_) {}
            console.log(JSON.stringify({ check: name, ok: false, status: response.status, code }));
            process.exitCode = 1; return;
        }
        const data = await response.json();
        console.log(JSON.stringify({ check: name, ok: true, ...summarize(data) }));
    } catch (error) {
        console.log(JSON.stringify({ check: name, ok: false, error: error.cause?.code || error.name }));
        process.exitCode = 1;
    }
}
Promise.all([
    check('authentication', '/auth/v1/settings', data => ({ emailEnabled: data.external?.email,
        signupDisabled: data.disable_signup, emailConfirmationRequired: !data.mailer_autoconfirm })),
    check('catalog', '/rest/v1/itens_catalogo?select=id&limit=0', () => ({}))
]).then(() => console.log('As verificações não alteram dados e não comprovam as políticas de escrita. Use também supabase/verify-configuration.sql.'));
