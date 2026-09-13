# Run bounded work with local Claude

Use this when the user selected Claude or configured the bot to delegate that work.
Codex remains responsible for the user's goal, relevant context, outcome verification
and result return. This integration does not grant wider authority or install another
provider. Resolve the user's selected local executable; do not substitute a program,
model or provider silently.

## Prepare a concrete work packet

Choose the target directory and applicable bot/target instructions. Read relevant
`AGENTS.md` and nested rules even when the host did not inject them. Include only the
task's necessary context; private histories need their own authority. Resolve conflicts
using actual instruction priority or ask the specific unresolved decision.

Write YAML outside the selected guidance files:

```yaml
schema_version: 1
executable: /absolute/path/to/claude
cwd: /absolute/path/to/bot/work/selected-target
objective: Calculate this invoice and return one plain sentence with its total.
context: 'Two items at USD 3.50 each; no tax. The return address is routing metadata, not a request for another delivery paragraph.'
authority: Calculate only from the supplied text; do not use tools or modify files.
return_to: The actual requesting Codex conversation identity.
rules:
  - path: /absolute/path/to/bot/AGENTS.md
    role: bot
  - path: /absolute/path/to/bot/work/selected-target/AGENTS.md
    role: target
timeout_ms: 120000
```

These paths and contents are examples. Replace them with the actual selected
executable, directory, work and applicable rules. Add requested `model` and `effort`
only when the user selected them. Add `resume` only for an explicit continuation of
a known Claude session. Make output requirements clear in the objective as well as
the applicable guidance. The caller's `return_to` identifies who receives the answer;
it does not itself send a native message.

```sh
bot-kit claude-run --config /absolute/path/to/work-packet.yaml
```

The utility checks the selected program's version, help and authentication status.
It only accepts an explicit authenticated result and never prints raw authentication
output or starts login. Missing prerequisites yield `unavailable`; explain the actual
local setup choice without changing accounts, billing or installing software unless
the user requests that work.

The observed help must support print, JSON output and appended guidance plus any
requested model/effort/resume flag. Effort must match an observed supported choice.
A model flag accepts the requested name exactly; that does not establish provider
entitlement or successful model selection. Unsupported settings remain explicit.
When values are omitted, the selected provider's existing settings apply.

## Know what execution proves

The bridge uses argument arrays and the selected working directory. It appends the
explicitly supplied bot and target guidance through `--append-system-prompt` and
records rule paths and hashes. It preserves user `CLAUDE.md`, setting sources,
permissions, hooks and provider configuration. This is a deliberate adaptation,
not an assumption that Claude automatically discovers Codex `AGENTS.md`. Selecting
a directory/program remains meaningful: normal provider customizations can run.
The bridge is not a sandbox and does not impose this Kit repository's Astra policy
or AssuredLoop workflow on the user's targets.

Only one execution is attempted. Process time defaults to two minutes and can be
selected from 10 to 600000 milliseconds; output is bounded. Timeout terminates the
direct child with SIGKILL, without promising descendant cleanup or rollback of edits.
This does not supply a graceful live-session cancellation API. Do not claim Ctrl-C,
provider background agents or cancellation of other active sessions has been tested
merely because the bounded child timeout works. Use a supported native cancellation
only within the actual caller's request and report remaining effects.

The JSON response retains `return_to`, observed version/process status, requested
settings, rule adaptation, usable result text and an actual `session_id` when returned.
It reports `completed` only for a recognized successful final result and successful
process exit. `outcome_verified: false` remains explicit: the calling bot must inspect
the result/artifacts against the user's requested outcome. Correct arithmetic with
the wrong requested format, for example, is only a partial task result. Return that
truthfully and make an authorized correction rather than calling it fully accepted.

`failed` includes structured errors, nonzero status, malformed/missing final output,
timeout or output limits. Keep useful partial text and sanitized execution diagnostics;
raw auth output is never included. Redaction covers known secret environment values
and recognizable tokens, not every possible secret. Inspect retained results before
publishing them. The command exits 0 only for `completed`, otherwise 1. Input validation
errors use the CLI's normal error result. No process code alone proves task success.

## Return results and handle continuity

After independently checking the assigned outcome, return the useful result and its
limits to the named origin, through native task messaging when it is another task.
Follow the coordination guide if present, or discover the actual host's supported
messaging interface and confirm delivery. A local bridge receipt is not a sent message.
Keep a single owner for result routing and preserve artifacts the user can inspect.

For authorized continuation, use the actual prior session ID in `resume` and the next
bounded request. The bridge passes it once to the same chosen executor/settings.
A session ID alone proves no continuity. Verify the returned ID and result; a refusal
or failed continuation stays failed. Preserve it and ask the specific recovery choice
if no existing user instruction covers a retry, new session or setting change.
Do not repeatedly rephrase requests to bypass a provider refusal.

The local acceptance trial on Claude Code 2.1.263 observed a successful same-session
revision after an initial answer included an unwanted extra paragraph. Earlier
research had recorded provider refusals on other continuation trials. Both observations
remain valid within their scopes; this release does not guarantee every resume works.
See the official [programmatic usage guide](https://code.claude.com/docs/en/headless)
and inspect the installed CLI's current help before selecting its supported behavior.
