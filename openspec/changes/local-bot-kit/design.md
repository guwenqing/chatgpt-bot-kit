## Context

See [Proposal — Why](proposal.md#why) for the product outcome. The repository currently has workflow tooling but no Bot Kit implementation or product baseline. [Spike #10](https://github.com/guwenqing/chatgpt-bot-kit/issues/10#issuecomment-5647836285) has independently reviewed R1–R7 observations. It demonstrates useful native primitives, not complete desktop integration: project identifiers differ across surfaces, loaded resume does not necessarily change cwd, instruction/skill discovery depends on root, queue retries can duplicate, and Claude resume failed in the tested environment.

The user owns the workspace and wants to operate through Codex desktop local projects. The Kit supplies ordinary local files and skills. Bot Father is a persistent role with a daily conversation, not a daemon. Product configuration is YAML; native host formats and actual permission enforcement remain the host's responsibility.

## Goals / Non-Goals

**Goals:** keep the bot root stable; make configuration and native completion distinguishable; preserve user edits and unfinished work; prove at least one complete novice workflow before broadening use; make every proposed capability traceable to original requirements and observable user journeys.

**Non-Goals:** no replacement for Codex's runtime, scheduler, desktop UI or message transport; no new policy engine or authoritative database; no global scan of unrelated projects; no implicit cloud execution, registry publication or enforcement sandbox. Deferred panel discussion does not justify a participant framework in this release.

## Decisions

### D1 — A small npm utility supports conversational skills

Use Node.js ESM and the repository's existing Node minimum, standard-library filesystem/process primitives, one pinned maintained YAML parser selected during implementation, and the built-in test runner. Prefer no build pipeline unless a demonstrated requirement needs one. Expose a small `bot-kit` CLI for deterministic configuration, preparation, inspection and receipts; supply skills for conversational decisions and native host operations. The CLI must not pretend to be an AI planner.

The entry instruction points to versioned, agent-readable installation/setup guidance. A capable assistant resolves the local or packaged Kit, checks prerequisites and calls the utility. An incapable assistant supplies the exact local handoff. Packaged assets use package-relative paths and are tested from `npm pack` installation as well as the local npm link; the published registry is not required for this delivery.

Alternative considered: a new application/server managing every conversation. It duplicates the user's chosen platform, creates a second scheduler and introduces unsupported state ownership. A scripts-only approach without conversational guidance would fail the nontechnical entry requirement.

### D2 — YAML stores user intent; native identifiers remain surface-specific

Proposed minimal layout in a user-selected workspace:

```text
workspace/
  .bot-kit/workspace.yaml          # format version and Bot Father location
  common/skills/                  # explicitly shared installed sources
  bots/bot-father/
    bot.yaml                      # purpose, user rules, skill selections, sessions
    registry.yaml                 # managed membership and observed summaries
    AGENTS.md                     # Kit-owned region plus preserved user content
    .agents/skills/               # selected skill copies or links
    memory/                       # explicit shared bot memory
    work/                         # bot-owned target clones/files
  bots/<requested-bot>/
    bot.yaml
    AGENTS.md
    .agents/skills/
    memory/
    work/
```

The registry remains inside Bot Father as requested. It stores membership and references to each bot's `bot.yaml`, with clearly dated observed summaries; it does not duplicate every prompt as another authority. A session entry records its role, startup prompt, requested model/effort, default designation and verified native identity. Native IDs include the surface they came from; connector project IDs and App Server IDs are never interchangeable strings. No unrelated bot discovery is performed.

Use a `schema_version` and reject unsupported versions, malformed YAML, duplicate bot/session identity and conflicting defaults with actionable file/field messages. Use explicit paths confined to the selected destination for managed writes; external work paths require the user's selected exception. Persist minimal progress/notification receipts as YAML adjacent to the owning bot, with requested/observed state and evidence separated. Receipts are inspectable operational records, not claims that a file alone proves a native outcome. Avoid a generic event store or mandatory status database.

Before a configuration write, re-read/check the prior content, prepare replacement files and use atomic replacement. Detect competing writers with an exclusive short-lived write guard and changed-input check; do not silently overwrite newer content. Multi-file failure returns the affected files and completed steps rather than claiming a transaction the filesystem did not provide. Re-running preparation reconciles deterministic identities and actual native matches before creating more resources.

Alternative considered: a central database or copies of full configuration in the directory. Both create unnecessary authorities and synchronization obligations. Separate state per conversation would contradict the bot-owned shared workspace.

### D3 — Preserve customization and keep target instructions explicit

Compile packaged defaults and the user's YAML bot rules into a clearly delimited managed region of `AGENTS.md`, preserving content outside that region. Record the previously generated region's digest. If the region was edited directly, preserve it and present a conflict/merge choice; do not overwrite or require the user to abandon manual customization. Session prompts remain YAML scalars and are supplied to their native conversation separately.

User customization controls Kit defaults within the actual platform instruction hierarchy. Contradictory requirements that cannot be reconciled remain an explicit question. Package upgrades use the same preservation checks. Managed skill sources are not promoted into global user instructions.

Start bot conversations at the stable bot root. Before target work, read the applicable target and nested instructions, including when a nested Git boundary omitted bot-root sources during a separate startup. Do not rewrite target `AGENTS.md` to force this. Each bot normally clones a project independently; conversations within that bot share its clones and must inspect current work before editing. Worktrees are an explicit task choice, not a default per-session requirement.

Memory is ordinary readable local content consulted by bot guidance when relevant. Explicit remember requests persist there. Do not present host-generated cross-thread memory as bot-private storage or promise instantaneous adoption. Ordinary bots' history restriction and the management exception are behavioral constraints under shared host tools.

Alternative considered: regenerate the complete guidance file, or rely entirely on implicit ancestor discovery. The former loses user edits; the latter contradicted the nested-root probe.

### D4 — Use the actual native host, with honest readiness states

Native operations run through available Codex app tools or another verified connection to the actual relevant host. Discover capabilities and current schemas at the execution boundary, then use only supported fields. Keep local preparation separate from project registration, conversation creation, message acceptance and actual result. The skills can call the native surface and record returned IDs/evidence with the utility. The CLI does not launch its own server to control a conversation active in the desktop.

For project/session setup, match absolute root and explicit identity, create using supported idempotency where available, and read back from the intended surface. The default session must use the local bot root, not the app tool's default Git worktree. If registration is unavailable, retain prepared state and guide the native desktop action; verify the resulting daily entry before calling the bot ready. If only backend association is observable, state that remaining visible step precisely.

For messaging, use queue/steer/interrupt only when that surface and actual active state are available. Queue acceptance is not completion, and a queue client ID is not assumed idempotent. After ambiguous delivery, check recorded native IDs/results before retrying. Keep a single responsible sender and return destination. An unavailable mode becomes an explicit capability limitation and supported handoff, not a replacement transport. A separate process reporting `notLoaded` never proves a desktop bot is idle.

Alternative considered: standardize on the research App Server process. It is useful for isolated protocol tests but cannot establish ownership of an already running desktop session. Purely simulated tests also cannot establish user-facing host readiness.

### D5 — Migration is an agent-guided operation with verifiable inventory

Bot creation asks whether there is existing work to inherit when relevant. Inspect the selected source and offer the suitable method: verified resume, fork, or explicit context transfer. Record source and destination identities and what transferred. Native resume of a loaded conversation must not race another process; the research's cold-resume result is not permission to reopen a live task elsewhere.

For working files, inspect Git state and local files before selecting clone/restoration or copy. Preserve requested tracked edits, untracked work and applicable ignored/environment files; do not expose credentials in reports. For ordinary repositories, compare head/status and selected content hashes. For non-Git sources, compare the selected file inventory. Linked worktrees, submodules and symlink targets need appropriate handling or a disclosed unresolved migration step, not a universal recursive-copy guarantee. Preserve the source unless explicitly told otherwise.

A transferred context document distinguishes user decisions from inferred summaries and links relevant evidence without copying unrelated private history. The receiving bot demonstrates a small continuation of the selected unfinished work before the migration is reported ready.

Alternative considered: always clone the remote or always copy the entire directory. Clean clones omit dirty work; blind copying can retain broken absolute links or machine-specific state. Agent-guided selection implements the flexibility the user requested without a universal migration engine.

### D6 — Skills are selectable files, with recipient verification

Bundle narrowly scoped reusable guidance for management, development, architecture/review, personal facilitation and Claude handoff. Install only selections for the bot's purpose. Keep bundled common assets reusable while allowing local and third-party sources, copied snapshots and live symlinks. Repository sources record the selected revision; requested moving links explain their behavior. Do not inherit this repository's dependency pinning or model policy as a restriction on user-owned skills.

Detect destination collisions and broken links; verify from the recipient bot root through its available discovery surface. Refresh where supported and separately test the selected procedure. Default to offering a scan, report its limited coverage if run, and leave remediation to the user. Scanning is not an installation gate or a guarantee. Direct unmanaged copies/links remain valid user choices.

Alternative considered: a skill marketplace/lockfile framework or auto-installing all roles. Neither is required for a useful first bot and both restrict the user's stated flexibility.

### D7 — Configuration notices and grooming use ordinary native conversations

Configuration changes compute affected bots/conversations from their known selections and shared-source relationships. Show the changed behavior, send or queue supported notices and retain minimal unresolved-delivery receipts. Record acknowledgement/adoption only with actual evidence. New sessions use current configuration; a busy session is not forcibly cancelled to refresh it. Ordinary memory updates do not produce those notices.

Offer grooming after Bot Father's daily entry works. The user chooses or accepts a daily cadence, model and effort for an extra persistent conversation. A native heartbeat attached to that conversation fits the desired continuity; actual model/effort and scheduler semantics must be verified, since not every schedule API accepts independent settings. Do not silently replace it with per-run standalone tasks.

Grooming inspects managed conversations or asks them, refreshes bookkeeping and sends actionable findings to the daily entry. Keep one record per unresolved finding and notify on meaningful changes. The daily entry follows user policies or asks the specific decision needed. Kit problems produce a suggested Issue/Request; publication requires the user's applicable authorization. Local mitigation remains separate from upstream repair.

Alternative considered: schedule grooming silently during initialization or let every patrol repair autonomously. Both preselect behavior the user left configurable and complicate the simple initial entry.

### D8 — Claude is a bounded local executor with explicit error handling

Use the installed, user-selected Claude programmatic CLI when available, with structured output and explicit working context. Invoke with argument arrays, not shell-composed prompts. Check executable/auth availability without logging secrets. Adapt bot and target guidance through supported prompt/import mechanisms while preserving user-owned `CLAUDE.md` and configuration; do not disable setting sources as a supposed default.

The work packet contains objective, scope, applicable rules, inputs and return destination. Requested model/effort are used only if supported and verified; report unavailable settings. Interpret exit code, error flags and partial output together. A session ID is a receipt, not proof that continuation works. Preserve provider refusals and ask a specific recovery choice when no prior instruction covers retry/new session. No silent model switching or repeated attempts to bypass the refusal.

Alternative considered: treat every JSON `success` subtype as success or always fall back to a new session. Both contradicted observed failures and would conceal lost context. Claude integration here is a target capability; development and review of this repository still follow its separate Astra policy.

## Grok usage and user-visible acceptance mapping

The [official Grok design article](https://x.ai/news/designing-grok-bot) emphasizes recognizable bot roles, understandable activity and accessible work results. We adopt those product principles through native Codex conversations and files. We do not copy its visual shell or assume its cloud runtime is available. The [reviewed research mapping](https://github.com/guwenqing/chatgpt-bot-kit/issues/10#issuecomment-5647836285) preserves detailed source/probe distinctions.

| Journey | Grok usage source and transferable idea | Bot Kit acceptance basis |
| --- | --- | --- |
| U1: first successful setup | [Get started](https://docs.x.ai/grok-bot/get-started): guide a user toward a useful first task | `conversational-onboarding`: one entry, observed daily readiness, interrupted retry and incapable-assistant handoff |
| U2: give a bot a lasting job | [Bots](https://docs.x.ai/grok-bot/bots): named continuing role distinct from a request | `bot-management-and-migration`: personal or technical role, selected guidance, verified daily/specialized conversation |
| U3: bring unfinished work | [Bots](https://docs.x.ai/grok-bot/bots): configuration duplication is distinct from history/memory | `bot-management-and-migration`: explicit resume/fork/transfer, source preservation, dirty/untracked inventory |
| U4: ask for daily help | [Chat](https://docs.x.ai/grok-bot/chat-and-collaboration): describe an outcome in conversation | `conversational-onboarding`: useful personal to-do result without CLI knowledge or repeated continuation prompts |
| U5: find a collaborator | [Chat](https://docs.x.ai/grok-bot/chat-and-collaboration): asynchronous handoff and later result | `bot-coordination`: directory-based destination, original authority, return owner and observed state |
| U6: understand progress/intervene | [Notifications](https://docs.x.ai/grok-bot/settings-and-notifications): working/unread/attention are different | `bot-coordination` and `conversational-onboarding`: queue/steer/stop, honest unknown state, actionable attention |
| U7: teach and share a procedure | [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations): procedure and trigger are distinct | `skill-assembly`: create/install, shared/local sources, real discovery, scan choice and a separately exercised skill |
| U8: make it recurring | [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations): routine has owner, timing and result | `grooming-and-routines`: extra conversation, inspect/edit/pause, actual first firing, daily-entry return |
| U9: inspect/revise a result | [Files and results](https://docs.x.ai/grok-bot/files-and-results): accessible artifacts and corrections | `conversational-onboarding`: openable/editable output and revision of that result |
| U10: change lasting behavior | [Bots](https://docs.x.ai/grok-bot/bots): lasting guidance versus a one-off request | `bot-workspaces-and-guidance` and `bot-coordination`: YAML scope, preserved edits, notification versus adoption |
| U11: recover/get help | [Notifications](https://docs.x.ai/grok-bot/settings-and-notifications): failure/attention needs a next action | All capabilities' negative scenarios; `grooming-and-routines` and `claude-handoff`: evidence, local mitigation, provider failure |

The local KB's historical reports of missing imported skills, apparently unsent messages, hidden configuration and difficult artifact retrieval motivate the negative cases above. They are leads, not verified current Grok defects or performance benchmarks. The final formal plan is self-contained; reviewers do not need private KB access.

## Request coverage

Request #9's numbered requirements remain the intake authority. This mapping prevents a technical implementation from omitting the user's refinements:

| Request items | Formal capability |
| --- | --- |
| 1, 5–6 | conversational-onboarding; grooming-and-routines |
| 2–4, 10–14 | bot-workspaces-and-guidance; bot-management-and-migration |
| 7–9 | bot-management-and-migration |
| 15, 20–23 | bot-coordination |
| 16–18 | skill-assembly |
| 19 | claude-handoff |
| 24–28 | grooming-and-routines |
| Owner R7 addition | U1–U11 above and the acceptance tasks |

## Risks / Trade-offs

- **Desktop native capabilities differ from the local CLI** → verify the actual host and retain a visible guided step; automatic behavior is accepted only where demonstrated. A fallback explanation does not pass an uncompleted daily-entry journey.
- **Shared files can change while another conversation works** → optimistic content checks, atomic writes and explicit notice/adoption states; target work still follows its repository's collaboration rules.
- **Behavioral privacy is not isolation** → default history-access guidance and relevant-context handoffs, with the explicit management exception; no sandbox claim.
- **Skill copies, links and user edits have different upgrade effects** → inspectable source/mode, no destructive overwrite, recipient verification and a scan offer.
- **Scheduled settings or firing are unverified** → first-run evidence is a release obligation; configuration readback alone cannot close the task.
- **Claude resume currently fails** → require truthful failure/recovery handling, test one-shot success and injected error combinations, and record live continuity status without promising success.
- **Many features could postpone a useful product** → deliver and test the setup-to-first-task path before completing the wider catalog; no framework generalization or dashboard detour.

## Delivery and verification approach

Use native numbered tasks and real scoped Issues. The change owner integrates reviewed squash PRs to `main`. Independent test authors derive executable acceptance tests from these requirements and run the failing cases before implementation; the implementation producer is a different agent. Independent review checks full scope, real test evidence and negative cases. Configuration/docs-only contributions use artifact and semantic checks.

Targeted CLI tests cover invalid YAML, duplicate/conflicting identities, interrupted/repeated setup, preserved edits, concurrent modification, selected skill copy/link behavior, migration inventory and structured Claude errors. Native fake responses test deterministic handling but never establish desktop acceptance. Live controlled checks must verify the supported host's bot project/daily entry, recipient skill discovery, collaboration result return, configuration notice state and actual grooming firing. Record executed versions and leave unverified operations explicit.

The final user walkthrough covers U1–U11: setup; personal bot and editable to-do result; developer/reviewer roles; unfinished-work migration; a shared skill; busy collaboration with return; a scoped rule change; optional grooming and its actionable finding; bounded Claude success/error; reopening and correcting an artifact. Test on synthetic/user-selected data only. A missing required journey returns to its owning task before closeout.

## Migration and rollout

There is no older Bot Kit installation to migrate. Deliver the package locally, verify both linked development and packed fresh-install paths, and document one copy-paste entry. Initial setup only prepares the selected workspace and Bot Father; existing files and other projects remain under their user's control. Recovery retains prior configuration and partial native receipts. Do not remove created user projects/conversations or rewrite user Git history as an automatic rollback.

At aggregate closeout, reconcile every accepted requirement and U1–U11 with delivery evidence, synchronize the complete delta into current Specs and archive only after verified integration and independent review. Preserve a compact acceptance/fixity manifest; full execution logs remain on work records. The development continuation hook ends when this agreed delivery is complete, not when this planning PR is merely created.
