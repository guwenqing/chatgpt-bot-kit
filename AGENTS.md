# Repository workflow

Use squash merge for all PR merges in this repository, as explicitly instructed
by the owner. Preserve the effective signing policy and required checks/reviews.

This project's workflow package is `assuredloop-base`, installed through the
project's npm link. Resolve `node_modules/assuredloop-base` to its owning package,
verify its version, artifact integrity and contract metadata against the accepted
consumer binding, and read its README and authoritative contracts/templates.

`.assuredloop/policy.md` describes the proposed consumer choices. Configuration or
skill presence alone is not activation. Until an accepted bootstrap and activation
are delivered, follow only the explicitly authorized native/manual bootstrap
handoff and report its limits. Do not infer acceptance from these files.

After activation, resolve the applicable accepted policy from the actual delivery
destination's pre-change configuration and activation record. Follow the assigned
activity's `.agents/skills/assuredloop-*/SKILL.md` guidance together with native
OpenSpec operations and current user instructions. Formal product context belongs
in `openspec/`; framework source history is not this consumer's work data. Current
assignments supply the responsible owner and any review-return recipient.

Internal review must use a separate Astra agent/session under the accepted review
policy. The implementation producer does not review its own output. No permanent
author session, scheduler, external-review provider or global instruction is
selected by this file.
