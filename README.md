# ChatGPT Bot Kit

Local project scaffold with OpenSpec for spec-driven planning and the local
AssuredLoop package for workflow guidance and checks. Product requirements and
the application runtime have not been chosen yet.

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
