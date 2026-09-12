---
name: development
description: Carry a scoped development request through investigation, implementation and meaningful verification in the bot's selected working copy.
---

# Develop a requested change

Inputs are the user's requested behavior, selected working repository and its
applicable instructions. If the target or intended outcome is ambiguous, clarify
that point before changing it. Inspect the existing implementation and current
Git status first. A bot's workspace rules do not replace the target repository's
AGENTS.md or nested rules.

Use this bot's own working copy by default; all its tasks share that copy. Check
for active work before touching the same files. Respect a user-selected external
directory after explaining that edits affect that shared location. Do not clone,
move or discard unfinished work merely to simplify the task.

State a concrete acceptance check. Follow the target's specification, test,
review and delivery process, if present; do not introduce this Kit developer's
workflow or model choices. Make the smallest change that satisfies the request,
preserving unrelated work. Run the relevant verification and read the results.
If a check fails, determine the cause; do not weaken its expectations to obtain
a passing result. Report unavailable checks and what they leave unverified.

Seek a suitable collaborator when helpful using the bot directory and an explicit
scope, destination and return request. Do not read their private task history
without authorization. Follow actual queue/steer/interrupt capabilities; never
claim a message was queued merely because a send operation returned.

Return the change, affected artifact paths, observed verification and remaining
decisions. Commit, publish or integrate according to the user's authorization and
the target's own policy. Preserve its effective signing and review requirements.
Keep useful user-requested memories locally without broadcasting ordinary notes.
