## Why

People can already work with Codex locally, but creating a persistent team of useful bots requires them to assemble projects, guidance, skills, conversations and recurring work themselves. Bot Kit makes that setup and daily coordination understandable through conversation, including for people who do not write code.

This proposal addresses [Request #9](https://github.com/guwenqing/chatgpt-bot-kit/issues/9) through [Epic #11](https://github.com/guwenqing/chatgpt-bot-kit/issues/11) and [planning #12](https://github.com/guwenqing/chatgpt-bot-kit/issues/12). [Reviewed research R1–R7](https://github.com/guwenqing/chatgpt-bot-kit/issues/10#issuecomment-5647836285) supplies capability evidence and Grok Bot user-journey inputs. This is a proposed first release; acceptance and delivery are recorded separately on GitHub.

## What Changes

- Provide a local npm utility and conversational skills. A single copy-paste setup instruction prepares only Bot Father, verifies its native Codex project and daily conversation, and leaves a clear, resumable handoff when a native step cannot be completed automatically.
- Create and modify persistent bots with their own workspaces, selected skills and shared `AGENTS.md`. Use YAML for Kit configuration and user custom rules. Preserve direct user edits and distinguish bot-wide rules from each conversation's prompt, model and effort.
- Support migration whenever a bot is created: inherit an existing conversation when verified, otherwise transfer useful work context; clone or copy working files without silently losing dirty or untracked work. Different bots normally have separate clones; conversations of the same bot share its workspace.
- Maintain Bot Father's directory for discovering bots and conversation responsibilities. Support native collaboration and configuration notifications, with clear queued/active/needs-input/result states and truthful limitations. Ordinary memory writes remain quiet. History access follows the owner's explicit Bot Father/grooming exception.
- Offer shared or per-bot skills from bundled, local and repository sources, including direct copy/link paths. Initial guidance covers management, development, architecture/review, personal facilitation and a Claude executor. Only the requested bots are created.
- Guide optional creation of a separate grooming conversation and native schedule. Findings return to Bot Father's daily entry; existing user rules determine handling, otherwise it asks a concrete question. Kit defects lead to a suggested Issue/Request and user-directed local mitigation.
- Provide bounded Claude handoff with explicit context/rules, selectable supported settings and truthful results/errors. Failed continuation never becomes a silent fresh session or model substitution.
- Make the Grok-inspired user experience verifiable: onboarding to a useful task, lasting roles, discoverable collaboration, visible progress, reusable skills, routines, openable/editable results and recovery. [Design](design.md) maps U1–U11 to native requirements and delivery tasks.

Proposed defaults are **guided optional grooming**, **offer a skill scan**, and **queue ordinary collaboration** when the connected host supports a verified queue. These close the corresponding open product choices for owner review; they are not implied by the earlier research approval.

## Capabilities

### New Capabilities

- `conversational-onboarding`: novice setup, native desktop readiness, resumable progress, understandable results and recovery.
- `bot-workspaces-and-guidance`: bot identity, shared workspaces, YAML composition, target rules, explicit local memory and preserved customizations.
- `bot-management-and-migration`: directory, conversation lifecycle/settings and creation-time work inheritance.
- `skill-assembly`: purpose-based starter guidance, local/repository sources, sharing, copy/link and recipient discovery.
- `bot-coordination`: destination selection, native message semantics, access boundaries and configuration notices.
- `grooming-and-routines`: separate routine conversations, native schedule verification, bookkeeping and actionable feedback.
- `claude-handoff`: bounded local executor integration, rule adaptation, provider choices, result/error and continuation handling.

### Modified Capabilities

None. The current product baseline is empty.

## Impact

Add the Kit CLI, shared skills/templates, tests and user documentation to this repository. Keep native Codex responsible for projects, conversations, execution, permissions and schedules. Native integration must be detected on the actual host; a disposable App Server is not the desktop's active session connection. Deliver and test locally on the current macOS host first, recording versions and supported operations; compatibility with other hosts is not presumed.

The first-release artifact is locally installable/linkable npm content with a pack/install smoke check. Registry publication is separate. No cloud execution, panel discussion, custom scheduler/chat service, new dashboard, mandatory marketplace, enforced per-bot security sandbox or global bot discovery is included. Target repositories keep their own rules; users do not inherit this development repository's AssuredLoop or Astra policy.
