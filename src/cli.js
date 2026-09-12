#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { prepareWorkspace } from './workspace.js';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      'expected-revision': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write('bot-kit <prepare|inspect|regenerate> --workspace ABSOLUTE_PATH [--expected-revision TOKEN]\n');
  } else {
    if (positionals.length !== 1 || !['prepare', 'inspect', 'regenerate'].includes(positionals[0])) {
      throw new Error('Choose prepare, inspect or regenerate. Use --help for usage.');
    }
    const result = prepareWorkspace(values.workspace, {
      inspect: positionals[0] === 'inspect',
      expectedRevision: values['expected-revision'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'error', message: error.message, ...error.progress })}\n`);
  process.exitCode = 1;
}
