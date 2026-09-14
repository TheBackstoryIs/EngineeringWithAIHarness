# Meeting evidence candidate contract

Use the exact `candidateContract` returned by `ewai meeting prepare`. The current public bundle schema is `ewai.meeting-candidate-bundle/v1`.

## Candidate bundle

```json
{
  "schema": "ewai.meeting-candidate-bundle/v1",
  "sourceId": "meeting.product-sync.0123456789ab",
  "sourceDigest": "64-character source digest",
  "candidates": [
    {
      "id": "MEC-001",
      "type": "decision",
      "observedStatement": "A named owner will review the release evidence.",
      "interpretation": "Release remains a human decision rather than an automated consequence.",
      "lineAnchors": [{ "start": 42, "end": 47 }],
      "confidence": "high"
    }
  ]
}
```

Allowed candidate types are `task`, `decision`, `process`, `risk`, `system`, `policy`, `requirement`, `assumption` and `open-question`. IDs use `MEC-###` with three or more digits. Anchors are inclusive, one-based line ranges inside the registered source line count.

The fields are deliberately separate:

- `observedStatement` is a concise paraphrase of what the source supports.
- `interpretation` is analysis of what the observation may mean.
- `confidence` communicates extraction certainty, not approval or truth.

Raw source excerpts are not allowed. Raw model output, prompts, source paths, participant identifiers, credentials and unbounded summaries are not allowed. Unknown fields fail validation.

## Named review input

The CLI review file wraps the bundle and one complete disposition list:

```json
{
  "bundle": {
    "schema": "ewai.meeting-candidate-bundle/v1",
    "sourceId": "meeting.product-sync.0123456789ab",
    "sourceDigest": "64-character source digest",
    "candidates": []
  },
  "dispositions": [
    {
      "candidateId": "MEC-001",
      "decision": "amended",
      "replacementText": "A product owner will review the release evidence.",
      "rationale": "The original wording did not name the accountable role."
    }
  ]
}
```

Every candidate appears exactly once. Decisions are `accepted`, `rejected`, `amended` or `deferred`. `amended` requires both `replacementText` and `rationale`; replacement text is forbidden for the other decisions. Rejected and deferred candidates remain in review history but are not promoted.

## Freshness and authority

The source digest binds extraction, review and promotion. Any source or review drift fails closed. Promotion requires a separate exact confirmation and named approver. It creates reviewed meeting evidence only and does not author downstream project records or grant delivery authority.

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.
