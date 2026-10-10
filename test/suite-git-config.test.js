// The suite's own git calls run with a git config of the suite's own (#512).
//
// The helpers in test/helpers/ make the "online" repositories the tests fetch
// from: a repo, a commit, a tag, a branch. Whatever the developer has in their
// own global or system git config must not change what those helpers do. With
// `tag.gpgsign true` in a global config, `git tag` turns into a signed tag that
// wants a message, fails with "fatal: no tag message?", and more than 20 tests
// fail for a reason that has nothing to do with the kit.
//
// So each test here writes a hostile git config into a throwaway folder, points
// a child process at it the way a developer's machine would (GIT_CONFIG_GLOBAL,
// $XDG_CONFIG_HOME/git/config, $HOME/.gitconfig, GIT_CONFIG_SYSTEM), and runs
// the helpers there. The real config of this machine is never read or written:
// every child gets a home of its own.
//
// Two shapes, on purpose. The helpers are called straight from a child process,
// one setting and one place at a time, so a failure names the setting that got
// through. And test/skills-fetch.test.js is run whole under `tag.gpgsign true`,
// because that is the run the issue saw break, and a fix to the helpers that
// misses a git call the test file makes some other way would show only there.
//
// What the repositories hold is read back with a git of this file's own, with
// no config at all, rather than through the helpers under test.
//
// The kit's own git calls (src/) are not the subject: what a user's config does
// to the kit's fetches is out of scope, and nothing here asserts on it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { node, repoRoot } from './helpers/cli.js';

const cliHelpers = pathToFileURL(path.join(repoRoot, 'test', 'helpers', 'cli.js')).href;
const sourceHelpers = pathToFileURL(path.join(repoRoot, 'test', 'helpers', 'sources.js')).href;

/** A child that hangs is killed long before the whole run's own limit. */
const HELPERS_TIMEOUT_MS = 60_000;
const SUITE_TIMEOUT_MS = 240_000;

/** A throwaway folder for one test, gone when it ends. */
async function scratch(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'obk-gitconfig-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  await mkdir(home);
  return { root, home };
}

/**
 * The environment a developer's shell hands the suite, with none of git's own
 * config variables in it and a home of the test's own. NODE_TEST_CONTEXT goes
 * too: a `node --test` that inherits it from this run refuses to run any file.
 */
function plainEnv(home) {
  const {
    NODE_TEST_CONTEXT: _context,
    GIT_CONFIG_GLOBAL: _global,
    GIT_CONFIG_SYSTEM: _system,
    GIT_CONFIG_NOSYSTEM: _nosystem,
    XDG_CONFIG_HOME: _xdg,
    ...rest
  } = process.env;
  return { ...rest, HOME: home };
}

/** A git that reads no config at all, for reading back what the helpers made. */
function plainGit(args, cwd, home) {
  const done = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(done.status, 0, `git ${args.join(' ')} in ${cwd} should read the repository: ${done.stderr}`);
  return done.stdout.trim();
}

/**
 * Who the developer is, as any developer's own global config says. Without it
 * a signed tag fails on the missing identity before it gets to the message, and
 * the failure would not be the one the issue saw.
 */
const DEVELOPER = '[user]\n\tname = A Developer\n\temail = developer@example.invalid\n';

/** A hook that would stop a commit, and leaves a file behind to say it ran. */
const failingHook = (marker) => `#!/bin/sh\necho ran >> ${JSON.stringify(marker)}\nexit 1\n`;

/**
 * Settings that would change what the helpers do, were they read. Each one
 * writes what it needs into `root` and answers the lines of a git config.
 */
const HOSTILE = [
  {
    name: 'tag.gpgsign',
    // A tag becomes a signed, annotated one, which wants a message.
    config: async () => '[tag]\n\tgpgsign = true\n',
  },
  {
    name: 'core.hooksPath',
    // A pre-commit hook outside the repository that refuses every commit.
    config: async (root, marker) => {
      const hooks = path.join(root, 'hooks');
      await mkdir(hooks);
      await writeFile(path.join(hooks, 'pre-commit'), failingHook(marker));
      await chmod(path.join(hooks, 'pre-commit'), 0o755);
      return `[core]\n\thooksPath = ${hooks}\n`;
    },
  },
  {
    name: 'init.templateDir',
    // A template that puts the same refusing hook into every new repository.
    config: async (root, marker) => {
      const template = path.join(root, 'template');
      await mkdir(path.join(template, 'hooks'), { recursive: true });
      await writeFile(path.join(template, 'hooks', 'pre-commit'), failingHook(marker));
      await chmod(path.join(template, 'hooks', 'pre-commit'), 0o755);
      return `[init]\n\ttemplateDir = ${template}\n`;
    },
  },
  {
    name: 'core.excludesFile',
    // An ignore file that ignores everything, so `git add -A` adds nothing.
    config: async (root) => {
      const ignore = path.join(root, 'ignore-everything');
      await writeFile(ignore, '*\n');
      return `[core]\n\texcludesFile = ${ignore}\n`;
    },
  },
  {
    name: 'init.defaultObjectFormat',
    // A sha256 repository, whose shas are 64 characters and not the 40 a
    // test of the kit expects a full sha to be.
    config: async () => '[init]\n\tdefaultObjectFormat = sha256\n',
  },
];

/**
 * The places a developer's git config comes from. Each writes `text` where git
 * would read it and answers the environment that makes git read it there.
 */
const PLACES = [
  {
    name: 'a global config named by GIT_CONFIG_GLOBAL',
    put: async ({ root, home }, text) => {
      const file = path.join(root, 'developer.gitconfig');
      await writeFile(file, text);
      return { ...plainEnv(home), GIT_CONFIG_GLOBAL: file };
    },
  },
  {
    name: 'the global config at $HOME/.gitconfig',
    put: async ({ home }, text) => {
      await writeFile(path.join(home, '.gitconfig'), text);
      return plainEnv(home);
    },
  },
  {
    name: 'the global config at $XDG_CONFIG_HOME/git/config',
    put: async ({ root, home }, text) => {
      const xdg = path.join(root, 'xdg');
      await mkdir(path.join(xdg, 'git'), { recursive: true });
      await writeFile(path.join(xdg, 'git', 'config'), text);
      return { ...plainEnv(home), XDG_CONFIG_HOME: xdg };
    },
  },
  {
    name: 'the system config named by GIT_CONFIG_SYSTEM',
    put: async ({ root, home }, text) => {
      const file = path.join(root, 'system.gitconfig');
      await writeFile(file, text);
      return { ...plainEnv(home), GIT_CONFIG_SYSTEM: file };
    },
  },
];

/**
 * Run the helpers in a child with `env`, the way skills-fetch uses them: a repo
 * on main, a file committed, a lightweight tag through `tagIn` and one through
 * `git` itself, and a branch. Answers the child's result and what it printed.
 */
async function runHelpers(dir, env) {
  const script = `
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { git } from ${JSON.stringify(cliHelpers)};
    import { branchIn, commitIn, repoAt, shaIn, tagIn } from ${JSON.stringify(sourceHelpers)};
    const dir = ${JSON.stringify(dir)};
    await repoAt(dir);
    await writeFile(path.join(dir, 'SKILL.md'), 'version one\\n');
    const sha = await commitIn(dir, 'the first version');
    await tagIn(dir, 'v1.0.0');
    const direct = await git(['tag', 'v1.0.1'], dir);
    if (direct.code !== 0) throw new Error('git tag through git() failed: ' + direct.stderr);
    await branchIn(dir, 'stable');
    const tagged = await shaIn(dir, 'v1.0.0');
    process.stdout.write(JSON.stringify({ sha, tagged }));
  `;
  return node(['--input-type=module', '-e', script], { cwd: repoRoot, env, timeout: HELPERS_TIMEOUT_MS });
}

/**
 * What the helpers must have made, whatever config the developer has: the same
 * repository a machine with no git config at all gets.
 */
function assertPlainRepo(result, dir, home, marker) {
  assert.equal(result.signal, null, `the helpers should finish, not be killed: ${result.stderr}`);
  assert.equal(result.code, 0, `the helpers should work: ${result.stderr}`);
  const said = JSON.parse(result.stdout);

  const head = plainGit(['rev-parse', 'HEAD'], dir, home);
  assert.match(head, /^[0-9a-f]{40}$/, 'the repository should be a sha1 one, as with no config');
  assert.equal(said.sha, head, 'commitIn should answer the sha of the commit it made');
  assert.equal(plainGit(['symbolic-ref', 'HEAD'], dir, home), 'refs/heads/main');
  assert.equal(plainGit(['ls-tree', '-r', '--name-only', 'HEAD'], dir, home), 'SKILL.md', 'the commit should hold the file');

  // A lightweight tag is a ref straight to the commit; a signed one is a tag object.
  for (const tag of ['v1.0.0', 'v1.0.1']) {
    assert.equal(plainGit(['cat-file', '-t', `refs/tags/${tag}`], dir, home), 'commit', `${tag} should be a lightweight tag`);
    assert.equal(plainGit(['rev-parse', `refs/tags/${tag}`], dir, home), head, `${tag} should point at the commit`);
  }
  assert.equal(said.tagged, head, 'shaIn should answer the sha the tag points at');
  assert.equal(plainGit(['rev-parse', 'refs/heads/stable'], dir, home), head, 'the branch should be on the commit');

  assert.equal(existsSync(marker), false, 'no hook from the developer\'s config should have run');
}

// The control: the script above makes exactly that repository when there is
// no config of the developer's at all, so a failure below is the config's doing.
test('with no git config of the developer\'s, the helpers make a plain repository with a commit, two lightweight tags and a branch', async (t) => {
  const box = await scratch(t);
  const dir = path.join(box.root, 'repo');
  const marker = path.join(box.root, 'hook-ran');

  const result = await runHelpers(dir, plainEnv(box.home));

  assertPlainRepo(result, dir, box.home, marker);
});

for (const place of PLACES) {
  for (const setting of HOSTILE) {
    test(`${setting.name} in ${place.name} does not change what the suite's git helpers do`, async (t) => {
      const box = await scratch(t);
      const dir = path.join(box.root, 'repo');
      const marker = path.join(box.root, 'hook-ran');
      const env = await place.put(box, DEVELOPER + await setting.config(box.root, marker));

      const result = await runHelpers(dir, env);

      assertPlainRepo(result, dir, box.home, marker);
    });
  }
}

// The run the issue saw fail: the whole skills-fetch file, with `tag.gpgsign
// true` in a global config the developer's environment already names.
test('the skills-fetch tests pass with tag.gpgsign true in the global config GIT_CONFIG_GLOBAL names', async (t) => {
  const box = await scratch(t);
  const file = path.join(box.root, 'developer.gitconfig');
  await writeFile(file, `${DEVELOPER}[tag]\n\tgpgsign = true\n`);

  const result = await node(
    ['--test', '--test-reporter=tap', path.join('test', 'skills-fetch.test.js')],
    { cwd: repoRoot, env: { ...plainEnv(box.home), GIT_CONFIG_GLOBAL: file }, timeout: SUITE_TIMEOUT_MS },
  );

  const tail = result.stdout.split('\n').slice(-40).join('\n');
  assert.equal(result.signal, null, `the run should finish inside ${SUITE_TIMEOUT_MS} ms:\n${tail}`);
  assert.equal(result.code, 0, `the skills-fetch tests should pass:\n${tail}\n${result.stderr}`);
  assert.match(result.stdout, /^# fail 0$/m, `no test should fail:\n${tail}`);
  const passed = Number(/^# pass (\d+)$/m.exec(result.stdout)?.[1] ?? 0);
  assert.ok(passed > 0, `the run should have run the tests, not none of them:\n${tail}`);
});
