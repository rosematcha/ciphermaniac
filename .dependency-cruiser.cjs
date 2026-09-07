module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-unresolved-imports',
      severity: 'error',
      from: { pathNot: '^shared/data/hash\\.ts$' },
      to: { couldNotResolve: true }
    },
    {
      name: 'hash-imports-resolve',
      severity: 'error',
      from: { path: '^shared/data/hash\\.ts$' },
      to: { couldNotResolve: true, pathNot: '^node$' }
    },
    {
      name: 'shared-has-no-adapters',
      severity: 'error',
      from: { path: '^shared/' },
      to: {
        path: '^(src|functions|scripts|\\.github)/|node_modules/(solid-js|@solidjs|@aws-sdk)/',
        pathNot: '^\\.github/scripts/data/set-catalog\\.json$'
      }
    },
    {
      name: 'edge-has-no-browser-or-producer',
      severity: 'error',
      from: { path: '^functions/' },
      to: { path: '^(src|scripts|\\.github)/|^shared/data/hash\\.ts$', reachable: true }
    },
    {
      name: 'browser-has-no-producer',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^(functions|scripts|\\.github)/|^shared/data/hash\\.ts$', reachable: true }
    },
    {
      name: 'domain-has-no-ui',
      severity: 'error',
      from: { path: '^src/(lib|utils)/.*\\.ts$' },
      to: { path: '^src/(pages|components)/.*\\.tsx$' }
    },
    {
      name: 'shared-has-no-node-builtins',
      severity: 'error',
      from: { path: '^shared/', pathNot: '^shared/data/hash\\.ts$' },
      to: { dependencyTypes: ['core'] }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.frontend.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.mts', '.d.ts', '.js', '.mjs', '.json']
    }
  }
};
