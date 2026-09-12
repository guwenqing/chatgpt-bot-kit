# Set up optional grooming

Offer this after Bot Father's daily entry works. Initialization creates no schedule.
Explain that grooming is another persistent conversation in the same Bot Father root.
Offer a daily cadence and ask the user to choose or accept the supported model, effort,
time and inspection/routing boundary. Inspect existing session and automation records
before creating anything; repeated setup should continue the same routine.

## Prepare and verify the conversation

Preserve the full bot YAML and add a non-default `grooming` session with its own role,
startup prompt and chosen model/effort using `configure-bot`. Follow
`templates/coordination.md` for the resulting configuration notices. Create the requested
native task with the existing Bot Father project ID and explicit local environment,
using exactly the supported chosen settings. It shares the bot's workspace; do not
silently replace it with a worktree or a new task for every scheduled run.

A suitable prompt, adapted to the user's chosen management scope, is:

> Read Bot Father's registry and the managed bots' current responsibilities. Inspect
> relevant managed conversation history or ask a bounded question to learn difficulties
> and suggestions. Refresh dated bookkeeping without copying private histories into
> the directory. Record actionable findings with the bot, evidence, proposed next step
> and status. Route new or materially changed findings to the configured Bot Father
> daily entry, then record actual delivery. Keep unchanged, already-routed findings
> quiet. Follow the user's repair/routing policies. When a decision is missing, send it
> to the daily entry to ask the user. Recommend an Issue for a Kit defect; publish or
> mitigate only under applicable user authorization.

Supply the actual workspace, daily native return identity and installed Kit guide paths
to the task. Trial the prompt manually first. Verify identity, local root, settings and
a useful response. A requested model in YAML is not observed runtime proof; preserve
`unverified` when the native surface cannot expose actual effective settings. Do not
mislabel the manual trial as a scheduled run.

## Connect and manage the native schedule

Use the host's native automation tool. A heartbeat attached to the selected grooming
conversation matches this continuing role. Discover its current schema; some heartbeat
tools inherit the task's settings and do not accept independent model/effort fields.
Inspect that behavior and the task's actual configuration instead of inventing fields.

Create the user's chosen local cadence and readable prompt against the actual grooming
task identity. Read back the saved automation, owner, schedule, prompt and settings
behavior. Keep a small YAML note in that bot's `.bot-kit` with the actual automation ID,
task ID, observed settings/evidence and `first_run: pending`. Do not report success
beyond configured status before a real firing. A native tool response may leave setup
pending; reconcile its ID before creating another schedule.

The user can open **Scheduled** or ask the assistant to inspect, edit or pause this
routine. Resolve its existing automation ID, read all saved fields and update only the
requested changes while preserving other fields. Read back the update. Pause never
means delete its conversation, findings or files. Keep notification preferences in the
native setting where supported, not as extra prompt authority.

Verify a real native scheduled trigger, the intended continuing conversation, actual
supported settings, the inspection result and its return to the daily entry. Retain
separate references for configuration, firing and return. A timestamped file or local
receipt by itself proves no scheduler event. Keep computer/app/project availability
requirements explicit; report observed missed, failed or overlapping runs without
promising catch-up or non-overlap semantics the host has not established. Local work
needs the computer on and app running. See the official
[scheduled tasks documentation](https://learn.chatgpt.com/docs/automations?surface=app).

## Keep one useful finding per condition

Use a stable identity for each condition, and call
`bot-kit record-finding --workspace ABS --config ABS_YAML`:

```yaml
schema_version: 1
id: personal-missing-procedure
bot: personal
summary: The selected procedure could not be found by the recipient.
evidence:
  - Actual relevant observation and its reference; exclude unrelated private content.
next_action: Ask whether to restore the chosen skill or change the bot's selection.
status: open
observed_at: '2026-09-12T20:00:00Z'
```

Replace example values with actual evidence. The result says whether this version
still needs routing. Re-observing the same condition updates its date without treating
it as a new problem. Before native delivery, `notify: true` stays pending for recovery.
After confirmed delivery, submit the same finding with `routed: {evidence: [...]}`.
The acknowledgement must match the currently recorded finding version. If another
run has already recorded newer content, preserve it and reconcile the older delivery;
do not overwrite the new finding or claim it was routed. Record a finding before sending
it so the later acknowledgement has a concrete version to match.
Identical later observations remain quiet. New material evidence, a changed next action,
resolution or reopening is a meaningful update; route it once and record delivery.
Do not use a changed run timestamp as new evidence merely to generate another alert.

The daily entry handles the finding under existing user policy or asks one concrete
decision with useful options. It may route authorized work to a configured developer
bot; such a bot is optional. Kit defects should become suggested Requests with a minimal
reproduction, versions, expected/actual behavior and limits. User-directed local
mitigation is distinct from upstream repair. Ordinary bots cannot acquire the management
history-reading exception by receiving a grooming message.
