# Bot workspace guidance

Use this stable bot root for daily and specialized conversations. All sessions
of this bot share its files, working copies and explicit local memory. Inspect
current work before editing; another session may have changed it. Keep session
startup prompts and requested model/effort in bot.yaml, separate from these
bot-wide rules. Use the host's supported settings; do not substitute silently.

## Working files and target instructions

Use work/ for this bot's target projects and files by default. Different bots
normally keep independent clones of the same project; sessions of one bot share
its clones. Multiple clones are allowed when useful. A user may select an
external or non-Git directory instead: explain shared-state implications and
follow their choice within actual host permissions. Do not move or delete the
original work unless requested.

Before work in a target repository, discover and read its applicable AGENTS.md
and nested instructions, even when the host did not load them at startup. Keep
the bot's role context and obey the target's constraints using the actual
instruction hierarchy. Surface unresolved conflicts. Do not rewrite target
instructions to force bot guidance into them.

## Shared memory

Consult relevant records in memory/ when starting or resuming related work.
When the user asks you to remember something, write that preference, decision or
useful context to an appropriate readable file there, preserving existing notes.
Separate user decisions from your inferences. Ordinary memory updates do not
broadcast messages to other sessions unless the user asks. A shared file is not
complete chat history or provider-generated memory, and running conversations
do not adopt changes instantly.

## Management and user control

Bot Father maintains registry.yaml for the bots it manages. Consult membership,
purpose and session roles to select a helper; use the default session when only
the bot is known. Ordinary bots should ask for relevant context instead of
reading others' private conversations without user authorization. Bot Father
and its grooming session may read managed bots' conversations or ask them.

For bot creation, configuration, native daily entry or migration, consult the
installed Bot Kit package's templates/bot-management.md guide. Resolve it from
the actual bot-kit package, not a target repository. If the package or native
operation is unavailable, state the missing step and preserve prepared work.

Follow the user's configured boundaries. Configuration changes require notices
to affected sessions through available native tools; record what was written,
sent and actually adopted separately. Do not claim an unavailable operation ran.
Grooming is an optional extra session, not an automatically created schedule.
For native collaboration and configuration notices, follow the installed package's
templates/coordination.md. For requested grooming, follow templates/grooming.md.
Its findings go to the daily entry, which follows user policy or asks the
specific decision needed. For Kit problems, suggest an upstream issue with useful
evidence; publish only with applicable user authorization. Local mitigation
remains the user's choice.

## Host limits and customization

Host tool permissions may be shared. These rules and workspace conventions do
not enforce a sandbox or technical isolation. Keep user rules within the actual
platform instruction hierarchy. Users may customize bot-wide rules in bot.yaml
or add text outside the managed AGENTS.md markers. Direct edits inside the
managed region are preserved as a regeneration conflict until explicitly
reconciled; never silently overwrite them.
