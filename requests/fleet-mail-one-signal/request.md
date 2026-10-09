# fleet-mail-one-signal
Tier: 1 · Status: open

## Owner's words and dialog

- 2026-10-09 the owner's words, snapshot origin/2026-10-09-owner-words.md

## Organized requirement

R1: Each fleet mail MUST reach its receiver by one signal. Orca's own notice comes first. The kit's typed line is a fallback only, and the kit MUST NOT type it when Orca's notice for that mailbox reached the receiver after the send. The kit knows this from the receiver's own record of its turns, not from the clock. A record that cannot be found or read within the watch MUST count as "the notice was not seen", never as "it reached it". Amends: [PRD-16]
R2: When the receiver is idle, the send MUST watch it for up to 8 seconds. It MUST stop at once when Orca's notice arrives, and then type nothing. When no turn started in those 8 seconds, it types its line. When a turn of other work started, a Claude Code session gets nothing typed (its hook tells it, R4), and a Codex session gets the line. Amends: [PRD-16]
R3: The kit MUST NOT type its line into a busy Claude Code tab. A busy Codex tab still gets the line, because Codex takes it into the running turn at once and nothing stays in its input box. That is also what wakes a Codex that waits in its sleep tool. Amends: [PRD-16]
R4: At the end of each turn of a Claude Code session, a hook of the kit's in that session MUST tell it about fleet mail that is still unread, once for each message. It MUST say "still unread" and when the mail came, so it does not read as new mail. It types nothing into the tab. A Codex session does not get this reminder yet: see Out. Amends: [PRD-16]
R5: That hook MUST NOT be able to hold a session in a loop or stop a turn from ending. If it cannot read Orca or the kit's record, it says nothing. It never tells twice about one message, and on Claude Code it lets the turn end when the harness says a stop hook is already active. Amends: [PRD-16]
R6: Every send MUST say which signal went, for example "Orca's notice reached it in 3 s, so no line was typed", "no turn started in 8 s, so the kit's line was typed", or "it is busy, so nothing was typed; its hook tells it when its turn ends". Amends: [PRD-16]
R7: When `obk temp retire` or `obk retire` retires a session that has fleet mail it did not read with `obk message check`, it MUST say how many such messages there are and who sent them. Amends: [PRD-11]

Assumed: the kit keeps a small record of the mail it sent and that is not yet read, in a private folder in the system temp folder, with the sender and the subject only and never the body. It is a hint: the mailbox stays the record, the hook asks Orca before it tells, and a record lost in a temp clean-up loses no mail. The record cannot see a read made with Orca's own `check`, so retire says only what the record knows. The 8 seconds, the hook, and the reminder for mail Orca already announced are the architect's rulings of 2026-10-09. The hook on Claude Code is a new entry in the bot's own settings, and Claude Code asks nothing about it once the folder is trusted; the live check confirms this. Nothing new is typed into a tab with a question or a panel on screen, as before.
Out: the turn-end reminder (R4) on Codex. On Codex it needs a new hook entry, and a new entry puts every Codex session on "Hooks need review" at its next start, which only #506's `session trust-hooks` answers. So it comes in #511, after #506; until then a Codex session that does not read its mail after its one signal (Orca's notice or the kit's line) is not told again. Also out: Claude Code's native messages between sessions; the mailbox itself; the line `obk up` types into a resumed Codex tab (#506's case); Orca's own notice when Orca itself types it into a busy tab.
