# Complete prototype-review inputs

These are the four **CLI input shapes** for a prototype plan and one design cycle. They aren't ready-made approval records. Use them with an existing UI delivery whose intent and design-system guidance you've reviewed.

The host normally prepares these files through `ewai-prototype-iteration`; a person reviews the resulting plan and design. Direct CLI use is useful for repeatability and integrations.

## Before copying the examples

Use your delivery's actual slug instead of `customer-portal`. Replace every capitalised value below with the result from your project:

| Value | Source |
| --- | --- |
| `INTENT_DIGEST` | The reviewed intent content used for this delivery. |
| `DESIGN_SYSTEM_DIGEST` | The effective digest in this delivery's design-system application receipt. |
| `PLAN_PREPARATION_DIGEST` | `preparation.preparationDigest` returned by plan preparation. |
| `PLAN_REVIEW_DIGEST` | `review.contentDigest` returned by plan recording. |
| `PROTOTYPE_MANIFEST_DIGEST` | The digest of the actual prototype manifest being reviewed. |
| `CYCLE_PREPARATION_DIGEST` | `preparation.preparationDigest` returned by cycle preparation. |
| `ACTIVE_PERSONA_ID` | A persona in the active ensemble for **that** preparation. Recheck it for the design cycle. |

Keep the complete `sha256:` prefix on digests. These references tie the review to particular inputs; syntactically valid hashes alone don't prove a correct design or grant approval.

The [versioned domain schema](../../config/prototype-iteration.schema.json) describes saved contracts. The CLI preparation requests below are intentionally smaller: EWAI adds the schema, slug and selected persona engagement. Don't paste a saved domain object into a CLI request that accepts different fields. [Review semantics](../../skills-src/ewai-prototype-iteration/references/review-contract.md) explains findings, assessments and evidence channels.

## 1. plan-prepare.json

<!-- example: prototype-plan -->
```json
{
  "intentDigest": "INTENT_DIGEST",
  "designSystem": {
    "id": "ewai.design-system.default",
    "effectiveDigest": "DESIGN_SYSTEM_DIGEST"
  },
  "plan": {
    "summary": "Let a customer review the status of their request.",
    "screens": [{
      "id": "request-status",
      "title": "Request status",
      "purpose": "Explain the current state and next action.",
      "userOutcomes": ["Understand whether a response is needed"],
      "evidenceRefs": ["intent:request-status"]
    }],
    "journeys": [{
      "id": "check-request",
      "actor": "customer",
      "outcome": "Find out whether to respond or wait.",
      "screenRefs": ["request-status"]
    }]
  },
  "signals": ["user journey", "usability", "recovery"],
  "predecessorDigest": ""
}
```

Use the actual selected pack ID when it isn't the bundled fallback. Replace the fictional intent reference with the accepted source supporting your screen.

```bash
ewai prototype-review plan-prepare customer-portal --input plan-prepare.json --project . --json
```

Read the returned active personas. Preparation hasn't reviewed or selected the design.

## 2. plan-review.json

After reviewing the plan, record each actual finding and one assessment per finding. This example incorporates a missing explanation:

<!-- example: prototype-plan-review -->
```json
{
  "schema": "ewai.prototype-plan-review-submission/v1",
  "expectedPreparationDigest": "PLAN_PREPARATION_DIGEST",
  "reviewedBy": "Example reviewer",
  "findings": [{
    "personaId": "ACTIVE_PERSONA_ID",
    "concernCode": "next-action",
    "severity": "advisory",
    "observation": "The plan names a status but doesn't explain whether the customer needs to act.",
    "recommendation": "Describe the next action and who is responsible.",
    "evidenceRefs": ["screen:request-status"]
  }],
  "assessments": [{
    "findingRef": {
      "personaId": "ACTIVE_PERSONA_ID",
      "concernCode": "next-action",
      "evidenceRefs": ["screen:request-status"]
    },
    "disposition": "incorporate",
    "rationale": "A status is useful only when the customer can tell what to do next."
  }]
}
```

`findingRef` lets the CLI derive the stable finding ID from persona, concern and references. Saved records use `findingId`.

```bash
ewai prototype-review plan-record customer-portal --input plan-review.json --project . --json
```

Keep the returned `review.contentDigest`. Incorporate the accepted feedback; don't call the plan approved merely because recording succeeded.

## 3. cycle-prepare.json

Produce the runnable prototype under `SPECS/6.Build/customer-portal/ui-design-assets/prototypes/`. Capture the source and rendered viewport evidence before design review. For example, `selected.html` and the evidence labelled `render:desktop` below must correspond to actual files/captures you've inspected.

<!-- example: prototype-cycle -->
```json
{
  "planReviewDigest": "PLAN_REVIEW_DIGEST",
  "cycleNumber": 1,
  "maxCycles": 2,
  "predecessorDigest": "",
  "prototype": {
    "manifestDigest": "PROTOTYPE_MANIFEST_DIGEST",
    "entryPath": "ui-design-assets/prototypes/selected.html"
  },
  "evidenceChannels": [
    {"channel": "source", "status": "available", "evidenceRefs": ["prototype:selected.html"], "note": "Source inspected for this example design."},
    {"channel": "rendered-viewport", "status": "available", "evidenceRefs": ["render:desktop"], "note": "Desktop capture inspected for this example design."},
    {"channel": "interaction", "status": "not-collected", "evidenceRefs": [], "note": "Not exercised in this cycle."},
    {"channel": "assistive-technology", "status": "not-collected", "evidenceRefs": [], "note": "Not exercised."},
    {"channel": "user-research", "status": "not-collected", "evidenceRefs": [], "note": "No representative users involved."},
    {"channel": "manual-qa", "status": "pending-human", "evidenceRefs": [], "note": "Separate human gate."},
    {"channel": "release", "status": "not-collected", "evidenceRefs": [], "note": "No release decision."}
  ],
  "signals": ["visual hierarchy", "usability", "responsive"]
}
```

**Don't copy the two available states unless you've collected that evidence.** Source and rendered-viewport evidence are prerequisites; if missing, collect them before proceeding. Other channels remain honestly absent.

```bash
ewai prototype-review cycle-prepare customer-portal --input cycle-prepare.json --project . --json
```

The active design personas can differ from the plan's. Use the current ensemble for the next review.

## 4. cycle-review.json

This fictional finding illustrates how to record a needed change, not an already-observed fault in your product:

<!-- example: prototype-cycle-review -->
```json
{
  "schema": "ewai.prototype-cycle-review-submission/v1",
  "expectedPreparationDigest": "CYCLE_PREPARATION_DIGEST",
  "reviewedBy": "Example reviewer",
  "findings": [{
    "personaId": "ACTIVE_PERSONA_ID",
    "concernCode": "action-hierarchy",
    "severity": "advisory",
    "observation": "The next action is visually weaker than supporting information.",
    "recommendation": "Give the next action a clearer position and emphasis.",
    "evidenceRefs": ["render:desktop"]
  }],
  "assessments": [{
    "findingRef": {
      "personaId": "ACTIVE_PERSONA_ID",
      "concernCode": "action-hierarchy",
      "evidenceRefs": ["render:desktop"]
    },
    "disposition": "incorporate",
    "rationale": "The main action needs to be easy to find before supporting detail."
  }]
}
```

```bash
ewai prototype-review cycle-record customer-portal --input cycle-review.json --project . --json
ewai prototype-review status customer-portal --project . --json
```

Expect `iterate` when incorporated feedback requires another cycle and capacity remains. The next cycle names the preceding cycle's content digest. At the limit, unresolved work needs a human decision; it doesn't become accepted automatically.

Plan and cycle records are saved under the delivery's `ui-design-assets/prototype-iterations/`. Follow the [iteration guide](../persona-guided-prototype-iteration.md) to link the reviewed plan and final cycle in the v3 manifest. Human prototype selection, implemented-feature Manual QA and release remain separate.
