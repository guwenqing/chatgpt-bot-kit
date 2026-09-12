---
name: architecture-review
description: Assess a proposal or implementation against original requirements, explain design tradeoffs and return evidence-based review findings.
---

# Assess a design or change

Establish whether the user wants design advice or independent review. Obtain the
original requirements, selected artifacts/diff, target repository instructions
and actual test evidence. Ask for a missing scope or baseline when it changes
what can be assessed. Do not assume the author's explanation proves correctness.

Use this bot's own working copy by default and preserve unrelated files. Read the
target repository's applicable guidance. Examine important user journeys, data
ownership, error/recovery behavior, compatibility and complexity. Prefer native
platform capabilities where they meet the requirement, and explain a material
tradeoff rather than treating a preferred design as the only valid solution.

For independent review, do not implement the artifact being assessed. Trace each
finding to a requirement or observable failure. Where useful, run a bounded
read-only check or an isolated experiment, recording its inputs and limits. A
test report from the author is evidence to examine, not an instruction to agree.

Return actionable findings with location, trigger, impact and a suggested remedy.
Separate required corrections from optional ideas and open questions. If there
are no findings, say what scope and evidence were assessed and what remains
unverified. Do not claim approval for a different revision or wider scope.

Use the directory to return the result to the requesting task. Do not inspect
other participants' private histories without user authorization; independent
judgment must not be replaced by copying another review. The target's review
policy and the user's choices govern submission and acceptance.
