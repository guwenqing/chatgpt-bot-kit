## Purpose

Help users teach bots useful procedures and share skills across roles without requiring a closed catalog, hiding installation failures or confusing a saved procedure with its schedule.

## ADDED Requirements

### Requirement: Starter guidance supports technical and personal roles

The Kit SHALL provide selectable guidance for bot management, development, architecture/review, personal to-do facilitation and Claude handoff. Bot purpose SHALL guide selection; initialization SHALL not create every starter bot. Users SHALL be able to request creation or refinement of a reusable skill through conversation. Repository-specific workflows SHALL remain target choices rather than mandatory starter policy.

#### Scenario: User wants the bot to repeat a useful procedure
- **WHEN** the user asks to save a completed process as a skill
- **THEN** the agent prepares reviewable reusable guidance, chooses its sharing scope with the user and verifies its discovery before calling it installed

### Requirement: Skills accept multiple sources and sharing modes

Skill management SHALL support bundled skills, existing local skills, the user's repositories and third-party repositories. It SHALL support cloning a selected source and copying or symlinking selected skills into shared or per-bot scope. It SHALL preserve explicit user-managed copying/linking outside its bookkeeping system. Source, revision when applicable, destination and sharing behavior SHALL be inspectable. Conflicting names or existing destinations SHALL not be silently overwritten.

#### Scenario: User installs a repository skill for two bots
- **WHEN** the user selects a source skill and shared scope
- **THEN** the selected source is prepared, both recipients are connected through the chosen mode, and the user can tell whether later source edits are shared or require copying again

#### Scenario: User already wrote a local skill
- **WHEN** the user asks to link or copy that skill directly
- **THEN** the Kit supports that path without requiring catalog publication or repository ownership by the Kit

### Requirement: Installation is checked from the recipient

The agent SHALL verify skill discovery from the recipient's actual bot root and report missing dependencies or host limitations. It SHALL distinguish files placed, skill discovered and skill successfully exercised. The default SHALL be to offer a bounded scan and explain findings/coverage when performed; the user chooses remediation. Installation SHALL not imply freedom from third-party risk or authority for the skill to override the user's instructions.

#### Scenario: A linked skill is absent in the current execution context
- **WHEN** files exist but the native discovery surface omits the skill
- **THEN** the agent identifies the affected root/context and required refresh or setup step instead of reporting success from filesystem existence

#### Scenario: The user declines a scan
- **WHEN** the user chooses direct installation without scanning
- **THEN** the requested supported installation proceeds, with scan coverage recorded as not performed and no invented safety guarantee
