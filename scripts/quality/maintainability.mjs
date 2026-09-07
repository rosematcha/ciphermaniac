import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { builtinRules } from 'eslint/use-at-your-own-risk';

const limits = {
  complexity: [12],
  'max-depth': [3],
  'max-params': [4],
  'max-lines-per-function': [{ max: 100, skipBlankLines: true, skipComments: true }]
};

function fingerprint(source, node) {
  const tokens = source.getTokens(node).map(token => [token.type, token.value]);
  return createHash('sha256').update(JSON.stringify(tokens)).digest('hex');
}

function messageFor(rule, descriptor) {
  const template = descriptor.message ?? rule.meta.messages[descriptor.messageId];
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => String(descriptor.data[key]));
}

function enclosingFunction(source, descriptor) {
  let { node } = descriptor;
  if (!node) {
    const location = descriptor.loc.start ?? descriptor.loc;
    node = source.getNodeByRangeIndex(source.getIndexFromLoc(location));
  }
  while (node.parent && !/Function/.test(node.type)) {
    node = node.parent;
  }
  return node;
}

/** Reuse ESLint's metrics; exceptions apply only to an unchanged function. */
export function maintainabilityRule(root, baseline) {
  return {
    meta: {
      type: 'suggestion',
      schema: [],
      messages: { violation: '{{message}}', stale: 'Remove stale maintainability exception: {{key}}' }
    },
    create(context) {
      const file = relative(root, context.filename).replaceAll('\\', '/');
      const exceptions = baseline[file] ?? [];
      const remaining = [...exceptions];
      const listeners = {};
      for (const [name, options] of Object.entries(limits)) {
        const rule = builtinRules.get(name);
        const metricOptions =
          name === 'max-lines-per-function' && file.endsWith('.tsx') ? [{ ...options[0], max: 250 }] : options;
        const report = descriptor => {
          const node = enclosingFunction(context.sourceCode, descriptor);
          const message = messageFor(rule, descriptor);
          const key = `${name}:${fingerprint(context.sourceCode, node)}:${message}`;
          const index = remaining.indexOf(key);
          if (index !== -1) {
            remaining.splice(index, 1);
            return;
          }
          context.report({ node, messageId: 'violation', data: { message: `${message} [${key}]` } });
        };
        const metricContext = Object.create(context, {
          options: { value: metricOptions },
          report: { value: report }
        });
        for (const [selector, listener] of Object.entries(rule.create(metricContext))) {
          (listeners[selector] ??= []).push(listener);
        }
      }
      (listeners['Program:exit'] ??= []).push(node => {
        for (const key of remaining) {
          context.report({ node, messageId: 'stale', data: { key } });
        }
      });
      return Object.fromEntries(
        Object.entries(listeners).map(([selector, callbacks]) => [
          selector,
          (...args) => callbacks.forEach(callback => callback(...args))
        ])
      );
    }
  };
}
