## Context

The consumer begins with native OpenSpec and two npm links. `main` has the initial
scaffold and no accepted AssuredLoop configuration. The owner requested full
activation against the newly created GitHub repository.

## Goals / Non-Goals

Deliver an accepted, usable, discoverable manual AssuredLoop workflow and verify
that current policy resolution selects its active checkpoint. Application design,
automatic CI/review providers and a new framework release are outside this change.

## Decisions

### Consumer policy

`.assuredloop/policy.md` contains the exact proposed project choices. Accept its
fixed Git revision, not a mutable branch URL. Use Astra-only independent internal
review in line with the owner's current instructions. This initial tooling change
does not modify executable behavior and therefore uses artifact checks and review.

### Local links and reproducible identity

Keep the requested npm links. Record the selected source commit, contract source,
tarball SRI and dependency lock provenance. A link makes source changes immediate;
formal acceptance stays bound to the reviewed bytes. A tarball installation is
more portable but would remove that live development behavior, so it remains a
later installation option. Pack artifacts and run output stay in ignored
`local-data/`; repository/GitHub records retain the required provenance.

### Bootstrap before activation

Preview and verify consumer initialization without claiming acceptance. The initial
configuration has no bootstrap authorization until real owner acceptance exists.
After independent review, obtain owner acceptance of the fixed policy and proposal
and conditional authority to deliver bootstrap and then activation if their checks
and independent reviews pass. Record that decision accurately on GitHub.

Bind `project.bootstrap` to the fixed policy and real acceptance references, verify
and deliver it in `main`. Then prepare `.assuredloop/activation.json` on a separate
branch. Its assessment must resolve `main`'s accepted bootstrap, not authorize
itself from its candidate activation. After checks and independent review, deliver
the checkpoint and verify current policy reports `activation`.

### Scope and evidence

Use native/manual bootstrap evidence until an accepted destination policy exists.
Keep planning and adoption work separately assigned and link their actual native
task sections. Provision the six configured labels without changing existing ones.
Verify the initializer's repeat preview is unchanged and native skills, ownership
marker and product Specs are preserved. Exercise missing-input and wrong-binding
cases without changing real policy. Framework release-level demonstrations remain
distinct from consumer activation; do not fabricate extra work to claim them.

## Risks / Trade-offs

The link depends on this machine's checkout and installed dependencies. SRI and
schema checks do not authenticate the publisher or prove meaningful approval.
Current CLI review-kind declarations do not prove reviewer independence. Manual
review and real owner decisions supply those judgments. Unavailable inputs or
changed package bytes leave the applicable assessment incomplete.

## Migration Plan

There are no old workflow records to migrate. Deliver accepted bootstrap first,
then activation. A later suspension or rebind is a traced, owner-authorized change;
do not delete history or weaken a candidate's governing policy.

## Open Questions

Owner acceptance of this exact policy and ordered activation delivery is pending.
