# OpenAI Decisions beta

Experimental `0.3.4-beta.2` adds OpenAI Decisions to the bounded decision assistance introduced with Jev. Start in shadow mode and compare suggestions before explicitly choosing active mode.

## Private setup

Open Configuration → OpenAI API credentials in the local dashboard, or use a genuine interactive terminal:

```sh
ewai providers credentials openai configure --project .
ewai providers credentials openai status --project . --json
ewai providers credentials openai check --project .
```

The password form and hidden terminal check metadata authentication without inference. This requires models-read permission and does not establish Decisions access, credit or decision quality. A failed replacement retains the saved predecessor. The key is stored outside projects in `~/.ewai/credentials/openai.json`, in an owner-only local file, **unencrypted**. `OPENAI_API_KEY` in the launching environment overrides the saved key. Use that environment route for a restricted key without metadata-read permission. Saving credentials does not enable decision assistance. Do not put keys in chat, arguments, project configuration, SPECS or logs. EWAI never uses Codex OAuth credentials for these calls.

Remove only the saved credential, with the revision from status:

```sh
ewai providers credentials openai remove --expected-revision REVISION --yes --project .
```

An environment override remains active after removing a saved key. Unsafe paths, permissions, links or stale replacement requests fail closed. A valid environment override remains usable when saved storage needs repair; local writes stay unavailable until repaired.

## Choose participation and provider

New projects start **off**, with **Automatic** preference and neither vendor consent. Automatic uses a configured, separately consented OpenAI key first, otherwise a configured, consented Jev key, otherwise local decisions. It is an eligibility choice, not a claim that the account has endpoint access. Installing Codex alone does not authorise API use. Existing Jev policies retain Jev preference and TypeSafe-only consent until explicitly changed.

The dashboard has separate OpenAI and TypeSafe text disclosures. Equivalent CLI setup is:

```sh
ewai decisions configure --provider auto --mode shadow --acknowledge-openai-processing --acknowledge-cloud-processing --yes --project .
ewai decisions status --project . --json
ewai decisions measurements --project . --json
```

Only acknowledge vendors you authorise. Revoke independently with `--revoke-openai-processing` or `--revoke-cloud-processing` (TypeSafe). If no selected vendor consent remains, also choose `--mode off`. Acknowledgement and revocation for the same vendor cannot be combined. Use `--provider openai` or `--provider jev` for an explicit preference. Existing `ewai jev` commands and `/api/jev` routes remain compatible; `ewai decisions`, `/api/decisions` and `ewai_decisions_*` MCP tools expose the same policy and operations. Model-facing MCP tools cannot capture keys.

Both providers are optional. Off makes no paid calls or credential-resolution attempts; unavailable provider credentials do not block the local decision baseline. Ordinary status reports unavailable credentials without losing the other provider’s status. Shadow records suggestions without changing existing automatic decisions. Active can apply eligible context ordering and available persona additions. Required evidence, baseline persona records, mandatory tests, human decisions and canonical impact routes remain protected.

## Supported decisions

The same seven operations support context ordering, available persona recommendations, skills or answer options, claim support, failure triage, supplemental impact review and supplemental test relevance. For bounded options:

```sh
ewai decisions decide --input decision.json --project .
ewai decisions personas --focus 'Review accessibility and credential setup' --limit 4 --project .
```

The project-local JSON contract is documented in the [Jev beta guide](jev-beta-experiment.md). Supported LLM comparisons use `origin: "llm"` and the existing `recommendedId`; results are agrees, disagrees or inconclusive, never factual proof. Only locally available core, project, personal and installed premium personas are considered. No premium download occurs, and persona bodies are excluded from automatic requests. Typed advice cannot execute tools or grant work approval.

## Transport, accounting and limits

OpenAI calls use fixed HTTPS `POST /v1/decisions` with pinned `gpt-6-luna`. The converter maps named choice, zero-based rubric score and predicate arrays into the established operation-facing envelope. Wrong models, names, types, values, distributions, scores, refusals or usage fail safely. Only bounded text is used; no images or external image fetching.

Both vendors share one atomic call and conservative input-byte reservation budget, pending-call records, privacy filters and whole-response deadline. Unknown/imported/denied material is excluded. Provider/model, policy revision and credential identity participate in exact caching and freshness. A provider or key change invalidates stale advice. A failed paid request is never retried against a second vendor. Unknown usage stops further calls within that policy budget and remains unknown in cumulative cost reporting, including after a policy revision. Explicitly saving a new policy starts a new bounded budget.

Numeric measurements identify provider and model and preserve reported input/cache/output details. The base estimate uses Jev USD0.042/M input or OpenAI USD0.10/M input per recorded call. OpenAI estimates precede free-cache adjustments and regional or long-context premiums; these are **not invoices**. Recent history is capped at 500 events while cumulative known input/cost totals cover all recorded calls. Requests, source, keys, instructions and persona bodies are not retained in telemetry.

OpenAI integration is verified with mock transports and synthetic local projects until an owner privately configures a usable key. Live account access, OpenAI quality/latency and completed coding-task token, time or cost savings are unmeasured. Vendor speed statements are not EWAI results. Manual QA and public release remain separate.

Primary protocol and pricing sources: [Decisions guide](https://developers.openai.com/api/docs/guides/decisions), [create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create), [TypeSafe models](https://docs.typesafe.ai/models).
