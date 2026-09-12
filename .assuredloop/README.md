# AssuredLoop consumer setup

Repository: `guwenqing/chatgpt-bot-kit`. Native product context: `openspec/`.
Selected integration: Codex, with native and AssuredLoop skills in `.agents/skills/`.

## Acceptance state

The current branch contains a proposed initialization. Until accepted bootstrap
and a later activation checkpoint are delivered to the destination, this is
native/manual bootstrap only. Read `.assuredloop/config.json` and, once present,
`.assuredloop/activation.json` at the actual destination's pre-change revision.
Never treat the working copy or candidate PR as its own acceptance authority.

The exact consumer choices are in `policy.md`. Planning is tracked in
[Issue #2](https://github.com/guwenqing/chatgpt-bot-kit/issues/2), with consumer
adoption and activation in [Issue #3](https://github.com/guwenqing/chatgpt-bot-kit/issues/3).
The native plan is `openspec/changes/activate-assuredloop/`.

## Selected package

- Package: `assuredloop-base@0.1.0`.
- Source repository: `guwenqing/assuredloop-base`.
- Source base revision: `74fcd7b8e0b3257965fc7d517ef18dabea1ef611`.
- Exact source overlay: `package-source.patch`, adding reading-scope guidance to `templates/README.md`.
- Canonical contract source: `9dfe8524072aec0f896dd7bacb345d7ed6471aac`, path `openspec/specs`.
- Tarball integrity: `sha512-qlluADcTol0mYvRs/ERpi95G7faEucIri5Q6/a8rjl8FL7zqbalRKKRKbGTb6hAkfzBf1zXgYNWQ44LXlZ96Ig==`.
- Source dependency-lock SHA-256: `48532848bae0577d003a79fcbd735d870794d36c7f1e12cc257e04081beed26c`.
- Direct dependencies: OpenSpec `1.12.0`, AJV `8.20.0`.

These values describe this consumer's selected artifact, not the source project's
own consumer activation. Its historical approvals do not authorize this project.
The source has that uncommitted documentation overlay; it is included in the
measured tarball. Reconstruct this selection from the base Git tree plus the
retained patch in a separate build directory using `git apply --unidiff-zero`,
then pack with lifecycle scripts disabled and compare the SRI.
Do not apply the patch again to the live source or reset someone else's changes.
This consumer selection does not commit or accept an upstream framework release.
The development install uses npm links described in the root README. Resolve
the links to their actual package roots before work. Retain or recover the exact
source revision and dependency lock; package name/version alone cannot identify
this build. `local-data/activation/packages/` contains the measured local tarball
and is ignored; the tarball has not been published.

Before formal assessment, run `npm pack` on the selected linked checkout with
lifecycle scripts disabled and compare the resulting integrity with
`project.workflow.integrity`. Compare the source dependency lock with its recorded
hash and installed dependency versions with that lock. Verify the packaged
contract hashes through `src/contracts.js`'s `verifyContracts` API. Current init
and check helpers do not authenticate the declared SRI or perform all these
installation checks for you. A mismatch needs a reviewed rebind, not an updated
integrity string that silently accepts different bytes.

## Operations

Run commands from this project with explicit target/work bindings:

```sh
npm run assuredloop -- inspect --target "$PWD" --work guwenqing/chatgpt-bot-kit#3
npm run assuredloop -- check --target "$PWD" --work guwenqing/chatgpt-bot-kit#3
npm run openspec -- validate activate-assuredloop --strict --no-interactive
```

The initializer can be previewed against the actual config:

```sh
npm run assuredloop -- init --target "$PWD" --config "$PWD/.assuredloop/config.json"
```

Do not add `--apply` to resolve a conflicting or changed configuration without
the applicable governed transition. The initializer preserves native skills and
the `.openspec-target` marker. Changes to installed AssuredLoop guidance originate
in its source package and are regenerated through a reviewed adoption update.

Native/manual artifact checks and independent Astra reviews supply initial
assurance. No automatic CI, branch protection, scheduler or external-review
provider is configured. Missing policy, unavailable references and incomplete
evidence remain visible limitations, never successful activation.
