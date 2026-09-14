# Local Error Reporting guide

EWAI can create privacy-safe diagnostic packages without a paid service or hosted reporting backend. Reports remain on the user's machine until a person explicitly prepares an email or invokes a registered provider adapter.

This capability reports problems in the EWAI design-time pipeline. It is not production monitoring, application telemetry, incident management, security certification or a runtime engine for software built with EWAI.

## Where reports live

EWAI keeps operational material under:

```text
.ewai-pipeline/error-reports/
├── drafts/
├── packages/
├── receipts/
├── archive/
└── adapters/
```

The folder is excluded by the managed `.ewai-pipeline/.gitignore`. Do not move reports into `SPECS/` or source control: they are local operational evidence, not canonical project truth.

## Quick start

1. Run `ewai dashboard --project .` and open the reported loopback URL.
2. Choose **Error Reporting**.
3. Create and review a local draft.
4. Finalise the draft only when its safe projection contains enough information and no unnecessary sensitive detail.
5. Either prepare a manual email or, when your organisation has explicitly registered one, invoke a provider adapter.

Nothing leaves the machine during steps 1–4.

## Use the dashboard

Open the local dashboard and choose **Error Reporting**. The workspace provides:

- a list of draft, finalised and archived reports;
- a graphical viewer for safe diagnostics, reproduction steps, exclusions, package digests, attempts and receipts;
- **Create report** for a manual draft;
- contextual **Report this problem** actions when an EWAI dashboard surface fails;
- an **Automatic local drafts** opt-in;
- **Finalise ZIP**, **Prepare email**, provider, archive and delete actions when their preconditions are met.

Creating a report never transmits it. Automatic local drafts are opt-in and create deduplicated drafts only; they never finalise, email or invoke a provider.

## Understand custody states

| State | Meaning | What it does not prove |
|---|---|---|
| `draft` | Local editable report material exists. | That a complete package or external report exists. |
| `finalised` | An immutable digest-bound ZIP exists locally. | That the ZIP was attached, sent, accepted or reviewed. |
| `prepared-not-sent` | EWAI revealed the ZIP and requested the default email client. | That the ZIP was attached or the email was sent or delivered. |
| `attempted` or `failed` | A registered provider invocation was recorded. | That the provider accepted or retained the package. |
| `accepted` | The provider acknowledged the exact package digest. | That anyone triaged, resolved or closed the issue. |
| `archived` | The safe report record was retained locally and removed from active work. | That its ZIP remains available or any external copy was recalled. |

## Automatic local drafts

Automatic local drafts are disabled by default. When enabled, supported EWAI failures create bounded, path-free, deduplicated local drafts. Capture failures are isolated so they cannot replace or mask the original EWAI error.

Review an automatic draft before finalising it. Automatic capture never adds raw logs, prompts, responses, source files, environment values, credentials or persona bodies, and it never performs a transport action.

## Review and finalise

Before finalising:

1. Check the title, expected behaviour, actual behaviour and reproduction steps.
2. Remove client information, secrets, personal data and other unnecessary detail.
3. Inspect the exclusion summary. EWAI excludes credentials, environment values, absolute paths, repository names, source and SPECS content, raw logs, prompts and responses, and persona bodies.
4. Finalise only when the bounded content explains the problem without exposing project material.

Finalisation creates a deterministic immutable ZIP containing a manifest, summary, bounded diagnostics and redaction report. EWAI shows both the logical package digest and exact archive digest. Editing a finalised report creates a new draft revision and leaves the earlier ZIP unchanged.

## Prepare a manual email

Select a finalised report and choose **Prepare email**. EWAI confirms the exact digest, asks the operating system to reveal the ZIP and opens the default email client with a subject and safe body.

The state is `prepared-not-sent`. EWAI cannot prove that the ZIP was attached or the message was sent. You must:

1. inspect the recipient and email body;
2. attach the revealed ZIP manually;
3. confirm the attached filename and digest correspond to the selected revision;
4. send the message yourself.

If the operating system cannot open one of those applications, copy the package location from the dashboard and create the email manually. No paid service is required.

## Use a provider adapter

A registered generic provider adapter can transport the exact ZIP to a commercial or organisation-owned system. EWAI includes the interface, not vendor connectors. Registration is an explicit trusted-code decision, and sending requires confirmation plus the exact archive digest.

The dashboard distinguishes attempts from receipts. A failed attempt remains visible. An accepted receipt proves that the provider acknowledged the exact digest; it does not prove that anyone reviewed, fixed or closed the problem.

See [Error Reporting provider guide](error-reporting-provider-guide.md) for implementation and trust requirements.

## CLI equivalents

Use [Error Reporting CLI reference](cli-reference.md) for automation and troubleshooting. The `$ewai-error-reporting` skill follows the same lifecycle and custody boundaries.

## Archive and deletion

Archiving retains a safe archived report record and removes the working draft and package material. If the ZIP must be retained, copy it to an approved location before archiving. Deletion removes local report material and requires explicit confirmation. Neither action recalls an email attachment or deletes material already accepted by an external provider. Provider attempts and receipts remain as transport evidence.

## Troubleshooting

- If the dashboard does not show a newly created report, refresh the workspace and compare it with `ewai error-report status --project . --json`.
- If email preparation cannot reveal the ZIP or open a client, use the package location shown by EWAI and prepare the email manually.
- If a provider attempt fails, inspect its bounded reason class and the provider's own safe operational logs. Retrying creates a new attempt rather than rewriting history.
- If a finalised package needs different content, create a new draft revision. Do not modify the existing ZIP.
- If automatic drafts are too noisy, disable the setting; existing drafts remain local until explicitly archived or deleted.

For accountable acceptance of the complete workflow, follow the project delivery's `qa-walkthrough.md`. Automated checks and provider receipts do not substitute for Manual QA.
