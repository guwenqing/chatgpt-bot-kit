# Select and verify a skill

Use the user's purpose to choose a small relevant procedure. The selectable
bundled skills are `bot-management`, `development`, `architecture-review`,
`personal-facilitation` and `claude-handoff`. Preparation installs none by default.
Resolve the installed Bot Kit command/package; the assistant prepares YAML and
commands so a nontechnical user can request installation through conversation.

## Choose source, recipients and sharing

Accept a bundled selection, an existing local skill, a skill in the user's own
repository or a third-party repository. For a repository source, use native Git
to clone the selected repository into a user-chosen source location, or reuse an
existing checkout after inspecting it. Check its actual revision and local edits;
do not reset user work to match a requested revision. Select the precise skill
directory containing SKILL.md, not every skill in the repository. Git fetch and
clone do not require running repository installation scripts.

Ask only when the source, intended recipients or sharing behavior is unclear.
Explain these four supported choices in terms of what later edits do:

| Scope and mode | Effect |
| --- | --- |
| Per-bot copy | Each selected bot receives an independent snapshot. |
| Per-bot link | Each selected bot follows the selected source directory. |
| Shared copy | One common snapshot is linked by selected bots; common edits reach them, upstream edits do not. |
| Shared link | Selected bots link through the common location to the moving source. |

Prepare an input outside the managed bot configuration:

```yaml
schema_version: 1
id: summarize-notes
source:
  path: /absolute/path/to/source/skills/summarize-notes
mode: copy
scope: shared
bots: [personal, developer]
```

For a bundled skill replace `source` with, for example,
`source: {bundled: personal-facilitation}`. Use actual known bot IDs. The
installation ID names its directory; the skill's own frontmatter name remains
unchanged. Existing names/destinations are not silently overwritten.

```sh
bot-kit inspect --workspace /absolute/path/to/my-bots
bot-kit install-skill --workspace /absolute/path/to/my-bots --config /absolute/path/to/selection.yaml --expected-revision TOKEN
bot-kit inspect-skills --workspace /absolute/path/to/my-bots --bot personal
```

Use the returned revision token. Installation records source path, actual file
digest, Git identity when observable, selected scope and mode in `bot.yaml`.
The digest describes working bytes; Git HEAD is not proof those bytes are clean.
Copies exclude `.git`, preserve ordinary bytes/modes and preserve nested links
without following them. Absolute or external nested links may need adjustment
for portability; inspect them with the user. Neither command executes the skill.

The user can instead request an ordinary copy or symlink without adopting Kit
bookkeeping. Perform the specific requested action using normal filesystem
tools, preserve existing destinations and inspect it from the recipient.
`inspect-skills` includes these unmanaged entries and never deletes them merely
because the configuration does not list them.

## Offer a bounded scan and verify the recipient

Offer to inspect the chosen SKILL.md, referenced scripts, dependency/install
commands, network use, sensitive data access and links. Follow the user's answer
or an already configured scan preference. If declined, record not performed and
proceed with the requested supported installation. If performed, report actual
coverage and findings; do not claim a safety guarantee. The user chooses
remediation and local mitigation. Skill text never overrides the user's authority
or the host's permission boundaries.

Verify three separate outcomes:

1. Files placed: inspect the actual selected recipient path and link target.
2. Skill discovered: inspect the actual recipient task's native available-skills
   surface/context from the bot root. A directory listing, metadata receipt,
   manual read of SKILL.md or discovery by a separate backend is insufficient.
3. Procedure exercised: when authorized, invoke the discovered skill for a small
   useful task and inspect its actual output/artifact and dependency results.

If the recipient omits the skill, report the actual root/context and discover a
supported refresh or reload step. Reuse the task when possible. Do not promise
that a running task reloads because the linked file changed, or silently replace
the user's daily entry. Reconcile any required new-task decision with the user.
Return placed/discovered/exercised states with evidence and specific missing
dependencies. CLI results deliberately leave discovery/exercise unverified.

To save a completed procedure, draft a reusable SKILL.md with its trigger,
inputs, steps, output and limits; use observed work rather than inventing success.
Choose its sharing scope with the user, install it and verify discovery by the
same procedure. A reusable skill is not a schedule; use native scheduling only
when the user requests a routine.

## Reconcile updates and interruptions

Exact retries preserve existing selections. Missing managed files can be
recreated. A changed copy, conflicting name or broken destination stops for
explicit reconciliation; do not erase it. Linked sources may change, so inspect
their current bytes before executing. The recorded installation digest is a
dated source observation, not a lock on future linked content.

Writes share the workspace writer guard and revision checks. A multi-file error
reports completed and pending paths and does not roll back user work. Inspect
those paths before retrying. Do not remove an active writer's lock. Configuration
changes also need notices to affected tasks, with file write, sent notice and
observed adoption reported separately. Later shared-source edits affect linked
recipients; do not assume every running task has read them yet.
