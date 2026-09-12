# ChatGPT Bot Kit

A local utility for bot workspaces in the Codex desktop app. The first delivered
component prepares Bot Father's files and preserves user configuration. Bot
management and migration commands prepare additional roles and verify selected
working files. Native project/session setup and the wider conversational flows are being delivered
through the accepted `local-bot-kit` plan.

## Prepare a workspace

Requires Node.js >=20.19.0. From this development checkout with dependencies
installed, choose an absolute path for your bot workspace:

```sh
node src/cli.js prepare --workspace /absolute/path/to/my-bots
node src/cli.js inspect --workspace /absolute/path/to/my-bots
```

`prepare` creates only Bot Father, its daily-session configuration, shared memory
and work directories, and empty skill locations. It creates no native project,
conversation or schedule. A successful result says `status: prepared` and
`native_ready: false`. Repeating it preserves existing YAML and working files
and fills missing derived files/directories.

Edit `bots/bot-father/bot.yaml` for bot-wide `rules`, purpose and session settings.
Keep session-specific instructions in each session's `startup_prompt`; they do
not go into shared `AGENTS.md`. The workspace locator is
`.bot-kit/workspace.yaml`, and membership lives in Bot Father's `registry.yaml`.
All use `schema_version: 1`. Invalid YAML, duplicate identities, conflicting
defaults and conflicting managed paths are rejected before preparation writes.

```sh
node src/cli.js regenerate --workspace /absolute/path/to/my-bots
```

Regeneration preserves text outside the `bot-kit:begin` / `bot-kit:end` comment
markers. The YAML receipt in the bot's `.bot-kit/generation.yaml` records the
managed region's digest. Direct edits inside that region produce a conflict,
not an overwrite. To resolve one, preserve the edits in your YAML rules or
outside the region, then explicitly reconcile or remove the old managed region
before regenerating. Keep any user text you want to retain.

For a read/modify operation, take `revision` from `inspect` and pass
`--expected-revision TOKEN` to `prepare` or `regenerate`. A stale token rejects
the operation. Preparation also uses `.bot-kit/write.lock` and checks inputs
again before writing. A leftover lock requires checking that its writer stopped
before removing it. File replacements are atomic individually; a multi-file
failure reports completed steps and pending files for a resumable retry, not a
transactional rollback. These conventions are not a filesystem sandbox.

The private package can be exercised without the development workflow links:
run `npm pack`, then install the resulting tarball in a separate local directory
with `npm install --omit=dev /absolute/path/to/chatgpt-bot-kit-0.0.0.tgz`.
Use its `node_modules/.bin/bot-kit` entry with the same arguments. No npm registry
publication is needed. `npm test` runs the scoped CLI acceptance tests,
including a clean packed installation.

## Manage bots and inherit work

The [conversational management guide](templates/bot-management.md) covers role
creation, additional conversations, native setup and migration. An assistant can
turn a request such as “Create a personal helper and bring my unfinished list”
into configuration and native operations. The user need not author YAML. On a
supported macOS host, the assistant can open each prepared bot root with the
official `codex app` entry, verify it through the desktop project list, and
create its daily task with the native task tool in the same local root. The
management guide covers discovery, identity checks and recovery; a successful
shell command alone is not a completed setup.

`create-bot` and `configure-bot` accept `--workspace`, `--config` and an optional
`--expected-revision`. `inspect` returns current directory entries and separate
native observations; `regenerate --bot ID` targets one bot. A bot owns one shared
workspace even when its conversations have different prompts or model settings.
`record-native` stores supplied surface-specific evidence and keeps
`native_ready: false`; files and receipts alone do not establish desktop entry.

`inventory --source ABSOLUTE_PATH [--output ABSOLUTE_YAML]` records selected
working files, including ignored and unfinished work. `verify-migration
--inventory ABSOLUTE_YAML --destination ABSOLUTE_PATH` checks a chosen transfer
without changing its source or destination. Inspect its JSON `status`: an
`incomplete` assessment also exits with code 0. Native conversation continuity
and a receiving bot's actual continuation require separate verification.

## Choose skills

The [skill management guide](templates/skill-management.md) explains bundled,
local and repository sources, explicit recipients, copy/link sharing and a
bounded scan choice. `install-skill --workspace ABS --config ABS_YAML` prepares
the selected files and records their source; `inspect-skills --workspace ABS
[--bot ID]` also lists direct unmanaged installations. Use `--expected-revision`
with installation to reject stale configuration. Existing content is preserved
on a conflict. The assistant must separately verify native discovery from each
recipient and actual procedure execution before reporting those outcomes.

## Collaborate, notify and groom

Use the [coordination guide](templates/coordination.md) for bounded native requests
and replies. `plan-handoff` resolves the selected or default conversation and return
address; `record-handoff` retains reported delivery evidence and uncertain outcomes.
The native desktop still performs messaging. Queue, steering, stopping and actual
completion remain distinct, and an unexposed mode is not silently substituted.

Run `plan-notices --workspace ABS` before an intended configuration change to establish
its baseline, then again afterwards to identify affected existing conversations.
It compares guidance, session settings and effective skill contents, including live
shared links; ordinary memory updates stay quiet. `record-notice` records sent,
uncertain or evidenced adoption for the current fingerprint. These YAML receipts
cannot authenticate native events or force running conversations to reload.

The [grooming guide](templates/grooming.md) offers an additional persistent Bot Father
conversation and a user-selected native schedule after the daily entry works.
`record-finding` preserves one condition's evidence and routing state across runs,
so unchanged already-routed findings stay quiet and failed routing remains recoverable.
Configuration readback, actual scheduled firing and return to the daily entry require
separate native evidence. No schedule is created during workspace preparation.

## Installed tooling

Requires Node.js >=20.19.0, npm and Git.

| Tool | Version at setup | Local source |
| --- | --- | --- |
| AssuredLoop Base | 0.1.0 | `/Users/q/projects/guwenqing/assuredloop-base` |
| OpenSpec | 1.12.0 | The dependency installed in that AssuredLoop checkout |

Both packages were installed with `npm link`. Their local file references are
saved in `package.json` and `package-lock.json`. This setup depends on the local
checkout and its installed dependencies. Source edits take effect immediately;
these links are not immutable release pins.

The activation selection uses source commit
`7343ffc7518200ce80437a9c914448dd6f176a35`;
see `.assuredloop/README.md` for reproducible provenance. Its generated contracts identify
`guwenqing/assuredloop-base`, revision
`9dfe8524072aec0f896dd7bacb345d7ed6471aac`, path `openspec/specs`.

To recreate the links from this project's root:

```sh
npm link ../../guwenqing/assuredloop-base ../../guwenqing/assuredloop-base/node_modules/@fission-ai/openspec --save-dev --ignore-scripts --offline --no-audit --no-fund
```

This also registers the two CLI packages in npm's global link directory.
Project commands resolve through this project's `node_modules/.bin`:

```sh
npm run assuredloop -- --help
npm run openspec -- --help
npm ls --depth=0
```

## Start work

Capture the goal in a GitHub Request, preserving the original requirement. In
Codex, explicitly invoke the intake skill with that Issue's repository and number:

```text
$assuredloop-triage guwenqing/chatgpt-bot-kit#<request-number>
```

Work needing a new agreement goes to a separately assigned Architecture Task for
planning. Use an Epic when the work needs a container, with native GitHub
sub-issues for planning, delivery and aggregate closeout. Keep actual prerequisite
dependencies separate from parent membership. A bounded fix to an existing
accepted requirement can route directly to a Task or Bug.

Invoke `$assuredloop-plan` with the assigned planning Issue to develop the native
OpenSpec proposal, design, specifications and tasks. OpenSpec uses its native
`spec-driven` schema; both native and AssuredLoop skills are in `.agents/skills/`.
The owner accepts a new or materially changed proposal before implementation.
Assigned delivery then uses `$assuredloop-deliver`, applicable verification,
independent Astra review and authorized squash merge.

Current product specifications belong in `openspec/specs/`; proposed changes
belong in `openspec/changes/`. This tooling adoption introduces no product specs.

Inspect the current planning state with:

```sh
npm run openspec -- list
npm run openspec -- list --specs
```

## AssuredLoop status

The CLI, record schemas, framework contracts and guidance are available through
`node_modules/assuredloop-base/`. AssuredLoop adds work categorization,
traceability, review evidence, validation and closeout guidance around OpenSpec.
Its package README describes those capabilities and their limits.

The GitHub repository is `guwenqing/chatgpt-bot-kit`. The repository contains
the owner-accepted consumer configuration and seven generated AssuredLoop skills.
See `.assuredloop/policy.md` for the accepted policy and
`.assuredloop/README.md` for package provenance, current acceptance state and
operations. The actual owner decision is referenced in the configuration;
accepted bootstrap was delivered in PR #4. The independently reviewed activation
checkpoint was squash-merged in [PR #5](https://github.com/guwenqing/chatgpt-bot-kit/pull/5)
at `874cb73a3ef52423231d48f66d3db932dcf40f44`. Live default-branch resolution
verified `available / activation`; its actual evidence is recorded on that PR.
CI and automated review are not configured. PR merges use squash.

The initializer can write a config without accepted bootstrap references; that
installs files but cannot establish an accepted policy. Its `--local-only` flag
only skips remote checks and still requires a matching GitHub origin. Accepted
bootstrap must be delivered before the separately assessed activation checkpoint.

## Later: test a fixed package installation

Use `npm pack` on a selected AssuredLoop revision to produce a private tarball,
record its npm integrity, and install that tarball in a separate test consumer.
Use OpenSpec 1.12.0 as required by this AssuredLoop version. This exercises the
package's shipped files without following live source edits. Replace the local
file references with the chosen release artifacts and a reviewed lockfile when
preparing a portable installation. AssuredLoop is currently private and does
not require an npm registry publication for this test.
