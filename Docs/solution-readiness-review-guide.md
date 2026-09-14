# Solution Readiness Review guide

Before deciding what happens next, review the evidence for this delivery. Choose the type of system you're assessing; EWAI brings together the relevant records and shows what's missing or out of date. A named reviewer records the assessment. It doesn't approve a release.

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.

Solution Readiness Review is advisory evidence, not certification, business acceptance, Manual QA approval, security approval, deployment permission or release authorisation. Accountable humans retain every approval and risk decision.

## Choose a profile

| Profile | Use it for | Additional emphasis |
|---|---|---|
| `internal-only` | Bounded internal tools without sensitive or client material | Purpose, standards, testing, Manual QA and operations |
| `internal-sensitive` | Internal solutions handling personal, sensitive or restricted data | Security, privacy, hosting and governance |
| `client-facing` | Client workflows, client material or client-accessible services | Impact, independent validation, documentation and service ownership |
| `public-service` | Publicly accessible services | Accessibility, misuse, availability and broad user impact |
| `critical-regulated` | High-consequence or regulated contexts | Named legal/regulatory specialists and independent assurance |

Profiles change required dimensions and human roles. They never rewrite source evidence or turn an unknown into a pass.

## Before you start

Read the [Manual QA walkthrough guidance](quality/manual-qa-and-acceptance.md) when reviewing human acceptance evidence. Preparing a readiness report can't replace that walkthrough.

- Use a known EWAI delivery slug with durable `delivery-state.json` truth.
- Complete as much normal EWAI evidence as is proportionate: intent, Impact, standards, tests, Manual QA, security, technology/hosting, operations and guidance.
- Install or create project personas when their real responsibilities improve the review.
- Treat a missing evidence source as a valid and visible outcome.

## Run the workflow

```bash
ewai readiness profiles --project . --json
ewai readiness prepare my-delivery --profile client-facing --project . --json
```

Preparation writes:

```text
SPECS/3.Evidence/readiness/<delivery-slug>/<assessment-id>/
├── readiness-brief.json
├── readiness-brief.md
└── readiness-review.template.json
```

Open the briefing and every material citation. Complete the template, then record the named review:

```bash
ewai readiness review <assessment-id> \
  --input SPECS/3.Evidence/readiness/<delivery-slug>/<assessment-id>/readiness-review.template.json \
  --reviewed-by "Accountable owner" \
  --project . \
  --json
```

This adds immutable `readiness-report.json` and `readiness-report.md` files. It never overwrites an earlier report.

Check currency:

```bash
ewai readiness status <assessment-id> --project . --json
```

If the repository revision, selected profile, preparation digest or cited file changes, status is `stale`. Prepare a new assessment and preserve the historical report.

## Interpret the evidence

Dimensions use `satisfied`, `conditional`, `blocking`, `missing`, `stale`, `not-applicable`, or `not-configured`. The reviewer uses `accepted`, `conditional`, `blocked`, `insufficient-evidence`, or `not-applicable`.

Missing, stale, blocking or not-configured required evidence cannot be marked accepted. A condition or residual risk needs a clear statement, accountable owner and future review date.

The report derives one advisory result:

- `ready-for-human-decision`: evidence is coherent enough for the accountable human to make the next decision. This is not that decision.
- `conditional`: owned, time-bounded conditions remain.
- `blocked`: at least one blocker remains.
- `insufficient-evidence`: one or more required decisions cannot be supported by current evidence.

There is no percentage score. Positive dimensions cannot average away a blocker.

## Example: required test results are missing

In the generated `readiness-review.template.json`, keep the assessment ID and preparation digest unchanged. For the `tests` dimension with no usable citations, a completed decision can look like this:

```json
{
  "id": "tests",
  "disposition": "insufficient-evidence",
  "reason": "The required test results aren't available for this revision. The delivery owner needs to run the agreed checks before we can assess them.",
  "sourceRefs": [],
  "conditions": [],
  "residualRisks": []
}
```

This is one item in `dimensions`, not the whole input. Use the actual citations and state returned by preparation and review every required dimension. Don't copy `accepted` over a missing result.

The next action is for the delivery owner to obtain current test evidence, then prepare a new assessment. Naming the gap records the problem; it doesn't run tests or accept risk.

## Active personas

Each preparation shows the active personas and why they're relevant. The host model with included and project personas supports the whole workflow. Relevant installed personal or premium personas can add specialist perspectives as the profile or evidence gaps change.

Premium personas are optional. The command does not sync or download them. Output contains safe metadata, not proprietary persona bodies. Personas improve the questions; they do not provide stakeholder evidence, specialist opinion, legal advice, risk acceptance or approval.

## Evidence drift and recovery

Use `readiness status` before relying on a report. Drift can include a different repository revision, changed or missing cited evidence, a changed profile contract or a digest mismatch.

Do not edit a completed report. Resolve source evidence where appropriate, prepare a new assessment and retain both records. If preparation stops before the assessment directory is atomically created, run preparation again; never remove a completed immutable report as “recovery”.

## For EWAI maintainers

If you're changing the readiness capability itself, use its [maintainer verification walkthrough](maintainers/verification-walkthroughs.md#solution-readiness-review). That is separate from reviewing whether your own solution is ready.

## Limitations

- V1 is CLI- and file-led; there is no dashboard or MCP surface.
- Preparation does not execute scanners, project scripts, deployment tools, cloud queries or runtime probes.
- Built-in profiles are a consistent starting point, not a legal or regulatory rules engine.
- `critical-regulated` records the need for specialist assurance; it does not supply that opinion.
- The capability does not score, certify, deploy, release or alter approval state.
- It does not approve Manual QA or release.
