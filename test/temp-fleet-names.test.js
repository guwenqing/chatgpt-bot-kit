// A fleet in a throwaway folder shows in Orca under names nobody can take for
// the owner's own bots (#401). A bots folder under the system temp folder (the
// kit's TMPDIR, compared by real path) gets projects whose names keep the bot's
// display name and add a mark naming the first folder under the temp folder on
// the way to it: `<tmp>/obk250-live.ePjgqK/bots` names `obk250-live.ePjgqK`.
// Every other fleet keeps exactly the names it has today, and tab titles are
// the same everywhere.
//
// The words of the mark are the kit's to choose, so these tests check what the
// name holds, not how it reads (`assertMarkedName`).
//
// Each sandbox gives the kit a temp folder of its own, `box.tmp`, beside the
// sandbox's working directory (helpers/cli.js); a throwaway fleet is made
// under it.

import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertMarkedName,
  botHomeOf,
  createSandbox,
  orcaCallsOf,
  orcaFlag,
  TAB_TITLES,
  tabsOfBot,
} from './helpers/cli.js';

/** The folder the owner saw in Orca's sidebar, under the temp folder. */
const LIVE = 'obk250-live.ePjgqK';

/** Seed a bots folder at `bots`, which brings Bot Father up. */
async function init(box, bots, options) {
  const result = await box.run(['init', '--bots', bots, '--harness', 'claude'], options);
  assert.equal(result.code, 0, result.stderr);
}

/** Make a bot with one `daily` session in `bots`. */
async function makeBot(box, bots, name) {
  const made = await box.run(['bot', 'create', '--bots', bots, '--name', name, '--harness', 'claude']);
  assert.equal(made.code, 0, made.stderr);
  const added = await box.run(['session', 'add', '--bots', bots, '--bot', name, '--name', 'daily']);
  assert.equal(added.code, 0, added.stderr);
}

/** The display name of the one project Orca holds for `home`. */
async function projectNameAt(box, home) {
  const setups = (await box.orca.setups()).filter((setup) => setup.path === home);
  assert.equal(setups.length, 1, `Orca should hold one project for ${home}, got ${JSON.stringify(await box.orca.setups())}`);
  assert.equal(setups[0].kind, 'folder');
  return setups[0].displayName;
}

test('a fleet under the temp folder: Bot Father\'s project is marked with the folder it is in', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });

  await init(box, bots);

  assertMarkedName(await projectNameAt(box, botHomeOf(bots)), 'Bot Father', LIVE);
});

test('a fleet under the temp folder: another bot\'s project is marked the same way', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });
  await init(box, bots);
  await makeBot(box, bots, 'api-bot');

  const result = await box.run(['up', '--bots', bots, '--bot', 'api-bot']);

  assert.equal(result.code, 0, result.stderr);
  assertMarkedName(await projectNameAt(box, botHomeOf(bots, 'api-bot')), 'Api Bot', LIVE);
});

test('a fleet under the temp folder keeps its tab titles as they are', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });
  await init(box, bots);
  await makeBot(box, bots, 'api-bot');

  const result = await box.run(['up', '--bots', bots]);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'bot-father')).map((tab) => tab.title).sort(),
    ['Bot Father daily', 'Bot Father ops'],
  );
  assert.deepEqual((await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title), ['Api Bot daily']);
});

// Which folder is named: the first one under the temp folder, however deep the
// bots folder is, and the bots folder itself when that is the first one (a
// system test's fleet).
for (const [layout, parts, folder, notNamed] of [
  ['the bots folder is the first folder under it', ['obk-system-close-without-tab-AbC123'], 'obk-system-close-without-tab-AbC123', []],
  ['the bots folder is deeper down', ['obk-live-Q7', 'nested', 'bots'], 'obk-live-Q7', ['nested']],
]) {
  test(`a fleet under the temp folder where ${layout}: the project names ${folder}`, async (t) => {
    const box = await createSandbox(t);
    const bots = path.join(box.tmp, ...parts);
    await mkdir(bots, { recursive: true });

    await init(box, bots);

    const name = await projectNameAt(box, botHomeOf(bots));
    assertMarkedName(name, 'Bot Father', folder);
    for (const other of notNamed) {
      assert.ok(!name.includes(other), `only the first folder under the temp folder is named, not ${other}: ${JSON.stringify(name)}`);
    }
  });
}

// On macOS TMPDIR is /var/folders/…/T/ and /var is a link to /private/var, so
// the same folder reaches the kit by two paths (the owner's case was a bots
// folder under /private/var/folders/…/T). Real paths decide, whichever of the
// two is the link.
test('a fleet under the temp folder is marked when TMPDIR is a link to it, as /var is on macOS', async (t) => {
  const box = await createSandbox(t);
  const link = path.join(box.root, 'link-to-tmp');
  await symlink(box.tmp, link);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });

  await init(box, bots, { env: { ...box.env, TMPDIR: `${link}/` } });

  const setups = await box.orca.setups();
  assert.equal(setups.length, 1, JSON.stringify(setups));
  assertMarkedName(setups[0].displayName, 'Bot Father', LIVE);
});

test('a fleet under the temp folder is marked when it is named through a link to it', async (t) => {
  const box = await createSandbox(t);
  const link = path.join(box.root, 'link-to-tmp');
  await symlink(box.tmp, link);
  await mkdir(path.join(box.tmp, LIVE, 'bots'), { recursive: true });

  await init(box, path.join(link, LIVE, 'bots'));

  const setups = await box.orca.setups();
  assert.equal(setups.length, 1, JSON.stringify(setups));
  assertMarkedName(setups[0].displayName, 'Bot Father', LIVE);
});

test('a fleet outside the temp folder keeps exactly today\'s project names and tab titles', async (t) => {
  const box = await createSandbox(t);
  const bots = box.path('bots');
  await init(box, bots);
  await makeBot(box, bots, 'api-bot');

  const result = await box.run(['up', '--bots', bots]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(await projectNameAt(box, botHomeOf(bots)), 'Bot Father');
  assert.equal(await projectNameAt(box, botHomeOf(bots, 'api-bot')), 'Api Bot');
  assert.deepEqual(
    (await tabsOfBot(box, bots, 'bot-father')).map((tab) => tab.title).sort(),
    [TAB_TITLES.daily, TAB_TITLES.ops].sort(),
  );
  assert.deepEqual((await tabsOfBot(box, bots, 'api-bot')).map((tab) => tab.title), ['Api Bot daily']);
});

// A folder beside the temp folder whose name only starts the same way is not
// inside it.
test('a fleet beside the temp folder, whose path starts with the temp folder\'s, keeps today\'s name', async (t) => {
  const box = await createSandbox(t);
  const bots = path.join(`${box.tmp}-fleet`, LIVE, 'bots');
  await mkdir(bots, { recursive: true });

  await init(box, bots);

  assert.equal(await projectNameAt(box, botHomeOf(bots)), 'Bot Father');
});

/** Orca holding `home` as a git-kind project, the way `repo add` leaves a folder inside a git repo. */
const gitProjectAt = (home) => ({
  id: 'setup_existing',
  projectId: 'proj_existing',
  hostId: 'host_local',
  repoId: 'setup_existing',
  path: home,
  displayName: 'bot-father',
  kind: 'git',
  setupState: 'ready',
  setupMethod: 'repo-add',
});

test('a git-kind project in a fleet under the temp folder is turned into a folder one under the same name the kit makes', async (t) => {
  // What the kit names the project when it makes it, in a fleet of the same shape.
  const made = await createSandbox(t);
  const madeBots = path.join(made.tmp, LIVE, 'bots');
  await mkdir(madeBots, { recursive: true });
  await init(made, madeBots);
  const madeName = await projectNameAt(made, botHomeOf(madeBots));

  const box = await createSandbox(t);
  const bots = path.join(box.tmp, LIVE, 'bots');
  await mkdir(bots, { recursive: true });
  await box.orca.set({ setups: [gitProjectAt(botHomeOf(bots))] });

  await init(box, bots);

  const calls = await box.orca.calls();
  assert.deepEqual(orcaCallsOf(calls, 'repo add'), [], 'the project Orca had is the one that is turned');
  const updates = orcaCallsOf(calls, 'project setup-update');
  assert.equal(updates.length, 1, JSON.stringify(updates));
  assert.equal(orcaFlag(updates[0], '--setup'), 'setup_existing');
  assert.equal(orcaFlag(updates[0], '--kind'), 'folder');
  assertMarkedName(orcaFlag(updates[0], '--display-name'), 'Bot Father', LIVE);
  assert.equal(orcaFlag(updates[0], '--display-name'), madeName, 'turning a project names it as making one does');
  assert.equal(await projectNameAt(box, botHomeOf(bots)), madeName);
});
