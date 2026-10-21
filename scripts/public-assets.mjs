// Explicit allowlist shared by the development server and production build.
import {VENDOR_FILES} from './vendor-assets.mjs';
export const PUBLIC_FILES = Object.freeze([
    'index.html','manifest.json','sw.js','robots.txt',
    'assets/js/ux.js','assets/js/reader.js','assets/js/reader-controls.js','assets/js/personal-library.js','assets/js/grimoire.js','assets/js/reader-moments.js','assets/js/chapter-editor.js','assets/js/zip-chapters.js','assets/js/reader-experience.js','assets/js/discovery.js','assets/js/ai-discovery.js',
    'assets/js/cloud-reader.js','assets/js/external-progress.js','assets/js/continue-reading.js','assets/js/page-translation.js',
    'assets/js/mangadex.js','assets/js/auth.js','assets/js/metadata.js','assets/js/translation.js','assets/js/config.js',
    'assets/css/reader.css','assets/css/theme.css','assets/css/utilities.css','assets/images/icone.png',
    ...VENDOR_FILES
]);
