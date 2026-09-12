# Conversational bot management

Use this guide when the user asks to create or change a bot, add a conversation,
or bring existing work into a bot. Resolve the installed Bot Kit package and its
`bot-kit` executable; commands below also work as `node src/cli.js` from that
package. Do not require the user to write YAML or learn command flags.

## Establish the intended role

Translate the user's description into a name, purpose and default daily
conversation. Ask only for choices that change the outcome: an unclear role,
requested model/effort, skills to select, or existing work to inherit. Do not
create a catalog of bots during initialization: `prepare` creates only Bot
Father. A personal helper, developer and reviewer are later user choices.

Inspect the workspace and Bot Father's directory first. Reuse an exact existing
bot identity when the user intends to continue it. Different responsibilities
normally have different bot roots; conversations of one bot share that root,
memory and working copies. A conversation is not a permanently running process.

Create a small YAML file outside the managed configuration being changed:

```yaml
schema_version: 1
id: personal
name: Personal helper
purpose: Help me organize my day and maintain an editable local to-do list.
rules: []
skills: []
sessions:
  - id: daily
    role: Daily personal assistance
    default: true
    startup_prompt: Help me organize today's priorities and keep my local to-do list current.
```

This is an example role, not an automatic selection. Add `model` and `effort`
only when the user selected them. Keep additional conversations in `sessions`
with their own `id`, `role` and `startup_prompt`, and exactly one default. Model
names and effort support come from the actual host; this product does not
impose the development repository's choices. Empty `skills` selects none;
listing a skill is not proof that it has been installed or discovered.

```sh
bot-kit inspect --workspace /absolute/path/to/my-bots
bot-kit create-bot --workspace /absolute/path/to/my-bots --config /absolute/path/to/personal.yaml --expected-revision TOKEN
```

Use the actual revision returned by inspection. For an intended modification,
use `configure-bot` with the same bot ID and complete chosen configuration.
`regenerate --workspace ... --bot personal` reconciles that bot's guidance.
Keep common preferences in YAML `rules` or outside the managed AGENTS markers;
keep session-only behavior in that session's startup prompt. Direct edits
inside the markers must be preserved and reconciled, not discarded on retry.
Configuration changes also need notices to the affected native conversations;
report file writes separately from sent notices and observed adoption. Ordinary
memory updates stay quiet unless the user requests a notification.

The directory returned by `inspect` reads current bot configuration rather than
another copy of its prompts. Missing members stay visibly missing. Observations
are dated evidence, not authority to overwrite chosen duties or settings. When
an identity is stale or ambiguous, reselect through actual native evidence;
never send work to the closest-looking name. Use the specialized session when
its duty fits, otherwise the bot's configured default. Ordinary bots need user
authorization to read another bot's private history. Bot Father and its grooming
session may inspect the conversations of bots they manage.

## Establish the native daily entry

Discover the tools and supported CLI entry points on the user's actual desktop.
Match an existing project by the bot's absolute root and verified identity before
creating one. Absence of an add-project MCP tool does not establish that automatic
registration is unavailable.
Use that bot root as the primary folder for new conversations. A nested target
repository is a working object, not the bot's root. Do not silently select a
new worktree just because a host tool defaults to one for Git projects.

On macOS, inspect the installed official `codex app --help`. When its documented
workspace-path entry is available and the desktop app is installed, the assistant
can run the following for the prepared bot root:

```sh
codex app "/absolute/path/to/my-bots/bots/bot-father"
```

Use an argument-safe invocation with the actual absolute path. Then call the
desktop's `list_projects` and require one matching project root. The command's
successful exit alone is not registration evidence. Reconcile an absent or
ambiguous result before retrying; reuse a verified existing project. The official
[CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
documents that macOS opens the workspace path; it does not promise the same
behavior on every platform. Discover an equivalent supported operation on other
hosts rather than assuming this command registered a project there.

Use the returned project ID with the native `create_thread` tool, explicitly
selecting `target.environment.type: local` for the bot's shared root. This is
also needed when a nested bot folder is reported as a Git project because an
ancestor is a repository. A normal worktree default would choose the wrong
workspace. Create only the requested daily/additional entry, not a replacement
for an existing task, and retain its returned identity for readback and retries.

When supported automatic registration is actually unavailable, preserve the
prepared files and describe the specific missing capability. A concrete guided
native action can complete the remaining step, but a manual checklist alone
does not satisfy an automated-setup outcome. A safety denial is not permission
to edit host databases, impersonate another app, automate a denied UI through
another channel or launch a separate server to control the same conversation.

Create or guide the daily conversation using the configured startup prompt and
explicitly selected supported settings. Check the returned actual project,
conversation root and settings on the relevant surface. Do not substitute a
model/effort, infer desktop readiness from a backend-only write, or translate an
App Server ID into a connector ID. Reconcile a pending creation before retrying
so an uncertain response does not create duplicate conversations.

Keep a minimal YAML observation outside the managed receipt and record it with:

```sh
bot-kit record-native --workspace /absolute/path/to/my-bots --bot personal --receipt /absolute/path/to/observation.yaml --expected-revision TOKEN
```

An observation has this shape; replace every example value with actual evidence:

```yaml
schema_version: 1
bot: personal
observed_at: '2026-09-12T20:00:00.000Z'
source:
  surface: exact-native-surface
  method: Explain the actual native read or user observation.
state: observed
project:
  surface: exact-native-surface
  id: returned-project-id
  root: /absolute/path/to/my-bots/bots/personal
sessions:
  - id: daily
    native:
      surface: exact-native-surface
      id: returned-conversation-id
      root: /absolute/path/to/my-bots/bots/personal
    settings_status: unverified
evidence:
  - Describe what was actually observed and where its record can be found.
```

Record actual `model` and `effort` where observed. Use `settings_status: matched`
only when the requested settings were checked, `unsupported` for an observed
unsupported choice, or `unverified` when the host did not expose them. Unavailable
registration can be recorded with `state: unavailable`, no `project`, and
`sessions: []`; other states are `backend-only`, `stale` and `ambiguous`.
The CLI always returns `native_ready: false`: it can validate supplied evidence,
but cannot authenticate that a desktop operation happened. The managing agent
must separately prove the relevant native entry, requested settings and a small
useful response before reporting readiness. Open or link that daily entry and
give the user a natural next request, such as “Help me plan today.”

## Bring existing work into any new bot

Migration is optional at every bot creation. Identify the specific source
conversation, selected working directory and destination with the user. Inspect
the source's real state and choose a method; do not treat copying configuration
as copying memories or history. Preserve the original conversation and files.

Prefer verified native continuation when it preserves the intended context and
root. A loaded or active conversation must not be run concurrently through a
second process. If safe rebinding is unavailable, explain the specific fork or
context-transfer choice and ask for the needed decision. Never claim an old
loaded conversation changed roots merely because metadata was updated.

With permission to read the source, a context transfer should preserve its goal,
user decisions, relevant memories and evidence, unfinished steps and next action.
Separate user decisions from inferred summaries and state omissions. Put this
readable handoff in the new bot's workspace; do not copy unrelated private
history. Before target work, read its AGENTS.md and applicable nested guidance
even if those instructions were not loaded with the bot's startup context.

Inventory the selected working directory before any transfer:

```sh
bot-kit inventory --source /absolute/path/to/source --output /absolute/path/to/source-inventory.yaml
```

The source is the selection boundary: all ordinary files below it are included,
including dirty, untracked and ignored files. Inventory records paths, hashes,
permission bits and link targets, not raw file contents. Keep the manifest outside
the source. It does not record `.git` internals as portable content; it separately
observes Git HEAD/status, worktrees and submodules with read-only commands.
Review ignored/environment files with the user when selecting what to transfer;
do not expose credentials in reports. If the source changes, reconcile and take
a fresh inventory rather than reusing a stale success record.

Choose clone plus restoration of selected unfinished files, or a suitable whole
copy when cloning is unavailable or unsuitable. Keep different bots' clones
separate by default. An explicitly selected external directory remains allowed;
explain that it shares mutable state. Do not move/delete the source. Examine
linked worktrees, submodules and link targets before choosing a copy command:
Git pointers, absolute links and machine-specific environments may need separate
recreation. Inventory excludes ACLs and extended attributes and is not an atomic
snapshot of active work.

```sh
bot-kit verify-migration --inventory /absolute/path/to/source-inventory.yaml --destination /absolute/path/to/my-bots/bots/developer/work/project
```

`status: incomplete` is a completed assessment with mismatches or a changed
source; it exits successfully so the caller must inspect the JSON status.
`status: verified` proves the selected ordinary files and modes match while the
source is unchanged. Extra destination files are not removed or treated as
missing source content. Verify Git branch/HEAD and required associations
separately; file equality does not prove executable environment readiness or
conversation continuity. Record unresolved portability items precisely.

Finally ask the receiving bot to perform a bounded continuation of the inherited
work and inspect its result from the actual native entry. For a personal bot,
that might be editing one inherited to-do item; for a developer, completing one
small unfinished change after reading target rules. Report file verification,
context transfer and demonstrated continuation as separate outcomes. A remaining
native setup step leaves the migration incomplete even when all copied files
match.
