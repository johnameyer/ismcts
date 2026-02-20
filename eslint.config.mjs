import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default defineConfig([
    {
        ignores: ['dist/**', 'node_modules/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        plugins: {
            '@stylistic': stylistic,
            'unused-imports': unusedImports,
            import: importPlugin,
        },

        languageOptions: {
            globals: {
                ...globals.node,
                Atomics: 'readonly',
                SharedArrayBuffer: 'readonly',
            },
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 2018,
                sourceType: 'module',
            },
        },

        rules: {
            curly: 'error',
            'dot-notation': 'error',
            eqeqeq: 'error',
            'no-else-return': 'error',
            'no-empty': 'warn',
            'no-empty-function': 'warn',
            'no-fallthrough': 'warn',
            'no-inner-declarations': 'off',
            'no-unneeded-ternary': 'error',
            'operator-assignment': 'error',
            'prefer-const': 'error',
            'prefer-numeric-literals': 'error',
            'prefer-object-spread': 'error',
            'prefer-rest-params': 'warn',
            yoda: 'error',
            '@stylistic/arrow-spacing': 'error',

            '@stylistic/array-bracket-spacing': ['error', 'always', {
                objectsInArrays: false,
                arraysInArrays: false,
            }],

            '@stylistic/block-spacing': 'error',
            '@stylistic/brace-style': 'error',
            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/comma-spacing': 'error',
            '@stylistic/comma-style': 'error',
            '@stylistic/computed-property-spacing': 'error',
            '@stylistic/dot-location': ['error', 'property'],
            '@stylistic/eol-last': 'error',
            '@stylistic/func-call-spacing': 'error',

            '@stylistic/generator-star-spacing': ['error', {
                before: true,
                after: true,
            }],

            '@stylistic/implicit-arrow-linebreak': 'error',
            '@stylistic/indent': ['error', 4],
            '@stylistic/key-spacing': 'error',
            '@stylistic/keyword-spacing': 'error',
            '@stylistic/linebreak-style': 'error',
            '@stylistic/lines-between-class-members': 'error',
            '@stylistic/multiline-comment-style': 'off',
            '@stylistic/new-parens': 'error',
            '@stylistic/newline-per-chained-call': 'error',
            '@stylistic/no-multi-spaces': 'error',
            '@stylistic/no-multiple-empty-lines': 'error',
            '@stylistic/no-whitespace-before-property': 'error',

            '@stylistic/object-curly-newline': ['error', {
                consistent: true,
            }],

            '@stylistic/object-curly-spacing': ['error', 'always', {
                objectsInObjects: false,
            }],

            '@stylistic/operator-linebreak': ['error', 'before'],
            '@stylistic/quote-props': ['error', 'as-needed'],
            '@stylistic/quotes': ['error', 'single'],
            '@stylistic/semi': ['error', 'always'],
            '@stylistic/semi-spacing': 'error',
            '@stylistic/semi-style': 'error',
            '@stylistic/space-before-blocks': 'error',

            '@stylistic/space-before-function-paren': ['error', {
                anonymous: 'never',
                named: 'never',
                asyncArrow: 'always',
            }],

            '@stylistic/space-in-parens': ['error', 'never'],
            '@stylistic/space-infix-ops': 'error',

            '@stylistic/space-unary-ops': ['error', {
                words: true,
                nonwords: false,
            }],

            '@stylistic/spaced-comment': 'error',
            '@stylistic/switch-colon-spacing': 'error',
            '@stylistic/yield-star-spacing': ['error', 'both'],
            '@typescript-eslint/ban-ts-comment': 'warn',
            // '@typescript-eslint/explicit-module-boundary-types': 'warn',
            '@typescript-eslint/no-empty-function': 'warn',

            '@typescript-eslint/no-empty-object-type': ['error', {
                allowObjectTypes: 'always',
            }],

            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-namespace': 'off',

            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],

            'import/first': 'error',
            'import/newline-after-import': 'error',
            'import/no-absolute-path': 'error',
            'import/no-cycle': 'error',
            'import/no-extraneous-dependencies': 'error',
            'import/no-mutable-exports': 'error',
            'import/no-relative-packages': 'error',
            'import/no-unused-modules': 'error',
            'import/no-useless-path-segments': 'error',
            'import/order': 'error',
            'unused-imports/no-unused-imports': 'error',
        },
    },
    {
        files: [
            'src/utils/**/*.ts',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [ '@cards-ts/pocket-tcg', '@cards-ts/pocket-tcg/**' ],
                            message: 'Utils are game-agnostic. Cannot import @cards-ts/pocket-tcg. Use types passed via function parameters instead.',
                        },
                        {
                            group: [ '@cards-ts/euchre', '@cards-ts/euchre/**' ],
                            message: 'Utils are game-agnostic. Cannot import @cards-ts/euchre. Use types passed via function parameters instead.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: [
            'src/modular/**/*.ts',
        ],
        rules: {
            '@typescript-eslint/no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [ '@cards-ts/!(core)' ],
                            message: 'Modular classes must not import game-specific packages. Only @cards-ts/core is allowed.',
                        },
                        {
                            group: [ '../adapters', '../adapters/**' ],
                            message: 'Modular classes must not import from adapters. Adapters provide callbacks to modular, not the reverse.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: [
            'src/strategies/**/*.ts',
        ],
        rules: {
            '@typescript-eslint/no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [ '@cards-ts/!(core)' ],
                            message: 'Strategies must not import game-specific packages. Only @cards-ts/core is allowed.',
                        },
                        {
                            group: [ '../adapters', '../adapters/**' ],
                            message: 'Strategies must not import from specific adapters. Strategies should be game-agnostic.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: [
            'src/adapters/**/*.ts',
        ],
        rules: {
            '@typescript-eslint/no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [ '../modular', '../modular/**' ],
                            message: 'Adapters must not import from modular. Adapters provide data/callbacks to modular, not the reverse.',
                        },
                        {
                            group: [ '../strategies', '../strategies/**' ],
                            message: 'Adapters must not import strategies. Adapters should not depend on strategy selection logic.',
                        },
                        {
                            group: [ '../adapters/**' ],
                            message: 'Adapters must not import from other adapters. Each adapter should be independent.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: [
            'src/utils/**/*.ts',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [ '@cards-ts/!(core)' ],
                            message: 'Utils are game-agnostic. Cannot import game-specific packages. Only @cards-ts/core is allowed.',
                        },
                        {
                            group: [ '../modular', '../modular/**' ],
                            message: 'Utils must not import from modular. Utils are infrastructure for modular, not the reverse.',
                        },
                        {
                            group: [ '../adapters', '../adapters/**' ],
                            message: 'Utils must not import from adapters. Utils are game-agnostic infrastructure.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['**/spec/*.ts', '**/spec/**/*.ts'],

        rules: {
            'import/no-extraneous-dependencies': ['off'],
            '@typescript-eslint/no-unused-expressions': ['off'],
        },
    },
]);
