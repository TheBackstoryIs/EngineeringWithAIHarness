# Contributions API

For integration authors and engineers changing EWAI's local dashboard. Contributors should use the [Contributions guide](../guided-phase-evidence-drafting-guide.md).

## Loopback API for implementers

The dashboard uses six work-item-scoped routes:

```text
GET    /api/work-items/:slug/phase-studio
POST   /api/work-items/:slug/phase-studio/draft
DELETE /api/work-items/:slug/phase-studio/draft
POST   /api/work-items/:slug/phase-studio/handoff
POST   /api/work-items/:slug/phase-studio/review
POST   /api/work-items/:slug/phase-studio/confirm
```

The server supplies the project root, SPECS root, intent, current phase, profile, persona catalogue and evidence destinations. Requests cannot override them. Mutations require the matching loopback dashboard origin, bounded allowlisted JSON, a current expected revision and the relevant digest or confirmation.

The reusable domain is [phase-contributions domain module](../../src/runtime/phase-contributions.mjs). It reads delivery and execution state but imports no phase-transition, approval, Manual QA, security-disposition, deployment or release operation.


These are local dashboard routes, not a remotely hosted collaboration API. The visible view is **Contributions**; `phase-studio` remains its internal route ID. Don't rename an integration route to match a UI label.
