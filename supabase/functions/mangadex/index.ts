import { createMangaDexProxy, LOCAL_ORIGINS } from '../_shared/mangadex-proxy.mjs';
// Public read-only API: allow only your actual website origins in production.
const origins = Deno.env.get('ARK_ALLOWED_ORIGINS')?.split(',').map(value => value.trim()).filter(Boolean) || LOCAL_ORIGINS;
Deno.serve(createMangaDexProxy({ allowedOrigins: origins }));
