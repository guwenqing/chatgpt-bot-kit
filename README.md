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

## Start a specification

OpenSpec is initialized with the native `spec-driven` schema and its core Codex
skills in `.agents/skills/`. In Codex, explicitly invoke:

```text
$openspec-propose "Describe the first feature and its acceptance criteria"
```

Review the generated proposal, design, specification changes and tasks before
starting implementation. Current product specifications belong in
`openspec/specs/`; proposed changes belong in `openspec/changes/`.

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

The GitHub repository is `guwenqing/chatgpt-bot-kit`. The adoption branch contains
the owner-accepted consumer configuration and seven generated AssuredLoop skills.
See `.assuredloop/policy.md` for the exact proposed policy and
`.assuredloop/README.md` for package provenance, current acceptance state and
operations. The actual owner decision is referenced in the configuration;
bootstrap delivery and the later activation remain separately verified steps.
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
