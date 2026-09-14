# Review and promote one meeting statement

This complete example uses fictional notes in a disposable, initialised EWAI project. It demonstrates the file handoff; no meeting platform, model call or real person's approval is involved. In real work, the named people must actually review and approve the material.

## Create the source

Save this as `meeting.md` in the project:

<!-- example: meeting-source -->
```markdown
The support team agreed that the first export should include the ticket number and current status only.
```

Register and prepare it:

```bash
ewai meeting register ./meeting.md --classification internal --cloud-processing allowed --yes --project . --json
ewai meeting prepare <source-id> --project . --json
```

Replace `<source-id>` with `source.sourceId` from registration. Save `source.digest` too. This example permits cloud processing only because the text is fictional. For real material, make the actual classification and processing decision before inspection.

## Prepare and review the input

In normal use, the meeting-evidence skill helps prepare candidates from the allowed source. A reviewer compares each proposed statement with the source and chooses a disposition. Here the complete one-candidate input is shown so you can see the handoff.

Save this as `meeting-review.json`, replacing the two capitalised values with registration's actual ID and digest:

<!-- example: meeting-review -->
```json
{
  "bundle": {
    "schema": "ewai.meeting-candidate-bundle/v1",
    "sourceId": "SOURCE_ID_FROM_REGISTER",
    "sourceDigest": "SOURCE_DIGEST_FROM_REGISTER",
    "candidates": [
      {
        "id": "MEC-001",
        "type": "decision",
        "observedStatement": "The first export is limited to ticket identifiers and status.",
        "interpretation": "Additional columns need a separate scope decision.",
        "lineAnchors": [{"start": 1, "end": 1}],
        "confidence": "high"
      }
    ]
  },
  "dispositions": [
    {"candidateId": "MEC-001", "decision": "accepted"}
  ]
}
```

The observation is a concise paraphrase, not a pasted transcript excerpt. The interpretation remains distinct. For an amendment, include `replacementText` and `rationale`; rejected and deferred decisions need a rationale too. The [candidate schema](../../config/meeting-evidence-candidate.schema.json) and [implementation contract](../meeting-evidence-implementer-guide.md) specify the full boundary.

Record the review:

```bash
ewai meeting review <source-id> --input ./meeting-review.json --reviewed-by "Example reviewer" --project . --json
ewai meeting status <source-id> --project . --json
```

**At this point:** the review is saved privately, but there is no promoted evidence file. A review isn't a promotion.

## Promote the accepted statement

After the separate approval decision:

```bash
ewai meeting promote <source-id> --yes --approved-by "Example owner" --project . --json
```

Look under `SPECS/3.Evidence/meeting-evidence/<source-id>/` for `evidence.md` and `evidence.json`. They contain the accepted statement and provenance, not the raw source file. Promotion doesn't create an intent or approve Build.

If the source changes, the old digest no longer matches. Prepare and review the current material; don't replace hashes in old evidence to force it through.

Return to the [meeting guide](../meeting-evidence-user-guide.md).
