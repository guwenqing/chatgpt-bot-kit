---
name: bot-management
description: Create and manage local Codex bots, their shared workspaces, daily entries and selected skills, including migration of existing work.
---

# Manage the user's bots

Use when the user asks to create/change a bot, add a task to an existing bot,
install a skill, or inherit work. Resolve the user's installed `bot-kit` command
and package root. Read that package's `templates/bot-management.md` for the
current native setup and migration procedure, and `templates/skill-management.md`
for skill installation. If the package cannot be located, report that missing
prerequisite; do not guess a package location or a native API.

1. Inspect the selected workspace and Bot Father's registry. Establish the role,
   existing identity, intended skills, requested model/effort and any inherited
   work. Ask only for choices the request leaves unclear. The assistant prepares
   YAML; the user can speak naturally.
2. Create only the requested bot. Each bot owns one root and shared files and
   memory; its tasks may have different startup prompts and settings. Keep
   developer and reviewer working copies separate by default. Preserve an
   explicitly chosen external directory and explain its shared mutable state.
3. Prepare/configure with the observed workspace revision. Preserve user YAML,
   rules and text outside managed guidance. Report conflicts and completed/pending
   paths; reconcile them without replacing user work silently.
4. Use supported native operations to register the actual bot root, verify its
   unique project identity and create or reuse the requested local daily task.
   Explicitly choose that shared local root; a Git project's default worktree is
   not the same workspace. Verify the real task root and requested settings.
5. When inheriting work, preserve the source; use authorized native continuation,
   fork or explicit context transfer and verified clone/restoration/copy. Respect
   the working repository's own instructions as well as bot rules. Observe one
   small continuation in the receiving task before calling migration complete.
6. Return a usable daily entry and one natural next request. Report file
   preparation, native association and useful execution separately. Do not invent
   discovery, model support, task delivery or readiness from a local receipt.

Bot Father may read histories of the bots it manages and ask them about problems.
Ordinary bots need authorization to read another bot's private history. Select
collaborators by their configured task duties, using their default only when no
specialized destination is known. Configuration changes require notices to
affected tasks; ordinary memory updates do not broadcast. Keep written, sent and
adopted states separate. Optional grooming is an additional native scheduled
task, not an initializer side effect; return findings to the daily entry.

For Kit defects, suggest an issue containing a minimal reproduction, relevant
versions and expected/actual behavior. Publish only within user authorization,
excluding private content and credentials. The user decides local mitigation and
their own repair/routing policy. Respect explicit user choices and actual host
permission boundaries; this skill does not grant new authority.
