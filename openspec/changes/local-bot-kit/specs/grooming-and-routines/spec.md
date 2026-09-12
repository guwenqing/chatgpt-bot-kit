## Purpose

Help users make bot care and other suitable work recurring through native local scheduling, with a clear owner, verifiable results and an understandable place to handle findings.

## ADDED Requirements

### Requirement: Grooming has a separate optional conversation

The Kit SHALL guide the user to optional grooming setup after establishing Bot Father's daily entry. Grooming SHALL use an additional persistent conversation, with its own startup prompt and user-selected supported model/effort. A daily cadence SHALL be offered, not silently enabled during initial setup. Other routine requests SHALL likewise identify their responsible bot/conversation and expected outcome.

#### Scenario: User asks for daily grooming
- **WHEN** the user selects model, effort and cadence or accepts offered values
- **THEN** management prepares the separate conversation in Bot Father's shared workspace and connects the user's native routine request to that conversation

### Requirement: Native routine setup is inspectable and verified

The agent SHALL use native local scheduling and show the responsible conversation, prompt, cadence, actual model/effort behavior and how to inspect, edit or pause the routine. It SHALL distinguish schedule configuration from an observed successful firing and result return. It SHALL describe actual app/computer availability limits, missed-run and overlap behavior without promising unsupported guarantees. Repeated setup SHALL reconcile the existing routine rather than create duplicates.

#### Scenario: Schedule configuration succeeds before its first run
- **WHEN** the native tool accepts and persists a schedule
- **THEN** the agent reports configured status and identifies first-run verification as pending rather than claiming the routine already worked

#### Scenario: The first grooming run is assessed
- **WHEN** the scheduled conversation actually runs
- **THEN** acceptance checks its identity, effective supported model/effort, execution result and return to the daily conversation using native evidence

#### Scenario: The computer is unavailable or a run fails
- **WHEN** the native system reports a missed, unavailable or failed execution
- **THEN** the agent reports that state and supported recovery without inventing a background cloud service or guaranteed catch-up

### Requirement: Grooming maintains useful findings and bookkeeping

Grooming SHALL learn managed bot responsibilities, gather suggestions, notice difficulties and refresh relevant directory summaries using permitted history inspection or direct inquiry. Its default SHALL be to route actionable findings to Bot Father's daily conversation. Findings SHALL identify the affected bot, evidence, proposed next action and status. Repeated unchanged findings SHALL remain tracked without a fresh daily notification for the same unresolved condition.

#### Scenario: A bot repeatedly struggles with one skill
- **WHEN** the same unresolved condition appears on another grooming run
- **THEN** grooming updates the existing finding with materially new evidence if any and avoids presenting it as a new problem each day

### Requirement: Handling follows user choices and useful feedback

Bot Father's daily conversation SHALL apply existing user routing/repair policies; when none resolves the action it SHALL ask the user a concrete question about the finding. For Kit defects it SHALL recommend an Issue/Request with relevant reproduction evidence and limits, without automatically publishing or assuming upstream developer authority. User-directed local mitigation SHALL remain available. Bot-wide and session-specific customization SHALL both be able to refine these defaults within actual host permissions.

#### Scenario: No developer bot or repair policy exists
- **WHEN** grooming finds a user-side problem
- **THEN** the daily conversation explains the finding and options and asks the needed decision, without requiring creation of a developer bot

#### Scenario: A Kit defect has a local workaround
- **WHEN** the user chooses that mitigation and authorizes an upstream report
- **THEN** the agent applies the scoped workaround and publishes the requested report with relevant evidence, keeping local mitigation and upstream resolution distinct
