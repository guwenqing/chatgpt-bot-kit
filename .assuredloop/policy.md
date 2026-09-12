# ChatGPT Bot Kit workflow policy

This is the proposed consumer policy for `guwenqing/chatgpt-bot-kit`. It becomes
effective only after the owner accepts its fixed revision and the accepted
activation checkpoint is delivered. Its scope is this repository, for all future
traced work until the owner approves a governed replacement. It does not change
global instructions, other repositories or scheduled jobs.

## Rules proposed for acceptance

1. Use native OpenSpec for formal proposals, requirements, design, tasks and
   specification synchronization. Keep the project's product requirements in
   `openspec/`; read AssuredLoop's framework contracts from its selected package.
   Do not copy the framework's product specifications into this product's baseline.
2. Use GitHub Issues and PRs for requests, assignments, progress, findings and
   delivery evidence. Use the six distinct `type:request`, `type:epic`,
   `type:architecture-task`, `type:task`, `type:bug` and `type:spike` labels and
   their packaged activity mappings. Preserve original requests. Keep formal
   planning separately assignable from implementation; use an Epic only when
   the work needs a container. Link executable work to its actual requirement,
   decision and native task references, or justify a real no-spec boundary.
3. Obtain human acceptance for a new or materially changed proposal. Work within
   accepted scope may proceed through its applicable checks and independent
   review without a new approval merely because it is another PR. Scope changes
   return to the owner. Merge authority comes from the actual work authorization,
   not from a passing tool result.
4. Require internal review by a different agent/session using `gpt-6-astra`,
   with `full-scope` depth. Review the original basis, actual revision, completeness,
   correctness, coherence, relevant negative cases and cross-contract impacts.
   Use xhigh for difficult or ambiguous work and high for routine implementation
   and review. A producer cannot accept its own output. No additional model aliases
   or exclusions are needed with this single-model allowlist. Reviewer packets
   have a 65536-byte inline budget; missing context remains a visible obligation.
5. New executable behavior requires applicable tests authored independently of
   the implementation, a genuine failing run before implementation, a passing
   rerun and relevant controlled-fault evidence. Configuration and documentation
   changes use applicable artifact validation and independent semantic review;
   do not invent test-first evidence. Run only the checks the scope needs.
6. Resolve policy for each PR from its actual destination's pre-change revision.
   Record the examined head, destination/base, policy and package binding and
   applicable digests. Renew affected checks and review when these inputs change.
   Candidate policy changes cannot authorize themselves. Missing or invalid
   evidence remains incomplete, and a suspended activation cannot fall back to
   permissive bootstrap.
7. Use the packaged adoption, triage, planning, research, delivery, review and
   closeout guidance for explicitly assigned work. Check applicable records with
   the selected CLI and assess their meaning independently. Record actual checks,
   review outcomes, merges and delivery on GitHub. Follow through authorized
   delivery and closeout; file existence, checked tasks and closed Issues alone
   do not prove acceptance.
8. Select `assuredloop-base@0.1.0` from source commit
   `7343ffc7518200ce80437a9c914448dd6f176a35`, with OpenSpec `1.12.0`.
   This is an explicitly selected local build, not a new registry release.
   Bind the package to the actual npm tarball integrity in the consumer config
   and canonical contract source in `contracts/metadata.json`. npm links remain
   the development installation method. Before formal assessment, compare a fresh
   package's integrity and dependency versions/lock against the accepted selection.
   If the linked source changes, treat that as an unaccepted runtime until a
   governed rebind is reviewed and authorized; never silently reuse the old SRI.
9. Start with explicit local/native checks and manual review dispatch. Automatic
   CI, branch protection, external-review providers and agent scheduling require
   separate scoped work. This policy adds no mandatory external model/provider.
   Restrict acquired work references to this repository; verified installed
   framework contracts remain readable through their exact package binding.
10. Deliver reviewed, owner-accepted bootstrap configuration in `main` before
    preparing the later activation assessment. Activation must cite the accepted
    policy, package, usable-base checks, independent review and real owner
    authorization. The owner may authorize this ordered delivery in one decision
    after reviewing the concrete policy and bootstrap candidate. Later changes
    to workflow instructions, configuration, templates, tests or validators use
    the same active process. Activation does not claim a completed post-activation
    self-change demonstration or acceptance of a new framework release.

## Authority and sources

The authoritative reusable behavior and record shapes are those shipped in the
selected package's `contracts/` and `schemas/workflow.schema.json`. This document
records consumer choices and the concrete acceptance scope. Current user and
repository instructions continue to apply. The source project's historical
consumer approvals and external-review arrangements are not this project's
authorization.
