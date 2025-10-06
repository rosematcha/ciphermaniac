/**
 * JSDoc configuration for generating documentation
 * @file jsdoc.config.js
 */

export default {
  source: {
    include: ['./assets/js/'],
    includePattern: '\\.(js)$',
  exclude: ['node_modules/'],
  excludePattern: '(node_modules/)'
  },
  opts: {
    destination: './docs/api/',
    recurse: true,
    readme: './README.md'
  },
  plugins: ['plugins/markdown'],
  templates: {
    cleverLinks: false,
    monospaceLinks: false
  },
  sourceType: 'module',
  tags: {
    allowUnknownTags: true,
    dictionaries: ['jsdoc', 'closure']
  },
  markdown: {
    parser: 'gfm'
  }
};