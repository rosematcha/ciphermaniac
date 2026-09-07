import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import solid from 'eslint-plugin-solid';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import { maintainabilityRule } from './scripts/quality/maintainability.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.scratch/**',
      '.venv/**',
      'coverage/**',
      '.claude/**',
      'static/**',
      'archive/**',
      'dev/**',
      'tests/fixtures/**'
    ]
  },
  js.configs.recommended,
  ...ts.configs['flat/recommended'],
  solid.configs['flat/typescript'],
  prettier,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "PropertyDefinition[kind='field'][key.type='PrivateIdentifier']",
          message:
            'Private class fields are disallowed for compatibility with older mobile browsers. Use underscored properties or closures instead.'
        }
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-undef': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'one-var': ['error', 'never'],
      'one-var-declaration-per-line': ['error', 'always'],
      'vars-on-top': 'error',
      eqeqeq: [
        'error',
        'always',
        {
          null: 'ignore'
        }
      ],
      'use-isnan': 'error',
      'valid-typeof': 'error',
      yoda: ['error', 'never'],
      curly: ['error', 'all'],
      'consistent-return': 'error',
      'default-case': 'warn',
      'default-case-last': 'error',
      'default-param-last': 'error',
      'no-fallthrough': 'error',
      'no-else-return': [
        'error',
        {
          allowElseIf: false
        }
      ],
      'guard-for-in': 'error',
      semi: 'off',
      quotes: 'off',
      indent: 'off',
      'linebreak-style': 'off',
      'max-len': 'off',
      'arrow-body-style': 'off',
      'arrow-parens': 'off',
      'arrow-spacing': 'off',
      'generator-star-spacing': 'off',
      'rest-spread-spacing': 'off',
      'template-curly-spacing': 'off',
      'yield-star-spacing': 'off',
      'array-bracket-spacing': 'off',
      'brace-style': 'off',
      'comma-dangle': 'off',
      'comma-spacing': 'off',
      'comma-style': 'off',
      'computed-property-spacing': 'off',
      'func-call-spacing': 'off',
      'key-spacing': 'off',
      'keyword-spacing': 'off',
      'no-multiple-empty-lines': 'off',
      'no-whitespace-before-property': 'off',
      'object-curly-spacing': 'off',
      'padded-blocks': 'off',
      'space-before-blocks': 'off',
      'space-before-function-paren': 'off',
      'space-in-parens': 'off',
      'space-infix-ops': 'off',
      'space-unary-ops': 'off',
      'spaced-comment': 'off',
      'no-trailing-spaces': 'error',
      'eol-last': 'error',
      'no-mixed-spaces-and-tabs': 'error',
      'no-tabs': 'error',
      'no-param-reassign': [
        'error',
        {
          props: true,
          ignorePropertyModificationsFor: [
            'synonymsDict',
            'canonicalsDict',
            'element',
            'el',
            'img',
            'baseImg',
            'container',
            'node',
            'ctx',
            'context',
            'card',
            'message',
            'fallback',
            'canvas',
            'wrapper',
            'target',
            'metaSection',
            'trigger',
            'cache',
            'state',
            'row',
            'r',
            'item',
            'entry',
            'suggestionsBox',
            'cardSearchInput'
          ]
        }
      ],
      'prefer-rest-params': 'error',
      'array-callback-return': [
        'error',
        {
          allowImplicit: true
        }
      ],
      'no-empty-function': [
        'error',
        {
          allow: ['arrowFunctions']
        }
      ],
      'dot-notation': 'error',
      'no-prototype-builtins': 'error',
      'prefer-object-spread': 'error',
      'no-useless-computed-key': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-destructuring': [
        'error',
        {
          array: false,
          object: true
        }
      ],
      'no-implicit-coercion': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unsafe-negation': 'error',
      'no-implicit-globals': 'error',
      radix: 'error',
      'no-empty': [
        'error',
        {
          allowEmptyCatch: false
        }
      ],
      'prefer-promise-reject-errors': 'error',
      'no-async-promise-executor': 'error',
      'no-return-await': 'error',
      'require-atomic-updates': 'off',
      'no-await-in-loop': 'off',
      'require-await': 'off',
      'no-alert': 'error',
      'no-caller': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-extra-label': 'error',
      'no-global-assign': 'error',
      'no-implied-eval': 'error',
      'no-invalid-this': 'error',
      'no-iterator': 'error',
      'no-labels': 'error',
      'no-lone-blocks': 'error',
      'no-loop-func': 'error',
      'no-multi-spaces': 'error',
      'no-multi-str': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-nonoctal-decimal-escape': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-redeclare': 'error',
      'no-return-assign': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true
        }
      ],
      'no-useless-backreference': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-void': 'off',
      'no-with': 'error',
      'no-delete-var': 'error',
      'block-scoped-var': 'error',
      'no-floating-decimal': 'error',
      'no-case-declarations': 'error',
      'no-div-regex': 'error',
      'no-empty-pattern': 'error',
      'wrap-iife': ['error', 'outside'],
      'prefer-regex-literals': 'error',
      'prefer-named-capture-group': 'off',
      'require-unicode-regexp': 'off',
      'max-nested-callbacks': ['warn', 4],
      'max-statements': 'off',
      'no-magic-numbers': 'off',
      'max-lines': [
        'error',
        {
          max: 995,
          skipBlankLines: true,
          skipComments: true
        }
      ],
      'no-nested-ternary': 'off',
      'no-unneeded-ternary': 'error',
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error',
      camelcase: [
        'error',
        {
          properties: 'always',
          ignoreDestructuring: false,
          ignoreImports: false,
          allow: ['price_usd']
        }
      ],
      'id-length': 'off',
      'new-cap': [
        'error',
        {
          newIsCap: true,
          capIsNew: false
        }
      ],
      'class-methods-use-this': 'off',
      'grouped-accessor-pairs': ['error', 'getBeforeSet'],
      'no-constructor-return': 'error',
      'no-console': 'off',
      'no-debugger': 'error',
      'no-inline-comments': 'off',
      'no-warning-comments': 'off',
      'operator-assignment': ['error', 'always'],
      'constructor-super': 'error',
      'no-class-assign': 'error',
      'no-confusing-arrow': 'off',
      'no-const-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-imports': 'error',
      'no-new-symbol': 'error',
      'no-this-before-super': 'error',
      'no-useless-constructor': 'error',
      'no-useless-rename': 'error',
      'prefer-arrow-callback': [
        'error',
        {
          allowNamedFunctions: false
        }
      ],
      'prefer-exponentiation-operator': 'error',
      'prefer-numeric-literals': 'error',
      'prefer-object-has-own': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'require-yield': 'error',
      'sort-imports': [
        'warn',
        {
          ignoreCase: true,
          ignoreDeclarationSort: true
        }
      ],
      'symbol-description': 'error',
      'no-loss-of-precision': 'error',
      'no-promise-executor-return': 'error',
      'no-template-curly-in-string': 'warn',
      'no-unsafe-finally': 'error',
      'for-direction': 'error',
      'getter-return': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': 'error',
      'no-constant-binary-expression': 'error',
      'no-constant-condition': 'error',
      'no-control-regex': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty-character-class': 'error',
      'no-ex-assign': 'error',
      'no-extra-boolean-cast': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-inner-declarations': 'error',
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': 'error',
      'no-misleading-character-class': 'error',
      'no-obj-calls': 'error',
      'no-regex-spaces': 'error',
      'no-setter-return': 'error',
      'no-sparse-arrays': 'error',
      'no-unexpected-multiline': 'error',
      'no-useless-escape': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true
        }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'prettier/prettier': 'error'
    }
  },
  {
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/**', '../src/*', '../../src/*'],
              message: 'shared/ must not import frontend code. Move the shared piece down into shared/ instead.'
            },
            {
              group: ['**/functions/**'],
              message: 'shared/ must not import Cloudflare Functions. Move the shared piece down into shared/ instead.'
            },
            {
              group: ['solid-js', 'solid-js/*', '@solidjs/*'],
              message: 'shared/ is isomorphic - it runs in Node producers and Workers, where Solid does not exist.'
            },
            {
              group: ['@aws-sdk/*'],
              message: 'shared/ must not depend on a storage vendor. Take an ObjectStore-shaped parameter instead.'
            },
            {
              group: ['node:*'],
              message:
                'shared/ runs in the browser too. Node built-ins belong in a producer module (see shared/data/hash.ts for the one sanctioned exception).'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['shared/data/hash.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/**', '../src/*', '../../src/*'],
              message: 'shared/ must not import frontend code.'
            },
            {
              group: ['**/functions/**'],
              message: 'shared/ must not import Cloudflare Functions.'
            },
            {
              group: ['solid-js', 'solid-js/*', '@solidjs/*'],
              message: 'shared/ is isomorphic.'
            },
            {
              group: ['@aws-sdk/*'],
              message: 'shared/ must not depend on a storage vendor.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['functions/**/*.ts', 'functions/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/**', '../src/*', '../../src/*', '../../../src/*'],
              message: 'Edge Functions must not import frontend code. Shared logic belongs in shared/.'
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      'tests/**/*.ts',
      'tests/**/*.js',
      'dev/tests/**/*.ts',
      'scripts/**/*.test.ts',
      '**/*.test.ts',
      '**/*.test.js',
      '**/*.test.mjs'
    ],
    languageOptions: {
      globals: {}
    },
    rules: {
      'no-magic-numbers': 'off',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'max-params': 'off',
      complexity: 'off',
      'max-nested-callbacks': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',
      'id-length': 'off'
    }
  },
  {
    files: ['functions/**/*.ts', 'functions/**/*.js'],
    languageOptions: {
      globals: {
        window: 'off',
        document: 'off'
      }
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', '.github/scripts/**/*.{ts,mts,mjs,js}'],
    languageOptions: {
      globals: {
        window: 'off',
        document: 'off'
      }
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-unused-vars': 'off'
    }
  },
  {
    files: [
      'src/**/*.{ts,tsx}',
      'shared/**/*.ts',
      'functions/**/*.{ts,js}',
      'scripts/**/*.{ts,mjs,js}',
      '.github/scripts/**/*.{ts,mjs,js}'
    ],
    plugins: {
      quality: {
        rules: {
          maintainability: maintainabilityRule(
            root,
            JSON.parse(readFileSync(new URL('./config/quality/maintainability.json', import.meta.url), 'utf8'))
          )
        }
      }
    },
    rules: {
      complexity: 'off',
      'max-depth': 'off',
      'max-params': 'off',
      'max-lines-per-function': 'off',
      'quality/maintainability': 'error'
    }
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.frontend.json', './tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: root
      }
    },
    rules: {
      'no-return-await': 'off',
      'default-case': 'off',
      'consistent-return': 'off',
      '@typescript-eslint/consistent-return': 'error',
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'file', path: 'node_modules/@types/node/test.d.ts', name: ['test', 'it', 'describe'] }
          ]
        }
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error'
    }
  },
  {
    files: ['shared/data/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error'
    }
  }
];
