---
name: assuredloop-plan
description: Develop an agreed OpenSpec change and linked work decomposition through a continuous planning task and explicit implementation handoff.
---

# Plan and decompose work

Consumer: guwenqing/chatgpt-bot-kit. Product context: openspec. Framework: assuredloop-base@0.1.0.

Resolve the selected installation through the package README. Read the source request, triage rationale, existing planning ownership, current consumer Specs/active changes and owner decisions. Use contracts/work-intake-and-planning/spec.md, contracts/specification-baseline/spec.md, contracts/review-and-validation/spec.md and contracts/github-work-traceability/spec.md, with templates/README.md.

Authoritative entry in that installation: contracts/work-intake-and-planning/spec.md. Shared record/format instructions are in templates/README.md.

Use Architecture Task/plan under the category/activity contract in templates/README.md. The parent Epic remains a non-executable container; implementation and standalone review use their own compatible categories/activities.

## Develop one coherent plan

Use native OpenSpec exploration, status/instructions and Proposal/Spec/Design/task operations where they already fit. Do not fork its parser or create another requirements database. Reuse an applicable active change; later work must not edit archived plans merely to register a new ticket.

Keep the parent Epic's overall delivery distinct from the planning Architecture Task. The planning Architecture Task normally covers continuing exploration, Proposal, Specs, Design, decomposition and handoff, even across several PRs or review rounds. Proposal merge alone does not finish it while Design or handoff is still owed. Split only for a meaningful independently assignable outcome or responsibility, with a recorded rationale.

State the accepted outcome, constraints and deferred work. Keep goals, capabilities and concrete behavior readable through native requirements/scenarios and ordinary references; do not invent a layer engine. Review Proposal commitments against Specs, and Specs against Design/tasks for omissions, contradictions and unsupported additions. New or materially changed Proposals need the required human acceptance before their changes merge; file existence and structural validation are not that acceptance.

When development brings an active-plan addition, assess it against the accepted outcome, reconcile affected artifacts and refs, and return material scope changes to the actual decision owner. Do not reopen completed planning for routine implementation, or hide an expansion in another Issue.

## Decompose and deliver the handoff

Use native numbered tasks.md checkboxes for stable contribution scope and verification obligations. Connect each item or unambiguous package heading to a real scoped Issue. Use templates/work-issue.md for ownership, current readiness, dependencies, immutable requirement/decision basis and numbered plan refs. Several checklist steps may belong to one Issue; the work record references their authoritative body rather than copying it.

Implementation is separately assignable from planning. Define developer outcomes, review/test obligations and meaningful prerequisite delivery. Assign aggregate acceptance, current-Spec synchronization and final closeout to the responsible change owner, with independent acceptance review. A dependency must be delivered before execution, but its incompleteness does not prevent recording planned work.

Use native parent/sub-issue associations for ownership relationships. Add depends_on only for an established execution prerequisite, not automatically for a parent or handoff owner. A research child contributing to unfinished planning must not be blocked on that parent's final completion merely because it is a child. Reconcile the new work's actual plan-item mapping before final handoff rather than copying the parent's entire assignment or inventing a future revision.

Run native strict validation and applicable link/artifact checks. Obtain independent full-scope review under the accepted policy, including the task-to-Issue map, coverage, dependency cycles, owner/readiness clarity and scope boundaries. Use templates/work-pr.md and review-request.md; dispose findings and refresh stale context before authorized delivery.

A reviewed, accepted planning handoff can complete the planning Architecture Task. Leave the parent open for implementation and closeout. Checked candidate contributions do not predeclare their own merge, Issue closure or overall acceptance. Send the next owner the fixed plan/basis, ordered or dependency-scoped assignment, actual readiness and pending decisions.
