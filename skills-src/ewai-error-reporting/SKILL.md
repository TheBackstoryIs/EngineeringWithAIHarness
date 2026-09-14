---
name: ewai-error-reporting
description: Create, inspect, finalise and explicitly hand off privacy-safe local EWAI error-report packages. Use when an EWAI command, dashboard action, guided workflow or agent integration fails; when a user asks to report a problem; when local automatic draft capture needs to be configured; or when an exact finalised ZIP must be prepared for manual email or an explicitly registered generic provider adapter.
---

# EWAI Error Reporting

Keep error reporting local-first, inspectable and honest about custody. The base capability requires no hosted service and never transmits a report automatically.

## Method

1. Inspect local state with `ewai error-report status --project . --json`.
2. Create a bounded draft with `ewai error-report create`, or use **Report this problem** in the dashboard. Describe expected behaviour, actual behaviour and reproducible steps without secrets, absolute paths, client data, source, prompts, persona bodies or raw logs.
3. Read the draft with `ewai error-report show REPORT --project . --json`. Inspect its description, diagnostics and redaction summary before finalising it.
4. Revise incorrect narrative fields with `ewai error-report update`. A changed finalised report becomes a new draft revision; never rewrite an immutable package.
5. Finalise with `ewai error-report finalise REPORT --project . --json`. Retain the returned exact archive digest.
6. Choose one explicit handoff:
   - Prepare a manual email with `ewai error-report prepare-email REPORT --expected-digest DIGEST --launch --project . --json`. Treat `prepared-not-sent` literally. Reveal the ZIP, attach the ZIP manually, review the recipients and send it yourself.
   - List registered providers, then use `ewai error-report send REPORT --provider ID --expected-digest DIGEST --yes --project . --json`. Confirm that the provider is trusted local code before sending.
7. Read attempts and receipts with `ewai error-report receipts REPORT --project . --json`. An accepted receipt proves transport of that digest only, not issue resolution.
8. Archive or delete local material only with explicit confirmation. Explain that external provider material cannot be recalled by deleting a local report.

## Automatic local drafts

Automatic local draft capture is opt-in:

```bash
ewai error-report settings --automatic-local-drafts true --project . --json
```

This setting creates deduplicated local drafts only. It does not finalise, email, invoke a provider, attach a file or send anything. Keep the setting separate from every remote handoff decision.

## Custody boundaries

- Store operational material under `.ewai-pipeline/error-reports/`; do not promote it into `SPECS/` or commit it as project truth.
- Use only the closed diagnostic fields supplied by EWAI. Never add environment values, credentials, absolute paths, repository names, source, SPECS bodies, prompts, responses, personas or raw logs.
- Require the exact finalised digest for email or provider handoff. If the report changes, prepare and approve the new revision separately.
- Never claim an email was sent, a ZIP was attached, or a provider accepted a report without the corresponding evidence.
- Treat provider adapters as trusted local code. Registration is an authority decision; package validation is not a security certification.
- Keep error reporting separate from Manual QA, security acceptance, deployment and release authority.

Read [references/provider-contract.md](references/provider-contract.md) only when validating, registering, authoring or troubleshooting a generic provider adapter.

## Stop conditions

Stop before finalisation or handoff when the draft contains sensitive or ambiguous material, the package digest is stale, the intended recipient or provider is unclear, or explicit confirmation is absent. Preserve failure attempts; do not turn them into success receipts.
