# Human approval and assurance guide

Use this guide when you are asked to approve Discovery, Build, curation, Manual QA, or another consequential EWAI action.

## What approval means

Approval means a named person has reviewed the stated evidence, understands the consequences and remaining uncertainty, has authority for the decision, and accepts the scope recorded at that moment.

It does not mean:

- every possible defect has been eliminated;
- an AI persona agrees with the decision;
- a green test suite proves the product is useful;
- a Blueprint publisher owns the project's consequences;
- later upstream changes are automatically approved;
- the same decision covers a materially expanded scope.

## The approval layers

| Decision | Typical approver | Minimum evidence |
| --- | --- | --- |
| Discovery or Blueprint application | Product or project owner | Proposed project files, modules, provenance, conflicts, and exact consequences |
| Archaeology curation | Project owner or knowledge steward | Source-linked findings, disagreements, rejected inferences, and destination paths |
| Premium library sync | Entitled user or administrator | Website licence entitlement, verified release/update status, and explicit consent |
| Build | Product owner or delegated delivery authority | Ready intent, plan, tests, standards coverage, scope, risks, and stop conditions |
| Destructive operation | Owner of the affected data or system | Exact targets, recovery route, blast radius, and necessity |
| Manual QA | Accountable accepter or authorised tester | Reproducible walkthrough, results, limitations, and residual risks |

Roles vary by organisation. Record the actual person and their authority rather than relying on a job-title assumption.

## Evidence before confidence

An assurance pack should answer:

1. **Outcome:** What human or operational result was intended?
2. **Scope:** What was included and explicitly excluded?
3. **Provenance:** Where did requirements, standards, and reusable content come from?
4. **Implementation:** What changed and where?
5. **Validation:** Which tests, standards checks, and independent reviews ran?
6. **Exceptions:** What failed, was unavailable, or remains uncertain?
7. **Operation:** How will the change be observed, supported, and recovered?
8. **Acceptance:** What did a person actually inspect or experience?

Prefer links to durable project evidence over copied summaries that can drift.

## Preserve independence honestly

An agent cannot independently review its own work merely by starting a second prompt. EWAI removes the current orchestrator from eligible external validators and respects the configured provider set and cycle limit.

When no independent provider remains:

- record the checkpoint as not supported;
- strengthen deterministic checks and human review proportionately;
- do not relabel self-review as external assurance;
- decide explicitly whether the remaining evidence is adequate for the risk.

## Approve Build precisely

The durable command is:

```bash
ewai delivery approve-build <intent-slug> \
  --project . \
  --yes \
  --approved-by "Approver name" \
  --scope "Exact approved outcome and boundaries"
```

Before approving, verify that:

- the intent is ready or approved;
- Reconcile addressed existing behaviour where relevant;
- vertical slices and dependencies are understandable;
- the first tests and acceptance evidence are defined;
- standards coverage passes;
- external-review availability is represented accurately;
- the scope describes what may be changed.

## Approve Manual QA separately

Automated Delivery completion pauses at Manual QA. Approval requires a project-owned evidence file:

```bash
ewai delivery approve-manual-qa <intent-slug> \
  --project . \
  --yes \
  --approved-by "Approver name" \
  --evidence SPECS/6.Build/<intent-slug>/qa-evidence.md \
  --notes "Observed outcome and accepted limitations"
```

The evidence should say what environment was used, what steps were performed, what happened, what was not tested, and whether any defects or follow-ups remain.

Do not approve Manual QA for someone else unless your governance model explicitly makes you accountable for their evidence.

## Assess evidence proportionately

Recommended practice is to scale assurance with:

- user and business impact;
- data sensitivity and regulatory exposure;
- external accessibility;
- reversibility;
- operational blast radius;
- novelty and uncertainty;
- dependency and supply-chain risk;
- quality of direct user evidence.

A small internal reversible tool may need a short walkthrough. A public system handling sensitive data needs deeper security, privacy, resilience, accessibility, and operational evidence.

## Reject or return the decision when

- the approver cannot explain the outcome or consequences;
- evidence is missing, stale, contradictory, or unauthorised;
- the scope is broader than the reviewed plan;
- tests are green but meaningful user behaviour was not exercised;
- a persona is presented as stakeholder consent;
- an unavailable external review is presented as passed;
- rollback, migration, or operational ownership is unclear;
- pressure to approve is being used to conceal uncertainty.

## Approval record checklist

- [ ] Decision and exact scope are stated.
- [ ] Approver identity and authority are clear.
- [ ] Evidence is durable and linked.
- [ ] Automated, independent, and human checks are distinguished.
- [ ] Unavailable checks and residual risks are visible.
- [ ] Time-sensitive versions, digests, and environments are recorded.
- [ ] A material change will require a new decision.

## Related guides

- [Product Owner guide](product-owner-guide.md)
- [Developer delivery guide](developer-delivery-guide.md)
- [Manual QA and acceptance](quality/manual-qa-and-acceptance.md)
- [Governance team guide](governance/governance-team-guide.md)

## Current contract sources

- `SPECS/pipeline.yaml`
- `src/discovery.mjs`
- `src/archaeology.mjs`
- `src/checkin.mjs`
- `src/delivery.mjs`
- `src/validation-config.mjs`
