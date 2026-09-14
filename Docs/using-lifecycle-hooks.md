# Using EWAI lifecycle hooks

Lifecycle hooks let an organisation-owned executable receive selected EWAI milestones after EWAI has recorded them. They are a provider-neutral handoff boundary, not built-in deployment, ticketing, messaging, security-scanning, or certification connectors.

The rule to remember is:

> EWAI records the milestone first. Handlers are notified afterwards.

A handler can acknowledge or reject an event, but it cannot approve, veto, complete, fail, or alter Discovery, an Intent, a delivery phase, Build approval, Manual QA, release readiness, or any canonical `SPECS/` evidence.


<!-- editorial: contents -->
## On this page

- [Who this guide is for](#who-this-guide-is-for)
- [The lifecycle event catalogue](#the-lifecycle-event-catalogue)
- [1. Build a handler package](#1-build-a-handler-package)
- [2. Validate before registration](#2-validate-before-registration)
- [3. Register the reviewed package](#3-register-the-reviewed-package)
- [4. Enable an explicit subscription](#4-enable-an-explicit-subscription)
- [5. Understand the event envelope](#5-understand-the-event-envelope)
- [6. Return a bounded acknowledgement](#6-return-a-bounded-acknowledgement)
- [7. Make downstream work idempotent](#7-make-downstream-work-idempotent)
- [8. Inspect delivery](#8-inspect-delivery)
- [9. Retry a terminal delivery](#9-retry-a-terminal-delivery)
- [10. Disable future delivery](#10-disable-future-delivery)
- [Status and diagnostic reference](#status-and-diagnostic-reference)
- [Retention and recovery](#retention-and-recovery)
- [Security and governance checklist](#security-and-governance-checklist)
- [Deliberate V1 exclusions](#deliberate-v1-exclusions)
- [Contract references](#contract-references)

## Who this guide is for

- An organisation operator who validates, registers, subscribes, inspects, retries, or disables handlers.
- A handler author implementing the local process that receives EWAI events.
- A governance or security reviewer assessing the executable boundary, permissions, payload, and operational ownership.

Handler installation and subscription are trusted terminal operations. The dashboard deliberately cannot accept executable paths, commands, endpoints, or credentials.

To inspect hooks in the dashboard, enable **Hooks** in **Configuration** and save. This only shows the view: registering a handler and subscribing to events remain separate actions. See [dashboard configuration](operations/dashboard-configuration.md).

The dispatcher runs with the local dashboard. If the dashboard isn't running, queued deliveries wait. `ewai checkin` starts or reuses it; inspecting a registration alone doesn't dispatch events. Check the delivery status after an event rather than assuming the downstream handler ran.

## The lifecycle event catalogue

EWAI supports these 15 lifecycle events:

| Event | Meaning |
| --- | --- |
| `ewai.project.discovery.completed` | Reviewed project Discovery was committed. |
| `ewai.project.starter.materialised` | An approved starter was added and its evidence saved. |
| `ewai.meeting-evidence.promoted` | Reviewed meeting evidence was approved and saved. |
| `ewai.knowledge-proposals.materialised` | Reviewed proposals were added to project knowledge and the result saved. |
| `ewai.intent.created` | Intent Markdown and structured state were created. |
| `ewai.policy.facts.confirmed` | Policy facts were confirmed and saved. |
| `ewai.policy.evaluation.recorded` | A policy evaluation was saved. |
| `ewai.policy.review.recorded` | A policy review was saved. |
| `ewai.policy.exception.recorded` | A policy exception was saved. |
| `ewai.delivery.phase.entered` | A guarded delivery phase entered its running state. |
| `ewai.delivery.phase.completed` | A phase completed with passing gate evidence. |
| `ewai.delivery.build.approved` | Named human Build approval was recorded. |
| `ewai.delivery.manual-qa.approved` | Named human Manual QA approval was recorded. |
| `ewai.delivery.completed` | The Delivery phase completed and handed off to Manual QA. |
| `ewai.delivery.release-ready` | Delivery is complete and all required human gates are approved. |

Run `ewai hook catalogue --project PATH --json` to inspect the installed catalogue. `release-ready` is derived from canonical EWAI state; it is never a handler decision.

## 1. Build a handler package

A package is a local folder containing:

```text
release-observer/
├── lifecycle-handler.json
└── handler
```

The entrypoint can use any language that the local machine can execute directly. EWAI starts the exact registered file with no arguments and `shell: false`, writes one JSON event to standard input, and expects one JSON acknowledgement on standard output.

For example, a minimal Node.js entrypoint is:

```js
#!/usr/bin/env node

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  const event = JSON.parse(input);

  // Perform the organisation-owned, idempotent handoff here.
  // Use event.idempotencyKey when recording or calling the downstream system.

  process.stdout.write(JSON.stringify({
    schema: 'ewai.lifecycle-hook-ack/v1',
    status: 'accepted',
    code: 'recorded',
    message: `Recorded ${event.name}`
  }));
});
```

Make the entrypoint executable:

```bash
chmod +x release-observer/handler
```

Compute its SHA-256 digest. On macOS:

```bash
shasum -a 256 release-observer/handler
```

Put the digest and executable filename into `lifecycle-handler.json`:

```json
{
  "schema": "ewai.lifecycle-handler/v1",
  "id": "org.example.release-observer",
  "name": "Release observer",
  "publisher": {
    "id": "org.example",
    "name": "Example Organisation"
  },
  "version": "1.0.0",
  "compatibility": {
    "protocols": ["1"],
    "eventSchemas": ["1"]
  },
  "entrypoint": "handler",
  "digest": "sha256:REPLACE_WITH_THE_ENTRYPOINT_SHA256",
  "events": [
    "ewai.delivery.build.approved",
    "ewai.delivery.manual-qa.approved",
    "ewai.delivery.release-ready"
  ],
  "limits": {
    "timeoutMs": 5000,
    "maxOutputBytes": 16384
  },
  "description": "Records approved delivery milestones in an organisation-owned system."
}
```

The root, manifest, and entrypoint must be regular files or directories rather than symbolic links. The entrypoint must remain inside the package root. After registration, changing the manifest or implementation makes queued delivery incompatible. Restore the registered bytes, or review the replacement as a new handler identity and subscription before disabling the old subscription. V1 does not update a registered package in place.

## 2. Validate before registration

Validation is read-only:

```bash
ewai hook validate ./release-observer --project . --json
```

It checks the bounded root, manifest shape, stable identities, semantic version, protocol/event compatibility, supported event patterns, entrypoint, executable permission, and digest. The safe result exposes calculated digests but not the trusted absolute path.

Validation does not register or enable anything.

## 3. Register the reviewed package

Registration requires explicit confirmation:

```bash
ewai hook register ./release-observer --project . --yes --json
```

Registration pins the reviewed package identity, publisher, versions, root, entrypoint, manifest digest, and combined package digest in the project-local runtime. It still does not subscribe the project to events.

Treat registration as executable installation. Review the source, dependency chain, operating-system account, filesystem and network permissions, credential source, downstream permissions, logging policy, and incident owner before confirming it.

## 4. Enable an explicit subscription

Subscribe the registered handler only to the events it needs:

```bash
ewai hook subscribe org.example.release-observer \
  --events ewai.delivery.build.approved,ewai.delivery.manual-qa.approved,ewai.delivery.release-ready \
  --project . \
  --yes \
  --json
```

An event wildcard such as `ewai.delivery.*` is allowed only when it matches the installed catalogue and the handler manifest declares support for every matching event.

New matching events are queued after subscription. Reconciliation can record canonical milestones that are not yet in the hook ledger, but enabling a subscription is not a promise to replay every event previously recorded for another subscription.

## 5. Understand the event envelope

The handler receives an `ewai.lifecycle-event/v1` object:

```json
{
  "schema": "ewai.lifecycle-event/v1",
  "id": "bb48c5a4-0562-49ad-b09e-d1d36e99f807",
  "name": "ewai.delivery.build.approved",
  "occurredAt": "2026-08-20T09:53:57.169Z",
  "project": {
    "id": "project-52b901fef1364c71",
    "name": "Example Product"
  },
  "scope": {
    "intent": "platform/safe-delivery",
    "delivery": "safe-delivery"
  },
  "facts": {
    "status": "approved",
    "decision": "approved"
  },
  "source": {
    "key": "delivery:safe-delivery:build.approved:2026-08-20T09:53:57.169Z",
    "revision": "2026-08-20T09:53:57.171Z"
  },
  "evidence": [
    "SPECS/6.Build/safe-delivery/gates/build/build-approval.json"
  ],
  "personas": [
    {
      "id": "project.release-owner",
      "name": "Release Owner",
      "tier": "project",
      "reason": "Engaged as accountable for this lifecycle moment."
    }
  ],
  "stream": {
    "id": "delivery:safe-delivery",
    "sequence": 8
  },
  "idempotencyKey": "ewai-4e1f9c9b9d5882a1b9a764d38eb267dc77b301c3"
}
```

The payload contains allowlisted semantic facts and project-relative evidence references, not evidence bodies. Persona context contains only ID, name, tier, and engagement reason. Premium and project personas are provenance and advisory context, not authority; proprietary persona bodies are never included.

Prompts, transcript answers, credentials, commands, executable paths, raw evidence, cookies, authorisation values, and raw handler output are excluded.

## 6. Return a bounded acknowledgement

An accepted acknowledgement is:

```json
{
  "schema": "ewai.lifecycle-hook-ack/v1",
  "status": "accepted",
  "code": "recorded",
  "message": "The organisation ledger recorded the event.",
  "metadata": {
    "duplicate": false
  }
}
```

To refuse the event deliberately:

```json
{
  "schema": "ewai.lifecycle-hook-ack/v1",
  "status": "rejected",
  "code": "policy-review",
  "message": "Organisation review is required before this handoff can continue."
}
```

Only the bounded status, code, message, scalar metadata, duration, and attempt timestamps are retained. Standard output is parsed and then discarded; standard error is counted against the output limit and discarded. Never depend on EWAI as the handler’s log store.

## 7. Make downstream work idempotent

Delivery is at least once. A handler can receive the same event more than once after timeout, process interruption, automatic retry, or an explicit manual retry.

- Use `idempotencyKey` as the unique key for the downstream operation.
- Return `accepted` when the same operation was already completed safely.
- Do not generate a new external action merely because the attempt number changed.
- Do not use an acknowledgement to imply an external deployment, notification, scan, or workflow succeeded unless the handler genuinely verified that outcome.

The event ID and idempotency key stay stable across all attempts. Retry appends an attempt; it never reruns the EWAI source operation.

## 8. Inspect delivery

Use the CLI:

```bash
ewai hook list --project . --json
ewai hook deliveries --project . --json
ewai hook deliveries --status exhausted --project . --json
ewai hook deliveries --event ewai.delivery.release-ready --project . --json
ewai hook deliveries --handler org.example.release-observer --project . --json
```

Or open the project dashboard and choose **Hooks**. The workspace reads left to right as **Milestone → Handler → Delivery** and shows:

- verified registered handlers and enabled or disabled subscriptions;
- delivery status, attempt count, next eligibility, and sanitised diagnostic;
- stable event, stream, handler, package, and idempotency identities;
- safe scope and evidence references;
- the core, premium, personal, and project personas recorded as active for that event;
- a clear reminder that handler status does not change the EWAI milestone.

`Delivered` means the handler returned a valid accepted acknowledgement. It does not certify what happened in a downstream system.

## 9. Retry a terminal delivery

Automatic delivery makes three attempts in total: immediately, after one second, and after a further five seconds. A deliberate rejection or package incompatibility stops automatic delivery immediately. Other repeated failures become `exhausted`.

After diagnosing the handler, retry an `exhausted`, `rejected`, or `incompatible` delivery:

```bash
ewai hook retry DELIVERY_ID --project . --yes --json
```

The dashboard exposes the same action with a confirmation. A manual retry uses the same event and idempotency key and appends a manual attempt.

## 10. Disable future delivery

Disable an enabled project subscription:

```bash
ewai hook disable SUBSCRIPTION_ID --project . --yes --json
```

Disabling stops future matching deliveries and resolves outstanding non-running deliveries as disabled. Historical events and attempts remain visible. It does not remove the handler package, change its files, or alter canonical project state.

## Status and diagnostic reference

| Status | Meaning | Typical action |
| --- | --- | --- |
| `queued` | Eligible for its first or manual attempt. | Allow the dashboard dispatcher to run. |
| `retrying` | An automatic retry is scheduled. | Inspect the safe diagnostic and wait for eligibility. |
| `delivering` | The exact local executable is currently running. | Do not start a duplicate operation manually. |
| `succeeded` | A valid `accepted` acknowledgement was received. | Verify downstream truth in the owning system where appropriate. |
| `exhausted` | Automatic or manual delivery failed without acceptance. | Diagnose, then use explicit retry. |
| `rejected` | The handler deliberately returned `rejected`. | Resolve its stated policy or business reason, then retry if appropriate. |
| `incompatible` | Registered package identity or bytes no longer match. | Review the local package rather than bypassing the check. |
| `disabled` | The subscription was disabled. | Re-enable only through a reviewed explicit subscription action. |

Common safe codes include `handler-timeout`, `handler-output-too-large`, `handler-exit`, `handler-signal`, `handler-ack-invalid`, `handler-incompatible`, `worker-interrupted`, and `subscription-disabled`.

## Retention and recovery

- Successful and explicitly resolved deliveries have a 30-day runtime retention window.
- Unresolved failures remain until they are retried successfully or disabled, then remain for 30 more days.
- A `delivering` claim older than 60 seconds is recovered after restart as `worker-interrupted`. An automatic claim consumes one bounded attempt and resumes only when its budget remains. An interrupted manual claim returns to `exhausted` and requires a new explicit retry.
- Runtime hook data lives in the rebuildable project-local SQLite projection under `.ewai-pipeline/`; it is not canonical `SPECS/` truth.
- Cleanup never deletes canonical delivery evidence.

If the dashboard is not running, queued delivery waits. `ewai checkin` starts or reuses the local dashboard; opening the Hooks workspace also reconciles canonical milestones with the hook ledger.

## Security and governance checklist

Before production use, confirm:

1. The publisher, source, dependencies, entrypoint digest, and declared event set were reviewed.
2. The operating-system account has only the filesystem, network, and downstream permissions it needs.
3. Credentials come from the organisation’s protected runtime mechanism, never from the manifest, project content, browser, event, acknowledgement, or command arguments.
4. Downstream operations enforce their own authorisation and use the EWAI idempotency key.
5. Handler logs apply the organisation’s data classification and retention policy.
6. Ownership, monitoring, incident response, package updates, revocation, and disaster recovery are explicit.
7. People understand that handler success is not EWAI approval or external certification.

## Deliberate V1 exclusions

EWAI does not provide:

- production connectors for deployment platforms, ticketing tools, messaging services, security products, or cloud providers;
- browser-based handler installation, update, executable configuration, endpoint configuration, or credential entry;
- remote webhook hosting or webhook-signing infrastructure;
- pre-transition or veto hooks;
- handler-driven Build, Manual QA, phase, release, or compliance approval;
- deployment execution, release certification, or downstream outcome verification;

Organisations can implement their own connector behaviour behind a reviewed handler. That code, its permissions, and its operational consequences remain organisation-owned.

## Contract references

- `config/lifecycle-handler.schema.json`
- `config/lifecycle-event.schema.json`
- `config/lifecycle-hook-ack.schema.json`
- `SPECS/4.Constraints/standards/lifecycle-hook-safety.md`
- `src/runtime/lifecycle-hooks.mjs`
- `tests/lifecycle-hooks.test.mjs`
- `tests/lifecycle-hook-emissions.test.mjs`
