import { createMangaDexProxy } from '../../supabase/functions/_shared/mangadex-proxy.mjs';
export default createMangaDexProxy();
export const config = { path: '/mangadex' };
