---
name: assuredloop-adopt
description: Adopt the pinned AssuredLoop package in an explicitly selected repository with previewed configuration and native tool discovery.
---

# Adopt AssuredLoop

Start from the intended consumer repository and an explicitly selected installed package. This guidance does not select a repository from the framework's own source history. `guwenqing/chatgpt-bot-kit` is the target repository; `openspec` is its native specification context. The installed framework package is `assuredloop-base` at `0.1.0`.

## Prepare the binding

Read the selected installation's `schemas/workflow.schema.json` (`config` and `contractPackage`) and `templates/records/config.json`. Examples are illustrative, not accepted policy. Set the consumer's GitHub identity, repository-relative OpenSpec root, selected native tool IDs and labels. Set explicit review eligibility/exclusions and the workflow package version, installation integrity and immutable source reference. Resolve framework rules from the installation's `contracts/metadata.json` and generated files; resolve product requirements from the consumer's own OpenSpec context. Never copy the framework's Specs into the consumer baseline.

Use the existing OpenSpec initialization when native context or integrations are missing. AssuredLoop supplements it and does not run prerequisite installers, log in to accounts or modify upstream Skills. Prerequisites are Node.js >=20.19.0, Git, pinned OpenSpec 1.12.0 and, for GitHub checks, authenticated gh >=2.88.0 with access to the bound repository. Different native tools select different roots; incompatible registry versions/shapes and unresolved shared-root ownership are reported rather than guessed.

Before routed work, the adopting owner or explicitly authorized agent must provision missing configured category labels or confirm mappings to existing labels. Supply all six distinct mappings under the category/activity contract in templates/README.md, including Architecture Task for planning/closeout. Assigned adoption uses Task/adopt. Legacy discipline configuration is invalid; use templates/category-migration.md for a separately authorized migration, preserving current records and historical evidence. Initialization only reports label prerequisites. It does not create labels or claim that a syntactically valid owner/review declaration proves acceptance.

## Preview, apply and verify

Save the agreed configuration to an explicitly named JSON input file. From the pinned installation, run:

```text
assuredloop init --target /absolute/consumer/root --config /absolute/config.json
```

Inspect the proposed file list and diagnostics. The default is read-only preview. Use `--local-only` when remote access is intentionally unavailable; it reports skipped GitHub checks and cannot establish complete pre-merge validation. Resolve invalid bindings, package-version mismatches, unknown tools and file/co-tenancy conflicts before applying. Preserve user files and upstream `.openspec-target` ownership markers; do not remove conflicting files to force success.

After the preview matches the authorized adoption scope, repeat with `--apply`. Only the target `.assuredloop/config.json` and namespaced AssuredLoop discovery assets are eligible. Verify a repeat preview is unchanged, native/user Skills and product Specs are preserved, required installation bindings are resolved, and the target configuration points to the intended package. Explicitly declared reusable examples may retain later-work tokens; see the selected package's README section on authoring reusable Skill examples for the marker convention and its limits. Actual target configuration is never exempted. Installed copies are generated from this packaged source; change the source through governed work rather than editing discovery copies independently.

Record the actual command, result, selected package/version and limitations in the adoption work record. Obtain the applicable independent review and policy acceptance before treating adoption as accepted. A successful init does not activate the workflow. Establish accepted bootstrap/configuration in the destination before any later activation assessment; missing policy remains unavailable and a candidate cannot authorize itself. Escalate policy/scope questions to the responsible work owner.

The package README indexes the work-category guidance and templates/README.md explains completing records from the shared schema. Optional agent-instruction pointers may be adapted only within explicitly authorized adoption scope; preserve existing consumer instructions and do not install a permanent author-session route. Initialization itself writes only its documented configuration and namespaced discovery assets.

Use inspect/check only when the selected version actually supplies them; otherwise report their absence and follow the explicitly permitted native/manual checks without claiming a complete automated assessment. Automatic CI, provider orchestration and registry publication are separate authorized work.
