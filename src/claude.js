import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { absolute, fail, hash, readText, yaml } from './workspace.js';

function text(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail(`${field}: expected nonempty text without NUL bytes.`);
  return value;
}
function clean(value) {
  // Auth probe output is never returned. Retain useful execution text while
  // removing recognizable credentials and actual secret environment values.
  let result = value.slice(0, 65536);
  for (const [name, secret] of Object.entries(process.env)) {
    if (/(?:TOKEN|API_KEY|PASSWORD|SECRET)/i.test(name) && secret.length >= 8) result = result.split(secret).join('[redacted]');
  }
  return result.replace(/\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{20,})\b/g, '[redacted]').replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]');
}
function invoke(executable, args, cwd, timeout) {
  return spawnSync(executable, args, { cwd, shell: false, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
}
function parsed(output) { try { return JSON.parse(output); } catch { return null; } }

export function runClaude(file) {
  file = absolute(file, '--config'); const packet = yaml(readText(file), file);
  const allowed = ['schema_version', 'executable', 'cwd', 'objective', 'context', 'authority', 'return_to', 'rules', 'model', 'effort', 'resume', 'timeout_ms'];
  for (const key of Object.keys(packet)) if (!allowed.includes(key)) fail(`Unsupported Claude packet field: ${key}. Do not inject arbitrary executor arguments.`);
  const executable = absolute(packet.executable, 'executable'), cwd = absolute(packet.cwd, 'cwd');
  if (!fs.statSync(cwd).isDirectory()) fail('cwd must be an existing directory.');
  for (const field of ['objective', 'context', 'authority', 'return_to']) text(packet[field], field);
  for (const field of ['model', 'effort', 'resume']) if (packet[field] !== undefined) text(packet[field], field);
  const timeout = packet.timeout_ms ?? 120000;
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 600000) fail('timeout_ms must be an integer between 10 and 600000.');
  if (!Array.isArray(packet.rules) || !packet.rules.length) fail('rules must contain the applicable selected bot/target guidance.');
  const rules = packet.rules.map((rule) => {
    if (!['bot', 'target'].includes(rule?.role)) fail('Rule role must be bot or target.');
    const rulePath = absolute(rule.path, 'rule.path');
    if (!fs.statSync(rulePath).isFile()) fail('Rule path must be an existing ordinary file.');
    const contents = readText(rulePath);
    return { role: rule.role, path: rulePath, sha256: hash(contents), contents };
  });
  const execution = { exit_code: null, signal: null, timed_out: false, version: null,
    ...Object.fromEntries(['model', 'effort', 'resume'].filter((field) => packet[field] !== undefined).map((field) => [`requested_${field}`, packet[field]])) };
  const result = { status: 'unavailable', return_to: packet.return_to, execution, errors: [], adaptation: { method: 'append-system-prompt', rules: rules.map(({ contents, ...rule }) => rule) }, outcome_verified: false };
  const unavailable = (message) => { result.errors.push(message); return result; };
  const version = invoke(executable, ['--version'], cwd, 10000);
  if (version.error || version.status !== 0) return unavailable('The selected Claude executable/version is unavailable. Check that local installation; no execution began.');
  execution.version = clean(version.stdout.trim());
  const help = invoke(executable, ['--help'], cwd, 10000);
  if (help.error || help.status !== 0) return unavailable('Could not inspect the selected CLI capabilities; no execution began.');
  const flags = ['--output-format', '--append-system-prompt', ...['model', 'effort', 'resume'].filter((field) => packet[field] !== undefined).map((field) => `--${field}`)];
  if (!/(?:^|\s|,)(?:-p|--print)(?:\s|,|$)/m.test(help.stdout)) return unavailable('The selected CLI does not expose supported noninteractive print mode.');
  for (const flag of flags) if (!new RegExp(`(?:^|\\s)${flag}(?:\\s|[=,]|$)`, 'm').test(help.stdout)) return unavailable(`The selected CLI does not expose ${flag}; preserve the requested choice and choose a supported setup.`);
  if (packet.effort !== undefined) {
    const section = help.stdout.match(/--effort\b([\s\S]*?)(?=\n\s*--[a-z]|$)/)?.[1] ?? '';
    const choices = section.match(/\((?:choices:\s*)?([^)]*)\)/)?.[1]?.match(/[a-z]+/g) ?? [];
    if (!choices.includes(packet.effort)) return unavailable('The requested effort is not among the selected CLI\'s observed supported choices; no setting was substituted.');
  }
  const auth = invoke(executable, ['auth', 'status', '--json'], cwd, 10000);
  if (auth.error || auth.status !== 0 || parsed(auth.stdout)?.loggedIn !== true) return unavailable('Authentication is unavailable or could not be verified. Use the selected local provider\'s supported setup; no login or execution was started.');
  const guidance = rules.map((rule) => `## Applicable ${rule.role} guidance (${rule.path})\n\n${rule.contents}`).join('\n\n');
  const prompt = ['objective', 'context', 'authority', 'return_to'].map((field) => `${field}:\n${packet[field]}`).join('\n\n');
  const args = ['-p', prompt, '--output-format', 'json', '--append-system-prompt', guidance];
  for (const field of ['model', 'effort', 'resume']) if (packet[field] !== undefined) args.push(`--${field}`, packet[field]);
  const response = invoke(executable, args, cwd, timeout);
  execution.exit_code = response.status; execution.signal = response.signal; execution.timed_out = response.error?.code === 'ETIMEDOUT';
  const body = parsed(response.stdout);
  if (typeof body?.result === 'string') result.result = clean(body.result);
  if (typeof body?.session_id === 'string' && body.session_id) result.session_id = clean(body.session_id);
  const completed = !response.error && response.status === 0 && body?.type === 'result' && body.subtype === 'success' && body.is_error === false && typeof body.result === 'string';
  result.status = completed ? 'completed' : 'failed';
  if (!completed) {
    result.errors.push(execution.timed_out ? 'Execution timed out; the direct child was terminated. Partial work is not rolled back and descendant cleanup is not verified.'
      : response.error ? `Execution could not complete (${response.error.code ?? 'process error'}); output/process bounds may have been reached.`
        : 'The process status or structured final result indicates failure or an unsupported result format.');
    if (Array.isArray(body?.errors)) for (const error of body.errors) if (typeof error === 'string') result.errors.push(clean(error));
    if (response.stderr?.trim()) result.errors.push(clean(response.stderr.trim()));
  }
  result.next_action = completed ? 'Verify the assigned outcome and artifacts, then return the result to the named origin.' : 'Preserve partial work and obtain the applicable recovery choice; do not silently retry, start fresh or change settings.';
  return result;
}
