/**
 * Minimal DOM shim for tests that transitively import browser-only modules.
 * Must be loaded via --import BEFORE any test file.
 */
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: (tag: string) => ({
      tagName: tag,
      id: '',
      className: '',
      innerHTML: '',
      style: {},
      appendChild: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      remove: () => {},
      setAttribute: () => {},
      getAttribute: () => null
    }),
    body: {
      appendChild: () => {},
      querySelector: () => null
    }
  };
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

if (typeof globalThis.location === 'undefined') {
  (globalThis as any).location = {
    search: '',
    href: 'http://localhost/',
    pathname: '/',
    origin: 'http://localhost',
    hostname: 'localhost',
    host: 'localhost',
    port: '',
    protocol: 'http:',
    hash: '',
    reload: () => {},
    assign: () => {},
    replace: () => {},
    toString: () => 'http://localhost/'
  };
}

if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { userAgent: 'node-test' };
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null
  };
}

if (typeof globalThis.HTMLElement === 'undefined') {
  (globalThis as any).HTMLElement = class HTMLElement {};
}
