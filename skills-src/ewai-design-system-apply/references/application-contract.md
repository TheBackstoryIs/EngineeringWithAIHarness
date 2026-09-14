# Design-system application contract

## Evidence flow

The project pin resolves one root and its explicit dependencies. Contributions applicable to UI Design, Prototype, the affected surface, and the stated focus become candidates for the existing EWAI context assembler. Required contributions are mandatory; focus-matched contributions are relevant; the rest can be deferred. Mandatory overflow is non-ready and emits no provider payload.

Contextual personas are selected from installed core, project-local, personal, and entitled premium catalogues. Their safe identity and reason are visible while their definitions remain private. Persona advice remains subordinate to observable product evidence and accountable human decisions.

## Receipt and manifest

Successful application creates immutable, digest-addressed JSON and Markdown evidence under:

```text
SPECS/6.Build/<delivery>/ui-design-assets/design-system/
```

The JSON uses `ewai.design-system-receipt/v1`. A newly stamped delivery uses `ewai.prototype-manifest/v3`; its design-system section declares:

```json
{
  "designSystem": {
    "receiptPath": "ui-design-assets/design-system/receipt-<digest>.json",
    "receiptDigest": "sha256:<digest>",
    "effectiveDigest": "sha256:<digest>"
  }
}
```

The v3 manifest also links the immutable reviewed prototype plan and final persona-guided design cycle. Historical v1 and v2 manifests remain readable. A newly stamped UI Design phase must complete the v3 review linkage before it can complete.

## Recovery

- `mandatory-overflow`: narrow focus, explicitly increase the bounded budget, or split the surface.
- stale selected system: inspect, re-resolve, and obtain a new named selection approval.
- receipt mismatch: do not edit immutable evidence; reapply and link the newly returned receipt.
- missing premium personas: continue with applicable core/project/personal personas; premium access is never required for correctness.
