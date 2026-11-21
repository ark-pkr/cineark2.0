import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['dist/**', 'node_modules/**', 'public/assets/vendor/**', 'supabase/functions/mangadex/index.ts'] },
    js.configs.recommended,
    {
        rules: {
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            eqeqeq: ['error', 'smart']
        }
    },
    {
        files: ['public/assets/js/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                ...globals.browser,
                Vue: 'readonly',
                supabase: 'readonly',
                _supabase: 'readonly',
                module: 'readonly'
            }
        }
    },
    {
        files: ['public/sw.js'],
        languageOptions: { sourceType: 'script', globals: globals.serviceworker }
    },
    {
        files: ['**/*.mjs'],
        languageOptions: { sourceType: 'module', globals: globals.node }
    },
    {
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs', globals: globals.node }
    }
];
