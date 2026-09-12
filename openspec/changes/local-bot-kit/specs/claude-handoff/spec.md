## Purpose

Allow a Codex-facing bot to use a locally available Claude executor for bounded work while retaining explicit user choices, applicable project guidance and truthful success, failure and continuation results.

## ADDED Requirements

### Requirement: Claude integration is explicit and locally prepared

The Kit SHALL provide conversational guidance and a bounded handoff path to a user-selected local Claude integration. Setup SHALL check the required executable, authentication availability and supported settings without publishing credentials. It SHALL preserve the user's provider/model choices and map effort only when the target supports a meaningful setting. Missing prerequisites or unsupported values SHALL produce a specific setup choice, not silent substitution or a new account/billing action.

#### Scenario: Claude is unavailable or unauthenticated
- **WHEN** the user requests Claude work
- **THEN** the bot explains the missing prerequisite and supported setup/handoff step without claiming execution began

### Requirement: Handoff carries work context and applicable rules

The handoff SHALL identify the objective, selected working directory, relevant files/context, return destination and actual authorization. Applicable bot and target-project guidance SHALL be supplied through a deliberate supported adaptation; the Kit SHALL not assume Claude automatically reads `AGENTS.md`. User-owned executor configuration SHALL be preserved, and the resulting execution scope SHALL remain within the user's requested work.

#### Scenario: A target has both bot and project instructions
- **WHEN** work is delegated to Claude
- **THEN** the handoff includes their relevant guidance through a verified method and records that method without overwriting existing user guidance

### Requirement: Results and continuation reflect actual execution

The bridge SHALL interpret process status and structured error flags as well as result content. It SHALL return usable output, partial results, actual failure and relevant execution identifiers without treating an identifier as proof of continuity. Resume SHALL be attempted only through supported behavior with a known session; failure SHALL remain failure. A fresh handoff, retry or model change SHALL require the applicable user choice or existing authorization. Cancellation support and remaining side effects SHALL be reported truthfully.

#### Scenario: A result says success but also contains an error
- **WHEN** a response contains a success subtype alongside an error flag or nonzero exit
- **THEN** the bot reports the actual error and any partial outcome, without marking the task or continuation complete

#### Scenario: A user asks to continue prior Claude work
- **WHEN** the selected provider rejects the resume
- **THEN** the bot preserves that failure and offers an explicit recovery choice without silently starting a new conversation

#### Scenario: An ordinary bounded call succeeds
- **WHEN** execution returns a successful process status, no error flag and a result meeting the assigned outcome
- **THEN** the bot returns the result to the named origin with its evidence and any relevant limits
