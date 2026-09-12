# AssuredLoop consumer setup

Repository: `guwenqing/chatgpt-bot-kit`. Native product context: `openspec/`.
Selected integration: Codex, with native and AssuredLoop skills in `.agents/skills/`.

## Acceptance state

The owner accepted the fixed policy and ordered delivery in PR #4. Accepted
bootstrap was squash-merged in commit `151cf5dd8fc50b106f8fbb40051da5c8addd2f38`,
and live default-branch resolution verified `bootstrap` mode there. The config
references the real policy/proposal acceptance record.

The independently reviewed `activation.json` checkpoint was squash-merged in
[PR #5](https://github.com/guwenqing/chatgpt-bot-kit/pull/5) at
`874cb73a3ef52423231d48f66d3db932dcf40f44`. Live default-branch resolution then
verified `available / activation`, with unchanged accepted configuration and
activation SHA-256 `c8dacce6a5d0b1059f01075d14bf32e75187ab00e0a39a56d4e96b2033a9c2ba`.
[Actual delivery evidence](https://github.com/guwenqing/chatgpt-bot-kit/pull/5#issuecomment-5647084957)
records tree equality, the single squash parent and the observed active binding.

The checkpoint cites the owner decision, independent usable-base review and real
bootstrap delivery. Its timestamp records preparation; the PR records delivery.
Its pre-change assessment used bootstrap mode with a null activation digest.
Future PRs read configuration and activation from their actual destination's
pre-change revision. Never treat a candidate as its own acceptance authority.

The exact consumer choices are in `policy.md`; the owner additionally requires
squash merge for this repository's PRs, recorded in `AGENTS.md`. Planning is tracked in
[Issue #2](https://github.com/guwenqing/chatgpt-bot-kit/issues/2), with consumer
adoption and activation in [Issue #3](https://github.com/guwenqing/chatgpt-bot-kit/issues/3).
Both are native children of [Epic #1](https://github.com/guwenqing/chatgpt-bot-kit/issues/1),
along with the separate aggregate [closeout Issue #6](https://github.com/guwenqing/chatgpt-bot-kit/issues/6).
The native plan is `openspec/changes/activate-assuredloop/`.

## Selected package

- Package: `assuredloop-base@0.1.0`.
- Source repository: `guwenqing/assuredloop-base`.
- Code/assets revision: `7343ffc7518200ce80437a9c914448dd6f176a35`.
- Canonical contract source: `9dfe8524072aec0f896dd7bacb345d7ed6471aac`, path `openspec/specs`.
- Tarball integrity: `sha512-qlluADcTol0mYvRs/ERpi95G7faEucIri5Q6/a8rjl8FL7zqbalRKKRKbGTb6hAkfzBf1zXgYNWQ44LXlZ96Ig==`.
- Source dependency-lock SHA-256: `48532848bae0577d003a79fcbd735d870794d36c7f1e12cc257e04081beed26c`.
- Direct dependencies: OpenSpec `1.12.0`, AJV `8.20.0`.

These values describe this consumer's selected artifact, not the source project's
own consumer activation. Its historical approvals do not authorize this project.
Reconstruct this selection from the fixed source Git tree in a separate build
directory, pack with lifecycle scripts disabled, and compare the SRI. The selected
revision includes the reading-scope documentation change observed during adoption.
Do not reset someone else's live source changes to reproduce an artifact.
This consumer selection does not accept an upstream framework release.
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

## Initial bootstrap evidence limitation

PR #4 predates any accepted destination configuration. Its real owner decision,
independent reviews and verified squash delivery are native/manual bootstrap
evidence, as permitted by the framework's self-evolution contract and shared
template guidance. Its missing historical policy/config fields must not be invented.
Later CLI checks of planning prerequisite #2 currently recognize the merged PR
and task coverage but report `delivery-review-missing` and `evidence-missing`
because they only count structured Evidence. This is tracked in
[AssuredLoop #25](https://github.com/guwenqing/assuredloop-base/issues/25).

The activation reviewer must independently establish that specific prerequisite
from the original scope, actual owner decision, separate-session reviews, merge
metadata, tree equality and task coverage. Preserve the CLI's incomplete/invalid
result as a diagnostic limitation; do not call it PASS. Current activation and
later work still need their complete applicable assessment records under the
accepted pre-change policy. This historical bootstrap boundary is not a general
waiver for missing evidence.

First-consumer feedback is tracked in the source project's
[Epic #21](https://github.com/guwenqing/assuredloop-base/issues/21), including
artifact verification, the initial evidence gap and intake improvements. The
[evidence template heading issue #27](https://github.com/guwenqing/assuredloop-base/issues/27)
is also reported there. Current structured Evidence must use the supported
`## Workflow context` heading with a JSON block; `## Structured evidence` is not
recognized by the selected package's record discovery. Follow-up source changes
do not silently update this consumer's accepted package binding.
