## Purpose

Give each persistent bot a stable work area and understandable rules while preserving user control and the instructions of its target projects. This supports role continuity across multiple daily and specialized conversations.

## ADDED Requirements

### Requirement: The bot owns the shared workspace

Each bot SHALL have a stable root under the user's selected workspace by default. Its conversations SHALL share that root and its working files; they SHALL NOT automatically receive separate worktrees or clones. Different bots working on one project SHALL normally use separate clones within their respective workspaces. A bot SHALL be able to use multiple working copies when needed. The Kit SHALL leave repository hosting and Git practices to the user.

#### Scenario: Developer and reviewer work on the same project
- **WHEN** the user creates separate developer and reviewer bots for one repository
- **THEN** each bot receives its own working copy by default, while two conversations of the developer share the developer's workspace

#### Scenario: User requests an external directory
- **WHEN** the user chooses direct work in an existing external or non-Git directory
- **THEN** the bot explains the relevant shared-state implications and follows that choice within actual host permissions, without making an internal clone an absolute requirement

### Requirement: YAML configuration preserves user customization

Kit-owned configuration SHALL use YAML, with readable validation errors and no applied changes on invalid or conflicting input. Bot-wide default guidance and user rules SHALL compose into `AGENTS.md`. Conversation-specific startup prompts SHALL remain separately configurable. Users SHALL be able to customize guidance directly; regeneration and upgrades SHALL preserve their changes or expose a resolvable conflict rather than silently overwrite them. Host-native configuration and skill file formats SHALL remain native.

#### Scenario: A user sets a general preference and a grooming-only rule
- **WHEN** the user asks for one rule on every conversation of a bot and another only during grooming
- **THEN** the first is represented in bot-wide configuration/guidance and the second in grooming's startup prompt, with their different scopes explained

#### Scenario: Generated guidance was edited manually
- **WHEN** the Kit would replace content that changed since its last generation
- **THEN** it preserves the current content and reports the conflict or incorporates an explicitly chosen resolution before writing

#### Scenario: Concurrent configuration edits conflict
- **WHEN** another conversation changes the same configuration during an update
- **THEN** the Kit detects the changed input and reconciles or returns a conflict instead of overwriting the newer edit

### Requirement: Bot rules coexist with target-project rules

Bot guidance SHALL require discovery and observance of the applicable target repository and nested instructions before work there, regardless of automatic host loading. A target checkout SHALL NOT lose its own instructions when brought into a bot workspace. The Kit SHALL distinguish role rules from target constraints and surface unresolved conflicts using the actual instruction hierarchy. It SHALL NOT silently inject this repository's development workflow or model restrictions into consumer projects.

#### Scenario: A conversation starts at the bot root
- **WHEN** it later edits a nested project whose guidance was not included at startup
- **THEN** it reads the target's applicable instructions before the relevant work and retains the bot's responsibility context

### Requirement: Shared local memory is deliberate and quiet

Conversations of one bot SHALL have an explicit workspace-local place to preserve requested memories, decisions and useful work context. An explicit request to remember SHALL produce a durable update. Ordinary memory changes SHALL NOT broadcast to other conversations unless the user requests it. The Kit SHALL distinguish this shared record from provider-generated memory, complete chat history and automatic adoption by a running conversation.

#### Scenario: A daily conversation saves a preference
- **WHEN** the user asks the bot to remember the preference
- **THEN** the shared local record is updated for later use without sending unsolicited messages to every conversation
- **AND** later conversation guidance directs it to consult relevant shared memory rather than assuming instant context synchronization

### Requirement: Guidance does not pretend to enforce tool isolation

The Kit SHALL describe the first release's shared host tool permissions truthfully. Behavioral limits and per-bot file conventions SHALL NOT be advertised as an enforced sandbox. User model and effort selection SHALL use the host's supported choices, independently of this repository's development-only Astra policy.

#### Scenario: A user requests a bot-specific permission guarantee
- **WHEN** the host does not support or has not verified that isolation
- **THEN** the Kit explains the actual shared-permission behavior and does not claim `AGENTS.md` makes unauthorized paths technically inaccessible
