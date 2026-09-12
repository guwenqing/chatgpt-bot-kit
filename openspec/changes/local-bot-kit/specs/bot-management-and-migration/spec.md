## Purpose

Let Bot Father manage a discoverable set of lasting bots and their conversations, including bringing existing work into a newly created bot without confusing role identity with a chat or a target repository.

## ADDED Requirements

### Requirement: Bot Father maintains a useful directory

Bot Father SHALL maintain a readable management directory in its workspace for the bots it manages. It SHALL expose bot responsibilities, workspace locations, relevant configured guidance, default conversations and other conversation duties/settings sufficiently for collaborators to choose a destination. Authoritative configuration and observed summaries SHALL be distinguishable. Regular bookkeeping SHALL refresh stale information without silently changing a user's chosen responsibility or reading unrelated private conversations.

#### Scenario: A collaborator needs an architecture opinion
- **WHEN** it consults the directory and finds a suitable specialized review conversation
- **THEN** it can choose that conversation by its recorded responsibility without reading the chat history to discover its role

#### Scenario: Native conversation identity becomes stale
- **WHEN** a recorded conversation is no longer available or cannot be matched unambiguously
- **THEN** management reports that condition and repairs the record through verified native selection rather than sending work to an arbitrary match

### Requirement: Creation establishes a bot and its conversations

Conversational management SHALL create and modify named bots with a purpose, selected skills, bot-wide guidance and a default daily conversation. Additional conversations SHALL share the bot workspace and support distinct startup prompts, model and effort. Requested native settings SHALL be verified or reported unsupported without silent substitution. Creating a conversation SHALL not be equated with a permanently running OS process.

#### Scenario: User creates a personal assistant
- **WHEN** the user describes its intended help in ordinary language
- **THEN** Bot Father prepares the role and skills, creates or guides its verified native daily entry and explains what to ask it next

#### Scenario: User adds a specialized conversation
- **WHEN** the user asks for a different prompt/model/effort within an existing bot
- **THEN** the new conversation uses that bot's shared workspace and the requested supported settings, without automatically copying the workspace or creating another bot

### Requirement: Migration is available at every bot creation

Creating a bot SHALL allow the user to identify an existing conversation and working environment to inherit. The agent SHALL agree the concrete migration method using that source's state and the user's instructions. Verified native continuation SHALL be preferred when it preserves the intended identity and context; otherwise the agent SHALL explain a fork or explicit context transfer. A configuration-only copy SHALL NOT be presented as history or memory migration.

#### Scenario: Native continuation is not safe for a loaded conversation
- **WHEN** the source is active, loaded in another process or cannot be rebound reliably
- **THEN** the agent avoids competing execution and offers an explicit safe handoff/fork/context-transfer choice without claiming the source was moved

#### Scenario: Only readable conversation content can be transferred
- **WHEN** native resume or fork is unavailable but the user authorizes reading the source
- **THEN** the migration transfers relevant goals, decisions, memories, evidence and unfinished work, identifies omissions and preserves the source

### Requirement: Migration retains the selected working state

Migration SHALL distinguish bot rules from a target project's own files/rules. It SHALL preserve the user-selected work, including uncommitted changes and untracked files, with an inventory and verification appropriate to the source. Clone plus state restoration or whole copying SHALL be available as appropriate. Ignored files, linked worktrees, submodules, symlinks and machine-specific environment state SHALL be considered when present rather than silently discarded or claimed portable. Source files SHALL not be deleted or moved without the user's specific instruction.

#### Scenario: A repository contains unfinished local work
- **WHEN** a clean clone would omit modified, untracked or selected ignored files
- **THEN** the agent restores the selected state or uses a suitable copy, verifies it against the source and reports anything not transferred before declaring the environment ready

#### Scenario: The source cannot be cloned
- **WHEN** the user requests migration from a local non-Git directory or an unavailable remote
- **THEN** an appropriate copy preserves the selected files and rules, with source and destination clearly identified
