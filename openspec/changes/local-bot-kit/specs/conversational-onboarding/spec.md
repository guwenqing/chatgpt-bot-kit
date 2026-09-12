## Purpose

Help a person who does not write code reach a useful local bot through conversation, understand progress and recover from incomplete setup. This capability supports the usable first-task outcome in the change Proposal.

## ADDED Requirements

### Requirement: One conversational entry reaches a daily bot

The Kit SHALL provide one copy-paste onboarding instruction and agent-readable setup guidance. Setup SHALL explain missing local prerequisites in ordinary language, obtain missing user choices, prepare the selected workspace and create only Bot Father. It SHALL guide the user into Bot Father's daily Codex conversation and offer a useful first task or creation of another bot. It SHALL NOT require the user to author YAML or learn the CLI before using that entry.

#### Scenario: Local assistant completes setup
- **WHEN** the entry assistant has the required local and native Codex capabilities
- **THEN** it prepares Bot Father, verifies the project and daily conversation, and gives the user an actionable way to enter that conversation
- **AND** no developer, reviewer, personal assistant or grooming schedule is created without the corresponding user choice

#### Scenario: Entry assistant cannot operate this computer
- **WHEN** the instruction is pasted into an assistant without local execution or the necessary native surface
- **THEN** it supplies an understandable handoff to a capable local Codex conversation and the remaining setup step, without claiming setup ran

### Requirement: Setup completion follows observed native readiness

The Kit SHALL distinguish prepared files, registered native project, reachable daily conversation and any incomplete host step. Every bot root SHALL be used as its own local Codex project. Setup SHALL claim a usable bot only after the intended desktop project and daily conversation are verified through the relevant native surface or explicit user observation. It SHALL preserve progress and guide the missing native step when automatic registration is unavailable. A backend identifier or directory alone SHALL NOT establish visible desktop readiness.

#### Scenario: Backend and desktop disagree
- **WHEN** a native metadata write succeeds but the desktop surface does not show the intended association
- **THEN** setup reports the association as unconfirmed, retains completed preparation and asks for or guides the specific desktop verification

#### Scenario: Setup is repeated after interruption
- **WHEN** the user reruns setup for the same workspace
- **THEN** it identifies prior Kit-owned results, resumes incomplete steps and avoids duplicate bots, projects, daily conversations or routines
- **AND** conflicting existing files or ambiguous native matches are reported before replacement or duplicate creation

### Requirement: Daily work has understandable progress and results

The conversational guidance SHALL distinguish lasting bot responsibilities from an individual work request. It SHALL provide meaningful progress when needed and identify actionable questions, failure and delivered results from actual evidence. It SHALL return openable artifacts or findings with their location and next action, and support revising the existing result. It SHALL NOT require repeated user continuation messages for already authorized work or claim a live state that the host cannot establish.

#### Scenario: A nontechnical user gives a first task
- **WHEN** the user asks a personal assistant to organize a short list of to-dos
- **THEN** the bot works within its configured responsibility, asks only material missing questions and returns a readable, editable result that the user can open from the conversation

#### Scenario: Work needs attention rather than more time
- **WHEN** work is waiting for user input, another bot, native availability or a failed provider call
- **THEN** the bot states the observed condition and smallest useful next action instead of presenting indefinite unexplained thinking as successful progress

### Requirement: Recovery preserves completed work

Failed setup or operation SHALL identify what succeeded, what failed and what can be resumed. The Kit SHALL preserve user files and native work already created, avoiding blind retries after uncertain side effects. Local execution and app/computer availability limits SHALL be visible. The first release SHALL document and test its actual supported local host and package installation path without claiming universal host support or registry publication.

#### Scenario: Native creation times out after possible success
- **WHEN** creation has an uncertain result
- **THEN** recovery checks for the intended resource or reports unresolved identity before another creation attempt

#### Scenario: A fresh local installation is evaluated
- **WHEN** the release candidate is packed and installed into a clean local fixture
- **THEN** its entry guidance and assets are available without this repository's development checkout, and supported-host setup is verified separately from package installation
