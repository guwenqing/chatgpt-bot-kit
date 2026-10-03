# session-clear
Tier: 1 · Status: concluded

## Owner's words and dialog

- 2026-10-03 the owner's words, snapshot origin/2026-10-03-owner-words.md

## Organized requirement

R1: The user or a bot MUST be able to ask the kit to clear a session (`obk session clear`) or to compact it (`obk session compact`), instead of typing into its tab. Amends: [PRD-12]
R2: The kit MUST NOT type into a session that is busy, or that has a question on its screen. It waits up to 30 seconds for the session to be idle, then refuses and says why. Amends: [PRD-12]
R3: The kit MUST press Return only when the screen shows the harness's own command and nothing else, and MUST take back what it typed otherwise. Amends: [PRD-12]
R4: A clear MUST be confirmed by the new conversation in the book. The session gets its start prompt again from the kit's hook, as for any clear. Amends: [PRD-12]
R5: A compact MUST be confirmed by the harness's own record within 5 minutes, or the answer MUST say it is not confirmed yet. Where the harness does not offer compact, the kit MUST say so and enter nothing. Amends: [PRD-12]

Assumed: the 30 seconds and the 5 minutes are the architect's rulings. How the kit types the command (one character at a time, through its gate) is how it does it, not a promise.
Out: sending the start prompt by hand; any tab but the session's own.
Signed off: 2026-10-03 owner, origin/2026-10-03-signoff.md

## Outcome

- R1 The user or a bot MUST be able to ask the kit to clear a session (`obk session clear`) or to compact it (`obk session compact`), instead of typing into its tab.: in [PRD-12]
- R2 The kit MUST NOT type into a session that is busy, or that has a question on its screen. It waits up to 30 seconds for the session to be idle, then refuses and says why.: in [PRD-12]
- R3 The kit MUST press Return only when the screen shows the harness's own command and nothing else, and MUST take back what it typed otherwise.: in [PRD-12]
- R4 A clear MUST be confirmed by the new conversation in the book. The session gets its start prompt again from the kit's hook, as for any clear.: in [PRD-12]
- R5 A compact MUST be confirmed by the harness's own record within 5 minutes, or the answer MUST say it is not confirmed yet. Where the harness does not offer compact, the kit MUST say so and enter nothing.: in [PRD-12]
- Added: none
- Modified: [PRD-12]
- Removed: none
- Dropped: none
- Kept: none
- Decisions: none
- Agent rulings: none
- ADRs added: none
- ADRs superseded: none

Notes:
