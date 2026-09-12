#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { manageBot, prepareWorkspace, recordNative } from './workspace.js';
import { inventory, verifyMigration } from './migration.js';
import { installSkill, inspectSkills } from './skills.js';
import { planHandoff, recordHandoff, planNotices, recordNotice, recordFinding } from './coordination.js';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      config: { type: 'string' },
      bot: { type: 'string' },
      receipt: { type: 'string' },
      source: { type: 'string' },
      output: { type: 'string' },
      inventory: { type: 'string' },
      destination: { type: 'string' },
      'expected-revision': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(`bot-kit <prepare|inspect|regenerate> --workspace ABSOLUTE_PATH [--bot ID] [--expected-revision TOKEN]
bot-kit <create-bot|configure-bot> --workspace ABSOLUTE_PATH --config ABSOLUTE_YAML [--expected-revision TOKEN]
bot-kit record-native --workspace ABSOLUTE_PATH --bot ID --receipt ABSOLUTE_YAML [--expected-revision TOKEN]
bot-kit inventory --source ABSOLUTE_PATH [--output ABSOLUTE_YAML]
bot-kit verify-migration --inventory ABSOLUTE_YAML --destination ABSOLUTE_PATH
bot-kit install-skill --workspace ABSOLUTE_PATH --config ABSOLUTE_YAML [--expected-revision TOKEN]
bot-kit inspect-skills --workspace ABSOLUTE_PATH [--bot ID]
bot-kit <plan-handoff|record-handoff|record-notice|record-finding> --workspace ABSOLUTE_PATH --config ABSOLUTE_YAML [--expected-revision TOKEN]
bot-kit plan-notices --workspace ABSOLUTE_PATH [--expected-revision TOKEN]
`);
  } else {
    const commands = ['prepare', 'inspect', 'regenerate', 'create-bot', 'configure-bot', 'record-native', 'inventory', 'verify-migration', 'install-skill', 'inspect-skills', 'plan-handoff', 'record-handoff', 'plan-notices', 'record-notice', 'record-finding'];
    if (positionals.length !== 1 || !commands.includes(positionals[0])) {
      throw new Error('Choose a supported command. Use --help for usage.');
    }
    const command = positionals[0]; const expectedRevision = values['expected-revision'];
    let result;
    if (command === 'plan-handoff') result = planHandoff(values.workspace, values.config);
    else if (command === 'record-handoff') result = recordHandoff(values.workspace, values.config, expectedRevision);
    else if (command === 'plan-notices') result = planNotices(values.workspace, expectedRevision);
    else if (command === 'record-notice') result = recordNotice(values.workspace, values.config, expectedRevision);
    else if (command === 'record-finding') result = recordFinding(values.workspace, values.config, expectedRevision);
    else if (command === 'install-skill') result = installSkill(values.workspace, values.config, expectedRevision);
    else if (command === 'inspect-skills') result = inspectSkills(values.workspace, values.bot);
    else if (command === 'inventory') result = inventory(values.source, values.output);
    else if (command === 'verify-migration') result = verifyMigration(values.inventory, values.destination);
    else if (command === 'record-native') result = recordNative(values.workspace, values.bot, values.receipt, expectedRevision);
    else if (['create-bot', 'configure-bot'].includes(command)) result = manageBot(values.workspace, values.config, { configure: command === 'configure-bot', expectedRevision });
    else result = prepareWorkspace(values.workspace, { inspect: command === 'inspect', expectedRevision, bot: values.bot });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'error', message: error.message, ...error.progress })}\n`);
  process.exitCode = 1;
}
