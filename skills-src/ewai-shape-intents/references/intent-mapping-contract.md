# Intent mapping contract

## Durable outputs

An approved map creates:

```text
SPECS/2.Purpose/explorations/intent-maps/<map-slug>.md
SPECS/2.Purpose/explorations/intent-maps/<map-slug>.json
SPECS/2.Purpose/intents/<domain>/<intent-slug>.md
SPECS/2.Purpose/intents/<domain>/<intent-slug>.json
```

The map captures the shaping conversation and approval. Each intent repeats its map identifier and direct relationships so it remains intelligible when read alone. SQLite is a rebuildable projection of those project-owned files.

## Request schema

Pass an `ewai.intent-map-request/v1` object:

```yaml
schema: ewai.intent-map-request/v1
slug: safer-alerting
title: Safer alerting
idea: Improve the reliability and visibility of emergency alert delivery.
desiredOutcome: Operators can trust that every intended recipient is accounted for.
users:
  - Alert operator
evidence:
  - SPECS/3.Evidence/archaeology/dispatch-findings.md
boundaries:
  - Preserve blind-relay privacy.
nonGoals:
  - Replace the messaging provider.
assumptions: []
openQuestions:
  - Who owns failed-delivery escalation?
shapingPersonas:
  - ref: product-owner
    role: facilitator
    depth: 4
intents:
  - domain: alerts
    slug: accountable-dispatch
    title: Accountable dispatch
    problem: Some intended recipients can disappear from dispatch without a durable outcome.
    desiredOutcome: Every intended recipient has an observable delivery disposition.
    users:
      - Alert operator
    journeys: []
    acceptanceCriteria:
      - Every targeted recipient produces a durable delivery or skip record.
    constraints:
      - Raw recipient contact details remain hidden from administrators.
    evidence:
      - SPECS/3.Evidence/archaeology/dispatch-findings.md
    openDecisions: []
    personas: []
    relationships:
      - type: enables
        target: alerts/delivery-reconciliation
        rationale: Reconciliation requires a complete dispatch ledger.
    deliveryShape:
      recommendation: single
      reason: This is one independently valuable delivery outcome with a clear acceptance boundary.
      suggested_children: []
      blocking_questions: []
      reviewed_decision: keep-as-one
```

## Relationship direction

- `depends-on`: the source cannot responsibly deliver its outcome before the target.
- `enables`: completing the source makes the target possible or materially safer.
- `complements`: the intents are independently useful but stronger together.
- `conflicts-with`: the intents express incompatible choices requiring resolution.
- `supersedes`: the source replaces the target's intended outcome.
- `relates-to`: a meaningful connection exists without a stronger semantic claim.

Targets use exact `<domain>/<slug>` references. `depends-on` relationships among newly created intents must be acyclic.

`depends-on` may also record `required_before: build|delivery` and `required_state: plan-complete|delivered`. When omitted, EWAI defaults to `required_before: delivery` and `required_state: delivered`, allowing related intents to be explored and planned in parallel without pretending their delivered outcomes are independent.

## Slicing rules

A good intent:

- produces a user, business, operational, or assurance outcome that can be evaluated;
- can pass through the complete EWAI lifecycle without pretending a technical layer is a product outcome;
- has a defensible boundary and acceptance evidence;
- names dependencies without hiding scope inside another intent.
- includes a delivery-shape preview showing whether it should be delivered as-is, split first, or paused for a split decision.

Do not force a large idea into many intents. Do not combine unrelated outcomes merely to reduce the count. Avoid tasks such as “build API,” “create database,” or “make frontend” unless the technical capability itself is the independently valuable outcome.

If an intent remains large, record `deliveryShape.recommendation: split` with suggested child outcomes and dependencies, or `decision-required` with the owner questions that block a safe split. Do not send an oversized parent intent into delivery merely because it has a dependency map.

## Completion gate

The map is ready to create only when:

- the user has reviewed and explicitly approved it;
- every intent has a title, problem, desired outcome, and stable domain/slug;
- relationships point to proposed or already existing intents;
- every proposed intent has a delivery-shape preview;
- overlaps and conflicts with existing intents are visible;
- assumptions, exclusions, and materially blocking questions are recorded;
- the proposed set is small enough to understand and complete enough to represent the user's idea.

Creation is atomic. If any intent fails validation or collides with existing files, no part of the new map should remain.
