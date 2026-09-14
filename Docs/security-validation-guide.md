# Security validation guide

EWAI security validation coordinates evidence from security tools, records findings and accountable decisions, and can make configured evidence part of release readiness. It does not install scanners, certify a system, or replace professional security judgement.

> Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.

You'll see this warning in the CLI, dashboard and API results, including error states. It explains the limit of tool-generated evidence: a result isn't certification, and release still needs qualified human review.


<!-- editorial: contents -->
## On this page

- [Choose your route before configuring a profile](#choose-your-route-before-configuring-a-profile)
- [What the capability produces](#what-the-capability-produces)
- [1. Define the project policy](#1-define-the-project-policy)
- [2. Choose an integration mode](#2-choose-an-integration-mode)
- [3. Working with Agentic Security](#3-working-with-agentic-security)
- [4. Working with DeepSec](#4-working-with-deepsec)
- [5. Working with Visa Vulnerability Agentic Harness (VVAH)](#5-working-with-visa-vulnerability-agentic-harness-vvah)
- [6. Review findings and record decisions](#6-review-findings-and-record-decisions)
- [7. Understand release readiness](#7-understand-release-readiness)
- [8. Use the dashboard safely](#8-use-the-dashboard-safely)
- [Troubleshooting](#troubleshooting)
- [Contract references](#contract-references)

## Choose your route before configuring a profile

- **Supplied adapter:** obtain the reviewed executable package from its owner, then validate and explicitly register it. A profile naming an adapter doesn't install one.
- **External skill or provider:** prepare a handoff, run the external workflow separately under its own authority, then translate its actual results into the EWAI response contract.
- **Supported artefact import:** use the fixed provider-specific files described below. Arbitrary exports and VVAH outputs don't automatically qualify.
- **Write an integration:** start with the [authoring reference](reference/security-adapter-authoring.md), not a bare provider name in configuration.

Trusted adapters aren't OS-sandboxed. Review the tool's permissions, data handling, potential costs and source-modifying behaviour before execution. The provider cautions below remain part of that review.

## What the capability produces

For each configured security capability, EWAI can produce:

- an immutable run record tied to an exact repository or safe target revision;
- bounded attempt metadata, safe tool identity and explicit redaction status without raw provider output;
- normalised findings that keep scanner severity separate from EWAI policy consequence;
- append-only human dispositions with a named reviewer and reason;
- a current, stale, missing, incomplete, failed or cancelled coverage result;
- a release-readiness assessment explaining every blocking reason.

No findings means only that EWAI has no normalised findings for the selected evidence. It does not mean that the system is secure.

## 1. Define the project policy

Add `security_validation` to the project’s configured `SPECS/pipeline.yaml`. Security validation is additive: projects without this section keep their existing release semantics.

```yaml
security_validation:
  enabled: true
  profiles:
    - id: source-review
      capability: source-static
      required: true
      freshness_hours: 24
      timeout_seconds: 300
      accountable_role: Security Lead
      modes: [command, skill, artifact-import]
      provider: deepsec
      adapter: org.example.security
      checkpoint: release
      thresholds:
        blocking_severities: [critical, high]
      scope:
        include: [src, tests]
        exclude: [tests/fixtures]

    - id: agent-red-team
      capability: llm-runtime-red-team
      required: false
      freshness_hours: 24
      timeout_seconds: 600
      accountable_role: AI Assurance Lead
      modes: [skill, artifact-import]
      provider: agentic-security
      checkpoint: release
      target_class: staging
      target_ref: internal-staging-agent

    - id: visa-source-review
      capability: source-static
      required: false
      freshness_hours: 24
      timeout_seconds: 600
      accountable_role: Security Lead
      modes: [skill]
      provider: visa-vvah
      checkpoint: release
      scope:
        include: [src, packages]
        exclude: [tests/fixtures]
```

Supported capabilities are:

- `source-static`
- `dependency-sbom`
- `secret-detection`
- `infrastructure-configuration`
- `llm-runtime-red-team`

Required profiles must define `freshness_hours`. `thresholds.blocking_severities` defaults to `critical` and `high`; scanner severity and confidence remain separate from that project policy consequence. Scope accepts bounded project-relative `include` and `exclude` lists. A required profile is current only when its latest complete evidence matches the server-resolved revision and snapshotted profile policy, remains within the freshness window, and has no unresolved blocking finding. Runtime red-team profiles must use a preconfigured safe target; production targets are denied by default.

Check the resulting contract:

```bash
ewai security status --project .
ewai security status --project . --json
```

## 2. Choose an integration mode

### Registered command adapter

Use a command adapter when an organisation has a reviewed local wrapper that can accept EWAI’s request contract and return its response contract. EWAI does not accept an arbitrary command line.

If your organisation supplies a reviewed adapter folder, validate it before registration using the commands below. If you're writing a wrapper, use the [adapter authoring reference](reference/security-adapter-authoring.md) for the full manifest, a minimal non-passing executable and versioned schemas.

```bash
ewai security adapter-validate ./internal/security-adapter --project .
ewai security adapter-register ./internal/security-adapter --project . --yes
ewai security adapters --project .
```

Registration pins the trusted folder, manifest and a bounded digest of the complete adapter package. A helper-file, executable or manifest change therefore creates digest drift. A changed package is rejected under the same version; after human review, publish a new manifest version and register it explicitly.

Run the profile:

```bash
ewai security run source-review --mode command --project . --yes
```

EWAI starts the exact registered executable directly, without a shell. It sends the versioned JSON request on standard input, bounds execution time and output size, validates the complete JSON response, rejects credential-shaped values, and stores only normalised evidence. Safe tool name/version and a `safe-fields-only` redaction status are retained; raw standard output and standard error are not stored.

### Skill handoff

Use skill mode when Agentic Security, DeepSec, Visa VVAH or another compatible system is orchestrated outside EWAI. The command prepares a revision-bound handoff containing the capability, project-relative scope and expected response contract:

```bash
ewai security run source-review --mode skill --project . --yes --json
```

The result is `awaiting-evidence`. A handoff is not a successful security result and does not satisfy readiness. The external skill or process must return a valid `ewai.security-scan-response/v1` result through an organisation-owned integration before EWAI can record evidence.

### Project-local artefact import

Use artefact import when a provider or organisation-owned export process has already produced a supported JSON report inside the project. EWAI only discovers fixed project-local locations and rejects symlinks, incomplete sets, changing files and caller-supplied paths.

Supported v1 import locations are:

| Provider | Required project-local artefacts |
| --- | --- |
| Agentic Security | `.agentic-security/findings.json` and `.agentic-security/last-scan.json` |
| DeepSec | `.deepsec/report.json` |

Visa VVAH is intentionally not in this table. Its scan outputs use dynamic filenames and EWAI does not yet provide a native, revision-verifying VVAH parser. Configure `modes: [skill]` and translate reviewed findings through the versioned response contract instead.

Prepare the import first:

```bash
ewai security import-prepare source-review --provider deepsec --project . --json
```

Review the provider, profile, revision and detected artefacts. Then use the returned five-minute, single-use discovery token:

```bash
ewai security import DISCOVERY_TOKEN --project . --yes
```

The dashboard follows the same two-step flow. The browser never sends a path: the server discovers the allowlisted files, issues the token and rechecks the files before import. Provider evidence must declare the exact revision captured during preparation; a missing or different revision is rejected rather than relabelled as current evidence.

## 3. Working with Agentic Security

Get Agentic Security from its [official repository](https://github.com/Clear-Capabilities/agentic-security). EWAI’s catalogue describes its broad fit across source, dependency, secret, infrastructure, agent and LLM security surfaces. Check the current upstream documentation and licence before installation or commercial use.

EWAI does not install, redistribute, configure, license or endorse Agentic Security. An organisation can integrate it through a reviewed command adapter, a skill handoff, or an exporter that writes the supported project-local artefacts. Treat all results as untrusted input until EWAI validates them, then require a qualified human to review the normalised evidence.

If the expected artefacts are absent, run:

```bash
ewai security providers --project .
```

The output reports `not-detected`, links to the official source, and describes the provider’s broad capabilities and cautions. It does not offer an install button.

## 4. Working with DeepSec

Get DeepSec from the [official repository](https://github.com/vercel-labs/deepsec) or inspect its [npm package](https://www.npmjs.com/package/deepsec). Follow the current upstream setup instructions, including its own project initialisation where applicable.

DeepSec is suited to agent-powered source vulnerability investigation and can support resumable scans, revalidation, diff review, and Markdown or JSON reporting. Treat it like a coding agent with shell access. Model use can be expensive on large repositories, and optional sandbox execution may upload a working-tree archive, so review credentials, cost, data handling and repository sensitivity before use.

EWAI does not install, configure, license or endorse DeepSec. Use a reviewed adapter or an organisation-owned export step to translate its current output into EWAI’s response or `.deepsec/report.json` import contract.

## 5. Working with Visa Vulnerability Agentic Harness (VVAH)

Get VVAH from Visa’s [official repository](https://github.com/visa/visa-vulnerability-agentic-harness) and follow the current upstream setup and licensing guidance. EWAI only provides the provider identity, project-local signal discovery, revision-bound skill handoff and evidence contract. EWAI does not install or invoke VVAH, collect its model credentials, run its remediation stages or certify its output.

Use a skill-only profile:

```yaml
security_validation:
  enabled: true
  profiles:
    - id: visa-source-review
      capability: source-static
      required: true
      freshness_hours: 24
      timeout_seconds: 600
      accountable_role: Security Lead
      modes: [skill]
      provider: visa-vvah
      checkpoint: release
      scope:
        include: [src, packages]
        exclude: [tests/fixtures]
```

Prepare the revision-bound handoff from EWAI:

```bash
ewai security run visa-source-review --mode skill --project . --yes --json
```

The returned handoff identifies the exact revision, requested `source-static` capability, project-relative scope and required `ewai.security-scan-response/v1` response contract. It remains `awaiting-evidence`; preparing it does not run VVAH or satisfy release readiness.

### Use VVAH in detection-only mode

From the independently installed VVAH environment, target the repository and stop before its remediation stage:

```bash
vvaharness scan --repo /path/to/project --stop-after s9
```

The `--stop-after s9` boundary is material. A plain upstream scan can continue into stage S10, where VVAH attempts remediation and can edit target source. EWAI’s handoff is deliberately evidence-only, so any source-changing VVAH workflow must be separately authorised and managed outside this integration.

VVAH commonly writes reports below `security-scan/` and may write a `run_manifest.json`. EWAI can identify those project-local signals and show the provider as `artefacts-detected`, but it does not offer the native import action. Dynamic Markdown, SARIF or JSONL files must not be relabelled as EWAI evidence directly.

### Return findings to EWAI

Use an organisation-controlled translator to map the reviewed VVAH result to `ewai.security-scan-response/v1`. The response must retain the handoff run identity, requested capability and exact revision semantics, and must contain only bounded normalised findings. Feed those findings through EWAI’s existing review and disposition workflow.

For a valid issue, select `remediate` and create a security intent from the finding. That intent enters the normal governed delivery pipeline and still requires explicit Build approval. A false-positive decision, accepted risk or escalation remains an append-only accountable human decision with supporting evidence; VVAH cannot grant any of those decisions itself.

Before use, review these upstream operating characteristics:

- source-derived prompt data can be sent to configured model providers;
- local execution may require elevated privileges;
- large scans can be token-intensive and results are nondeterministic;
- findings and proposed fixes are triage candidates requiring qualified human review;
- VVAH does not replace compiling, building, testing, Manual QA or release acceptance for changed code.

## 6. Review findings and record decisions

Inspect evidence before making a decision:

```bash
ewai security runs --project .
ewai security findings --project .
ewai security dispositions --project .
```

Prepared and active runs can be cancelled without deleting attempt history:

```bash
ewai security cancel RUN_ID --project . --yes
```

An active cancellation ends as `cancelled`, not `failed`, and cannot satisfy a required profile.

Available append-only dispositions are:

- `remediate`: the issue remains open until later evidence proves the change;
- `false-positive`: requires a named reviewer, reason and an existing non-symbolic project evidence reference;
- `accept-risk`: requires existing project evidence, a named risk owner and a future review or expiry date;
- `escalate`: requires the next accountable role.

Examples:

```bash
ewai security disposition FINDING_ID \
  --decision false-positive \
  --reviewer "Priya Shah" \
  --reason "The sink is unreachable in the deployed configuration." \
  --evidence SPECS/3.Evidence/security/source-review.md \
  --project . \
  --yes

ewai security disposition FINDING_ID \
  --decision accept-risk \
  --reviewer "Priya Shah" \
  --reason "Compensating controls reduce exposure while replacement is scheduled." \
  --evidence SPECS/3.Evidence/security/risk-142.md \
  --risk-owner "Engineering Director" \
  --expires-at 2026-10-01T09:00:00Z \
  --project . \
  --yes
```

Dispositions do not alter or delete scanner findings. The latest valid disposition informs readiness, while the full decision history remains available. An expired risk acceptance becomes blocking again.

## 7. Understand release readiness

When security validation is not configured, readiness is `not-configured` and existing delivery behaviour is preserved. Build approval snapshots the complete normalised security policy into the durable approval evidence. A later policy removal, weakening, scope change or threshold change blocks release readiness explicitly; it cannot reinterpret old evidence or silently restore legacy behaviour. Once a required profile is configured, EWAI withholds its release-ready lifecycle event when evidence is missing, incomplete, failed, cancelled, stale, revision-mismatched, policy-mismatched, or contains an unresolved blocking finding.

Manual QA is still recorded independently. Security readiness does not grant Build approval, Manual QA approval, production authority or business acceptance. The accountable role named in each profile reviews the provider scope and limitations; the authorised human release owner makes the final release decision.

## 8. Use the dashboard safely

Enable **Security Validation** in **Configuration** and save, then open it in the sidebar. See [dashboard configuration](operations/dashboard-configuration.md). Showing the view doesn't run a scanner; hiding it doesn't waive the project's security requirements. The workspace presents information in this order:

1. the mandatory assurance notice;
2. provider availability, official sources and cautions;
3. the personas actively engaged as advisory lenses;
4. capability coverage and evidence freshness;
5. findings and append-only human decisions.

Premium, core, project and personal personas may be engaged contextually when installed. Their names, tier and engagement reason are visible. Personas can challenge scope and identify questions, but they cannot approve evidence or accept risk.

Use the project-local dashboard and confirm the specific operation before execution or import. EWAI checks the local origin and resolves supported provider imports on the server; the dashboard isn't a place to submit arbitrary commands, paths, hosts or provider URLs. If you're building an integration, follow the [adapter authoring reference](reference/security-adapter-authoring.md) rather than bypassing these boundaries.

## Troubleshooting

### A provider says `not-detected`

Use the official links returned by `ewai security providers`. Install and operate the provider separately, then configure one of the supported interoperability modes. EWAI deliberately does not infer an installation from a global command or PATH entry. For Visa VVAH, detection of `security-scan/` or `run_manifest.json` only indicates project-local output; it does not enable native import.

### Evidence is `stale`

Confirm that the result targets the exact current revision and falls within the profile’s `freshness_hours`. Run or import new evidence rather than changing the stored run.

### An import is rejected

Check that the complete supported artefact set exists at the fixed project-local location, is regular JSON rather than a symlink, remains unchanged during the read, and matches the expected response shape. Prepare a new token after correcting it.

### An adapter stops working after an update

Digest drift is intentional. Validate the changed adapter, review the executable and manifest, then register the revised adapter explicitly.

### A finding was addressed

Record the accountable decision and supporting project evidence, then obtain a fresh complete security result for the current revision. Do not edit the finding or SQLite projection directly.

## Contract references

- Policy schema: [security-validation-policy.schema.json](../config/security-validation-policy.schema.json)
- Adapter schema: [security-adapter.schema.json](../config/security-adapter.schema.json)
- Request schema: [security-scan-request.schema.json](../config/security-scan-request.schema.json)
- Response schema: [security-scan-response.schema.json](../config/security-scan-response.schema.json)
- [Human approval and assurance](human-approval-and-assurance-guide.md)
