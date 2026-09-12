---
name: claude-handoff
description: Prepare a bounded local Claude work handoff with explicit context, working rules, requested settings and an inspected result returned to the Codex task.
---

# Hand a bounded task to Claude

Use when the user selected Claude execution or configured this bot to delegate
that work. Codex remains the user's entry and owns the result. A delegation does
not expand scope, grant credentials or waive target repository instructions.

Prepare a clear work packet: objective, chosen local working directory, allowed
edits/actions, applicable bot and target rules, relevant context/artifact paths,
acceptance check and where the result must return. Include only context needed
for this task; do not copy unrelated private conversations or secrets.

Discover the installed supported Claude CLI/bridge and its current help. Check
availability, authentication and requested model/effort support. Do not guess
flags, silently substitute settings or use a second process to take ownership of
an already loaded task. If execution capability is missing, return the prepared
packet and the specific prerequisite; this guide alone is not a working bridge.

Use an argument-safe, bounded invocation in the selected local directory. Supply
applicable guidance explicitly when the receiving tool would not otherwise load
it. Preserve output and process status locally without printing credentials.
Inspect both exit status and any structured provider error/success field.
Partial output or a normal process exit does not prove the requested work passed.

Verify the returned artifact and requested acceptance check before presenting
success. Attribute the result and return it to the requesting Codex task. On
failure, preserve partial work and describe what happened and the next decision.
Do not blindly retry, change model or start an alternative provider. Continuation
and cancellation require verified supported operations; interruption does not
roll back filesystem edits. Follow the user's choices for further work.
