// Explicitly served and precached build artifacts. No package directory is public.
export const FONT_FILES = [
    'poppins-latin-400-normal.woff2',
    'poppins-latin-600-normal.woff2',
    'poppins-latin-700-normal.woff2',
    'poppins-latin-900-normal.woff2',
    'bangers-latin-400-normal.woff2',
    'metal-mania-latin-400-normal.woff2',
    'noto-sans-runic-runic-400-normal.woff2'
];
// Subset at build time to the icons in use (see icon-assets.mjs); brands, v4 shims and TTF fallbacks are unused.
export const ICON_FILES = ['fa-solid-900.woff2', 'fa-regular-400.woff2'];
export const VENDOR_FILES = [
    'assets/vendor/vue/vue.global.prod.js',
    'assets/vendor/supabase/supabase.js',
    'assets/vendor/fonts/fonts.css',
    'assets/vendor/fontawesome/css/all.min.css',
    'assets/vendor/THIRD-PARTY-LICENSES.txt',
    ...FONT_FILES.map(name => 'assets/vendor/fonts/' + name),
    ...ICON_FILES.map(name => 'assets/vendor/fontawesome/webfonts/' + name)
];
