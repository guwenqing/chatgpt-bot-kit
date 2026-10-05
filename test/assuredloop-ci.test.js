// AssuredLoop in CI, and installed one pinned way (#495). AssuredLoop 0.1.0 is
// on npm as @assuredloop/cli, and its skill ships inside the package. So
// AGENTS.md names that package at 0.1.0 in place of a git clone, and every pull
// request runs `al check --strict` from the same pinned install. `al check`
// reads the tier from the commit history, so the checkout fetches all of it.
//
// The new check is found by what it does, a step that runs `al check --strict`,
// and not by its name. Whether the other jobs and publish.yml are byte for byte
// what they were is a property of the change, left to the review of the diff:
// a test of it would forbid every later edit. What is tested here is that the
// check did not move into them.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

import { repoRoot } from './helpers/cli.js';

const PACKAGE = '@assuredloop/cli';
const VERSION = '0.1.0';
const SKILL_IN_PACKAGE = `${PACKAGE}/skills/assuredloop/SKILL.md`;
const OLD_COMMIT = '056d24c';

const readText = (rel) => readFile(path.join(repoRoot, rel), 'utf8');
const readWorkflow = async (name) => parse(await readText(path.join('.github', 'workflows', name)));

/** The AssuredLoop section of AGENTS.md: its heading down to the next one. */
async function assuredLoopSection() {
  const text = await readText('AGENTS.md');
  const start = text.search(/^## .*AssuredLoop/m);
  assert.ok(start >= 0, 'AGENTS.md should keep a section headed AssuredLoop');
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end);
}

/** Every version a text gives the package: what follows `@assuredloop/cli@`. */
const specsIn = (text) => [...text.matchAll(/@assuredloop\/cli@([^\s`'"(),[\]]+)/g)].map((match) => match[1].replace(/\.$/, ''));

/** Whether a text names 0.1.0 as a whole version, not as part of 10.1.0 or 0.1.0-beta. */
const namesTheVersion = (text) => /(?:^|[^\w.^~<>=-])v?0\.1\.0(?![\w-]|\.\d)/.test(text);

const jobsOf = (doc) => doc?.jobs ?? {};
const stepsOf = (job) => job?.steps ?? [];
const needsOf = (job) => [job?.needs ?? []].flat();
const runOf = (step) => (typeof step?.run === 'string' ? step.run : '');
/** The events a workflow runs on, however `on` is written. */
function triggersOf(doc) {
  const on = doc?.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

/**
 * The commands a `run` holds, one for each line or each part of a line between
 * `&&`, `||`, `;` and `|`, as words. Env settings in front are dropped, and so
 * is a comment. A line broken with a backslash is one line.
 */
function commandsIn(run) {
  const commands = [];
  for (const line of run.replace(/\\\n/g, ' ').split('\n')) {
    for (const part of line.replace(/(^|\s)#.*$/, '').split(/&&|\|\||;|\|/)) {
      const words = part.trim().split(/\s+/).filter(Boolean);
      while (/^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift();
      if (words.length > 0) commands.push(words);
    }
  }
  return commands;
}

/** Whether a command is `al check` with `--strict`, with or without a `!` in front. */
function isStrictCheck(words) {
  const at = words[0] === '!' ? 1 : 0;
  return words[at] === 'al' && words[at + 1] === 'check' && words.slice(at + 2).includes('--strict');
}

/** Whether a step's `run` runs `al check --strict`. */
const runsStrictCheck = (step) => commandsIn(runOf(step)).some(isStrictCheck);

/** Whether a command is an npm install into the global folder. */
function isGlobalInstall(words) {
  if (words[0] !== 'npm') return false;
  const rest = words.slice(1);
  const verb = rest.find((word) => !word.startsWith('-'));
  const global = rest.some((word) => ['-g', '--global', '--location=global'].includes(word));
  return ['install', 'i', 'add'].includes(verb) && global;
}

/** The package specs a step's npm installs name for AssuredLoop's CLI. */
const installedSpecs = (step) => commandsIn(runOf(step))
  .filter((words) => words[0] === 'npm')
  .flatMap((words) => words.filter((word) => word === PACKAGE || word.startsWith(`${PACKAGE}@`)));

/** Whether a step installs AssuredLoop's CLI globally, at 0.1.0 exactly. */
const installsPinned = (step) => commandsIn(runOf(step))
  .some((words) => isGlobalInstall(words) && words.includes(`${PACKAGE}@${VERSION}`));

/** Whether a step mentions AssuredLoop's CLI at all: an `al` command or the package. */
const touchesAssuredLoop = (step) => runOf(step).includes(PACKAGE) || commandsIn(runOf(step)).some((words) => words[0] === 'al');

/**
 * The ways a step lets a failing `al check --strict` pass, one line each: an
 * `||` or a pipe after it, a `!` in front, `set +e`, or `continue-on-error`.
 */
function swallowsIn(step, job = {}) {
  const found = [];
  if (job['continue-on-error'] !== undefined && job['continue-on-error'] !== false) found.push('the job has continue-on-error');
  if (step['continue-on-error'] !== undefined && step['continue-on-error'] !== false) found.push('the step has continue-on-error');
  const run = runOf(step).replace(/\\\n/g, ' ');
  if (/(^|[\s;&|])set\s+\+e\b/m.test(run)) found.push('the run has set +e');
  for (const line of run.split('\n')) {
    const at = line.search(/(^|[\s;&|!(])al\s+check\b/);
    if (at < 0 || !commandsIn(line).some(isStrictCheck)) continue;
    const after = line.slice(at).replace(/\s#.*$/, '');
    if (/\|\|/.test(after)) found.push(`an || after it: ${line.trim()}`);
    else if (/\|/.test(after)) found.push(`a pipe after it: ${line.trim()}`);
    if (/(^|[;&|(])\s*!\s*al\s+check\b/.test(line)) found.push(`a ! in front of it: ${line.trim()}`);
  }
  return found;
}

const setupNodeOf = (job) => stepsOf(job).findIndex((step) => String(step?.uses ?? '').startsWith('actions/setup-node@'));
const checkoutOf = (job) => stepsOf(job).findIndex((step) => String(step?.uses ?? '').startsWith('actions/checkout@'));
/** Whether a job runs the suite, whole or a shard of it. */
const runsTheSuite = (job) => stepsOf(job).some((step) => commandsIn(runOf(step))
  .some((words) => words[0] === 'npm' && (words[1] === 'test' || (words[1] === 'run' && words[2] === 'test:shard'))));

/** The jobs in ci.yml that run `al check --strict`, as [id, job]. */
async function checkJobs() {
  const ci = await readWorkflow('ci.yml');
  return Object.entries(jobsOf(ci)).filter(([, job]) => stepsOf(job).some(runsStrictCheck));
}

/** The one job in ci.yml that runs `al check --strict`. */
async function checkJob() {
  const found = await checkJobs();
  assert.equal(
    found.length,
    1,
    `exactly one job in ci.yml should run \`al check --strict\`, got: ${found.map(([id]) => id).join(', ') || 'none'}`,
  );
  return found[0];
}

test('the check for `al check --strict` sees it run, and not an echo of it or a check without --strict', () => {
  const sees = (run) => runsStrictCheck({ run });
  assert.equal(sees('al check --strict'), true);
  assert.equal(sees('al check --strict --json'), true, 'other flags may come with it');
  assert.equal(sees('npm ci\nal check --strict'), true, 'on a later line');
  assert.equal(sees('cd repo && al check --strict'), true, 'after &&');
  assert.equal(sees('FOO=1 al check --strict'), true, 'with an env setting in front');
  assert.equal(sees('al check'), false, 'without --strict');
  assert.equal(sees('echo al check --strict'), false, 'an echo runs nothing');
  assert.equal(sees('# al check --strict'), false, 'a comment runs nothing');
  assert.equal(sees(''), false);
});

test('the check for a swallowed exit code sees ||, a pipe, !, set +e and continue-on-error, and not a plain run', () => {
  const swallows = (step, job) => swallowsIn(step, job).length > 0;
  assert.equal(swallows({ run: 'al check --strict' }), false, 'a plain run');
  assert.equal(swallows({ run: 'set -e\nal check --strict' }), false, 'set -e');
  assert.equal(swallows({ run: 'npm ci || exit 1\nal check --strict' }), false, 'an || on another line');
  assert.equal(swallows({ run: 'al check --strict || true' }), true, '|| true');
  assert.equal(swallows({ run: 'al check --strict || :' }), true, '|| :');
  assert.equal(swallows({ run: 'al check --strict | tee out.txt' }), true, 'a pipe');
  assert.equal(swallows({ run: '! al check --strict' }), true, 'a ! in front');
  assert.equal(swallows({ run: 'set +e\nal check --strict' }), true, 'set +e');
  assert.equal(swallows({ run: 'al check --strict', 'continue-on-error': true }), true, 'continue-on-error on the step');
  assert.equal(swallows({ run: 'al check --strict' }, { 'continue-on-error': true }), true, 'continue-on-error on the job');
});

test('the check for the install sees a global npm install at 0.1.0 exactly, and not a range, a tag or a local install', () => {
  const pinned = (run) => installsPinned({ run });
  assert.equal(pinned('npm install --global @assuredloop/cli@0.1.0'), true);
  assert.equal(pinned('npm install -g @assuredloop/cli@0.1.0'), true);
  assert.equal(pinned('npm i -g @assuredloop/cli@0.1.0'), true);
  assert.equal(pinned('npm install --global @assuredloop/cli'), false, 'no version');
  assert.equal(pinned('npm install --global @assuredloop/cli@latest'), false, 'a tag');
  assert.equal(pinned('npm install --global @assuredloop/cli@^0.1.0'), false, 'a range');
  assert.equal(pinned('npm install --global @assuredloop/cli@0.1'), false, 'part of a version');
  assert.equal(pinned('npm install @assuredloop/cli@0.1.0'), false, 'not global');
  assert.equal(pinned('echo npm install --global @assuredloop/cli@0.1.0'), false, 'an echo installs nothing');
});

test('AGENTS.md names the npm package @assuredloop/cli at exactly 0.1.0', async () => {
  const section = await assuredLoopSection();
  assert.ok(section.includes(PACKAGE), `the AssuredLoop section of AGENTS.md should name the package ${PACKAGE}`);
  assert.ok(namesTheVersion(section), `the AssuredLoop section of AGENTS.md should name the version ${VERSION}`);
  const other = specsIn(section).filter((spec) => spec !== VERSION);
  assert.deepEqual(other, [], `AGENTS.md should give ${PACKAGE} no version but ${VERSION}, not a range or a tag`);
});

test('AGENTS.md names the skill\'s path inside the package', async () => {
  const section = await assuredLoopSection();
  assert.ok(
    section.includes(SKILL_IN_PACKAGE),
    `the AssuredLoop section of AGENTS.md should name the skill at ${SKILL_IN_PACKAGE}, inside the installed package`,
  );
});

test('AGENTS.md no longer names the clone of AssuredLoop at 056d24c', async () => {
  const text = await readText('AGENTS.md');
  assert.ok(!text.includes(OLD_COMMIT), `AGENTS.md should not name ${OLD_COMMIT}: AssuredLoop now comes from npm`);
});

test('ci.yml runs on pull requests, and one of its jobs runs `al check --strict`', async () => {
  const ci = await readWorkflow('ci.yml');
  assert.ok(triggersOf(ci).includes('pull_request'), 'ci.yml should run on pull requests');
  await checkJob();
});

test('the AssuredLoop check checks out the whole history, with fetch-depth: 0, before it runs al', async () => {
  const [id, job] = await checkJob();
  const steps = stepsOf(job);
  const checkout = checkoutOf(job);
  const check = steps.findIndex(runsStrictCheck);
  assert.ok(checkout >= 0, `${id} should check out the repo with actions/checkout`);
  assert.ok(checkout < check, `${id} should check out the repo before it runs al check`);
  const depth = steps[checkout].with?.['fetch-depth'];
  assert.ok(depth === 0 || depth === '0', `${id} should check out with fetch-depth: 0, got: ${depth}`);
});

test('the AssuredLoop check installs @assuredloop/cli@0.1.0 globally, pinned exactly, before it runs al', async () => {
  const [id, job] = await checkJob();
  const steps = stepsOf(job);
  const install = steps.findIndex(installsPinned);
  const check = steps.findIndex(runsStrictCheck);
  assert.ok(install >= 0, `${id} should run \`npm install --global ${PACKAGE}@${VERSION}\``);
  assert.ok(install < check, `${id} should install al before it runs al check`);
  const other = steps.flatMap(installedSpecs).filter((spec) => spec !== `${PACKAGE}@${VERSION}`);
  assert.deepEqual(other, [], `${id} should install ${PACKAGE} at ${VERSION} only, not a range, a tag or no version`);
});

test('the AssuredLoop check runs on the Node the shard jobs in ci.yml run on', async () => {
  const ci = await readWorkflow('ci.yml');
  const shards = Object.values(jobsOf(ci)).filter(runsTheSuite);
  assert.ok(shards.length > 0, 'ci.yml should still have jobs that run the suite');
  const nodes = [...new Set(shards.map((job) => stepsOf(job)[setupNodeOf(job)]?.with?.['node-version']))];
  assert.equal(nodes.length, 1, `the jobs that run the suite should run on one Node, got: ${nodes.join(', ')}`);

  const [id, job] = await checkJob();
  const setup = setupNodeOf(job);
  assert.ok(setup >= 0, `${id} should set up Node with actions/setup-node`);
  assert.equal(String(stepsOf(job)[setup].with?.['node-version']), String(nodes[0]), `${id} should run on the Node the shards run on`);
  const install = stepsOf(job).findIndex(installsPinned);
  assert.ok(install < 0 || setup < install, `${id} should set up Node before it installs al`);
});

test('a not-ok from `al check --strict` fails the check: nothing swallows its exit code', async () => {
  const [id, job] = await checkJob();
  const found = stepsOf(job).filter(runsStrictCheck).flatMap((step) => swallowsIn(step, job));
  assert.deepEqual(found, [], `${id} lets a failing al check pass:\n  ${found.join('\n  ')}`);
});

test('the check is a job of its own: the shard jobs and the summary job do not run al, and the summary still needs only the shards', async () => {
  const ci = await readWorkflow('ci.yml');
  const [id] = await checkJob();
  const suite = Object.keys(jobsOf(ci)).filter((name) => runsTheSuite(ci.jobs[name]));
  assert.ok(!suite.includes(id), `${id} should not also run the suite`);
  const summaries = Object.keys(jobsOf(ci)).filter((name) => suite.length > 0 && suite.every((need) => needsOf(ci.jobs[name]).includes(need)));
  assert.equal(summaries.length, 1, `exactly one job in ci.yml should need every shard job, got: ${summaries.join(', ') || 'none'}`);

  for (const name of [...suite, ...summaries]) {
    const touched = stepsOf(ci.jobs[name]).filter(touchesAssuredLoop);
    assert.deepEqual(touched, [], `${name} should be left as it was, without AssuredLoop in it`);
  }
  assert.deepEqual(needsOf(ci.jobs[summaries[0]]).sort(), [...suite].sort(), `${summaries[0]} should still need the shard jobs and nothing else`);
});

test('publish.yml does not install or run AssuredLoop', async () => {
  const publish = await readWorkflow('publish.yml');
  for (const [name, job] of Object.entries(jobsOf(publish))) {
    const touched = stepsOf(job).filter(touchesAssuredLoop);
    assert.deepEqual(touched, [], `publish.yml's ${name} job should not touch AssuredLoop: it is out of this issue's scope`);
  }
});
