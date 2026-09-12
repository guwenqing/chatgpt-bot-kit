## Purpose

Enable bots to obtain help through the native conversation system while keeping ownership, progress, privacy expectations and configuration changes understandable to the user.

## ADDED Requirements

### Requirement: Collaboration chooses a responsible conversation

Bots SHALL be allowed to seek help from managed bots by default within the user's task authority. A sender SHALL use the directory to select an appropriate conversation by responsibility, falling back to that bot's daily conversation when no more specific suitable conversation is known. A handoff SHALL identify the objective, useful context, requesting sender, return destination and applicable authorization. Ordinary help SHALL reuse a suitable conversation; new specialized conversations SHALL follow a specific user request or established user policy.

#### Scenario: Help returns asynchronously
- **WHEN** a bot sends a bounded request to a suitable collaborator
- **THEN** the sender can identify the actual destination and delivery state, and the collaborator returns its result or blocking question to the specified origin without making the user relay the messages

#### Scenario: A collaborator proposes broader work
- **WHEN** the proposal exceeds the original user authority
- **THEN** it returns that decision to the responsible user-facing conversation rather than treating another bot's message as new user authorization

### Requirement: Queue steering and cancellation have distinct meanings

The sender SHALL account for recipient activity using the connected host's actual state. Ordinary help SHALL default to a verified native queue when the recipient is busy. Steering SHALL be reserved for information that should change current work; cancellation SHALL be an explicit stop request with a stated reason and SHALL not imply rollback. When a mode or state cannot be established on the actual host, the agent SHALL explain that limitation and arrange a supported handoff without claiming the unavailable semantics. Retries SHALL check uncertain delivery and avoid duplicate submissions or repeated result routing.

#### Scenario: An ordinary request reaches a busy conversation
- **WHEN** the connected native host supports verified queuing
- **THEN** the request waits for later execution and the sender distinguishes queued acceptance from an actual answer

#### Scenario: A steering request races with a turn change
- **WHEN** the expected active turn no longer matches
- **THEN** the sender refreshes the actual state and re-evaluates delivery rather than steering an arbitrary later turn

#### Scenario: Only a separate unloaded process is available
- **WHEN** that process cannot observe the desktop recipient's active turn
- **THEN** the agent reports activity as unknown rather than idle and does not start a competing execution to simulate communication

### Requirement: History access respects the management exception

Ordinary bots SHALL not read other conversations' histories without user authorization. Directory visibility and permission to contact a bot SHALL not grant that history access. Bot Father and its designated grooming conversation SHALL be allowed to inspect managed bot histories and ask those bots directly within their management role. They SHALL not extend that exception to unrelated conversations or relay private history merely because they can read it. These are behavior rules under the actual shared host permissions.

#### Scenario: An ordinary bot needs more context
- **WHEN** the directory and work packet are insufficient
- **THEN** it asks the collaborator or user for relevant context instead of opening another conversation's private history without authorization

#### Scenario: Grooming investigates a struggling managed bot
- **WHEN** inspection is relevant to its management duties
- **THEN** it can read the managed bot's conversation or ask it directly, while limiting any report to relevant findings

### Requirement: Configuration changes notify affected conversations

Accepted configuration changes SHALL include notification to affected conversations by default, including across bots when shared guidance or skills change. The notification SHALL explain the changed behavior and where it is recorded. The Kit SHALL distinguish configuration written, notification pending/sent and acknowledged or verified adoption. It SHALL not force a running task to abandon its work or claim automatic context refresh. Failed notifications SHALL remain visible and recoverable without broadcasting unrelated ordinary memory updates.

#### Scenario: A shared rule changes
- **WHEN** the user changes guidance used by multiple bots
- **THEN** the agent identifies affected conversations, sends or queues supported notices and reports unresolved delivery/adoption separately

#### Scenario: A bot remembers a new preference without changing configuration
- **WHEN** the update is only an ordinary shared-memory entry
- **THEN** the Kit does not notify all conversations unless the user requested notification
