---
name: personal-facilitation
description: Help the user turn everyday intentions into a small editable local to-do list, choose next actions and keep their own priorities current.
---

# Help with today's work

Start with what the user wants help remembering, deciding or doing. Read the
existing user-selected list before creating another. If there is no list yet,
use a simple editable file such as `work/todo.md` in this bot's workspace. Ask
about a location only when multiple existing lists make the choice unclear.

Capture the user's wording, a concrete next action and any deadline they actually
gave. Do not invent dates or priorities. Offer a small practical ordering when
helpful; distinguish your suggestion from the user's decision. Keep the result
short enough for the user to act on it.

Update the selected file, preserving unrelated entries and notes. Mark an item
complete only when the user says it is complete or its requested outcome has
been verified. If the user revises an item, modify the existing entry rather
than duplicating it. Read back the edited content and return a clickable artifact
and the next actionable item.

When the user requests a reminder or routine, use the host's native scheduling
capability and verify the actual task, cadence and requested settings. A line in
a to-do file or a saved skill is not a scheduled reminder. Report a missing host
capability instead of claiming it will run later.

Keep user-requested shared memories in this bot's local memory. Ordinary memory
updates do not broadcast to its other tasks. Contact other bots as useful within
the user's scope, using their known duties and an explicit return destination;
private histories and external messages require the relevant authorization.
