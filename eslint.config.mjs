// Dev-only lint config (ESLint flat config, v9+). Run: `npm run lint`.
// The project has ZERO npm dependencies, so this file imports nothing: globals and rules are listed inline and ESLint
// itself comes from a global install or `npx` (never from package.json). Not needed to run the app.

const shared = {
  console: 'readonly', globalThis: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', queueMicrotask: 'readonly', structuredClone: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly', fetch: 'readonly', Response: 'readonly', Request: 'readonly',
  Headers: 'readonly', Blob: 'readonly', FormData: 'readonly', performance: 'readonly', crypto: 'readonly',
  Intl: 'readonly', Event: 'readonly', EventTarget: 'readonly', atob: 'readonly', btoa: 'readonly',
};
const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', getComputedStyle: 'readonly',
  matchMedia: 'readonly', CustomEvent: 'readonly', FileReader: 'readonly', File: 'readonly', HTMLElement: 'readonly',
  Node: 'readonly', MutationObserver: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
  KeyboardEvent: 'readonly', MouseEvent: 'readonly', DOMParser: 'readonly', print: 'readonly', scrollTo: 'readonly',
};
const node = { process: 'readonly', Buffer: 'readonly', setImmediate: 'readonly', clearImmediate: 'readonly' };

// Core-rule subset of eslint:recommended (the recommended preset lives in @eslint/js, which this repo can't import).
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-redeclare': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-finally': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-fallthrough': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-sparse-arrays': 'error',
  'no-loss-of-precision': 'error',
};

const lang = (globals) => ({ ecmaVersion: 2023, sourceType: 'module', globals: { ...shared, ...globals } });

export default [
  { ignores: ['data/**', 'dist/**', 'node_modules/**', 'reports/**', 'scripts/.cache/**'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  // File sets are disjoint on purpose: flat config MERGES globals of overlapping blocks.
  // Server, adapters, scripts, tests, config files: Node.
  { files: ['**/*.js', '**/*.mjs'], ignores: ['js/**', 'tests/e2e/**'], languageOptions: lang(node), rules },
  // Browser E2E scripts: Node, plus browser globals inside page.evaluate() callbacks.
  { files: ['tests/e2e/**/*.mjs'], languageOptions: lang({ ...node, ...browser }), rules },
  // Browser UI.
  { files: ['js/**/*.js'], ignores: ['js/core/**'], languageOptions: lang(browser), rules },
  // js/core runs in BOTH browser and Node (valuation engine): only APIs both provide.
  { files: ['js/core/**/*.js'], languageOptions: lang({}), rules },
  { files: ['**/*.cjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...shared, ...node, require: 'readonly', module: 'writable', __dirname: 'readonly' } }, rules },
];
