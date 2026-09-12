---
name: assuredloop-triage
description: Triage a captured request into justified planning, research or assigned work while preserving its original scope and evidence.
---

# Triage a request

Consumer: guwenqing/chatgpt-bot-kit. Product context: openspec. Framework: assuredloop-base@0.1.0.

Resolve the selected installation and consumer context using the package README. Read the originating request and current owner instructions, relevant consumer Specs/active changes/prior delivery, the framework work-intake-and-planning and github-work-traceability contracts, and templates/README.md. Do not substitute the framework's own history for the consumer's work.

Authoritative entry in that installation: contracts/work-intake-and-planning/spec.md. Shared record/format instructions are in templates/README.md.

## Establish context and route

1. Preserve the original request. Separate confirmed facts, assumptions and unresolved questions. Find the responsible owner and any existing work before opening a duplicate.
2. An incomplete request may remain a rough Request without a fabricated Workflow context. Ask for the specific missing decision or propose bounded research; a label or activity selector grants no implementation authority.
3. For work that implements or restores an accepted requirement without changing constraints or material design decisions, route to a bounded Task/Bug. Reference that exact basis and relevant prior delivery. An active change is not required for a legitimate follow-up; do not create one merely to fill a field.
4. For a claimed no-Spec case, actually inspect applicable current requirements and prior work. Record a nonempty no_spec_reason only when the absence is justified. An empty basis alone, a small diff or untouched Spec files does not establish an exemption. If the request changes an existing guarantee, return it to planning even when the patch would be one line.
5. New or materially changed agreement goes to separately owned formal planning. A clear but oversized goal normally needs a bounded Spike to recommend decomposition; explain any alternative. Research does not automatically create the recommended requests.
6. Additions to an active change go to its responsible planning owner for scope/impact assessment and plan reconciliation. Necessary bounded refinements can remain inside the accepted outcome; material expansion needs the actual owner/human decision. Do not create a ticket to silently enlarge the agreement.

Use the consumer's configured category labels and the category/activity contract in templates/README.md. Request/triage describes intake; Architecture Task/plan describes formal planning, Task/deliver implementation, Bug/deliver restoration, and Spike/research uncertainty reduction. Epic is a container with no executable activity. JSON activity selects guidance; labels describe the work, not a job title. Missing label provisioning returns to the adopting owner or authorized agent; do not silently change GitHub settings.

## Record and hand off

Use templates/work-issue.md and the appropriate schema/record example to enrich routed work. Keep task definitions in native planning artifacts and assignment/progress in GitHub. Supply resolvable requirement/decision refs and plan items when applicable, dependencies, intended outcome, discoverable responsibility, verification obligations and route rationale. Do not duplicate the full formal task body.

Check the completed record's shape, required source bindings and references, then obtain the applicable independent assessment of the route and exemption claims. Report unavailable tools/evidence explicitly. Hand the next owner the original context, chosen route and unresolved decisions. Stop at this triage outcome unless implementation or further planning is separately assigned.
