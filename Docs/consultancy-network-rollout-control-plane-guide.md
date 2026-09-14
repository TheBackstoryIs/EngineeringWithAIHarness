# Review EWAI adoption across projects

Use **Governed Rollout** to see which projects use your organisation's agreed setup, which need reviewing and who should follow up. It compares the Organisation Blueprint each project has adopted with the version you've agreed for its group. A Blueprint is a bundle of reusable standards and guidance; a group of projects sharing an expected setup is called a **cohort** in the configuration.

The view also shows whether required evidence is present and current. It doesn't judge whether that evidence is good enough: the named reviewer still needs to read it. Relevant personas help that reviewer identify questions worth asking. The CLI and technical references call this capability the **Rollout Control Plane**.

It does not centralise client repositories, replace project governance, modify any child project, or issue an assurance verdict.


<!-- editorial: contents -->
## On this page

- [Read presence separately from quality](#read-presence-separately-from-quality)
- [What it produces](#what-it-produces)
- [Prerequisites](#prerequisites)
- [Supported repository topologies](#supported-repository-topologies)
- [Define the policy](#define-the-policy)
- [Blueprint adoption is exact](#blueprint-adoption-is-exact)
- [Validate and review](#validate-and-review)
- [Evidence and interpretation](#evidence-and-interpretation)
- [Standard LLM and personas](#standard-llm-and-personas)
- [Isolation and redaction](#isolation-and-redaction)
- [Recovery](#recovery)
- [Human authority and mandatory notices](#human-authority-and-mandatory-notices)

## Read presence separately from quality

Here, **structural evidence** means that a record is present, has the expected shape and refers to the expected project/version. It doesn't mean the plan is sound, the implementation is safe or the client accepted it. Open material evidence in the owning project and ask the accountable reviewer to judge it.

## What it produces

`ewai rollout status` returns an `ewai.rollout-workspace/v1` snapshot containing:

- the rollout, Portfolio, cohorts, baselines, assignments, owners, and review dates;
- exact Blueprint adoption states: `aligned`, `review-required`, `not-adopted`, `unavailable`, `stale`, or `invalid`;
- structural state for required `blueprint`, `delivery`, `standards`, `manual-qa`, and `security` evidence;
- a selected-project assurance view that is structural-only and has no adequacy verdict;
- safe next-action routing to named owners;
- standard LLM review questions and the active personas, tiers, matched signals, and engagement reasons; and
- mandatory advisory and security notices.

The dashboard presents the same read-only ledger and focused project context. The CLI, HTTP API, MCP tool, and dashboard share one server-side projection rather than reimplementing rollout logic.

## Prerequisites

Before configuring rollout:

1. initialise the host as an EWAI project;
2. configure repository topology in `SPECS/pipeline.yaml`;
3. create a valid `SPECS/1.Scope/portfolio.yaml` whose project members have stable IDs and named owners; and
4. ensure each readable child is itself an EWAI project if you expect Blueprint or delivery evidence from it.

The Rollout policy refers only to Portfolio project IDs. It does not repeat repository paths.

## Supported repository topologies

Topology belongs to `pipeline.yaml` and Portfolio configuration, not `rollout.yaml`.

### Single repository

The host repository can also be the only project. Configure the repository root as `.` and give its Portfolio project member a stable ID. Assign that ID to a rollout cohort.

### Monorepo

Register safe subpaths such as `services/api` and `apps/web` in `SPECS/pipeline.yaml`. Portfolio project members select the configured repository and, when needed, a bounded project path. Rollout assignments still use only the member IDs.

### Folder with repository subfolders

A host folder can coordinate Git repository subfolders such as `clients/alpha` and `clients/beta`. Register every allowed repository root in `SPECS/pipeline.yaml`, then map each Portfolio project to one of those names. The Rollout reader never discovers arbitrary sibling folders.

### Several separately configured repositories

Where the host configuration already names several allowed repositories, Portfolio provides the safe project mapping and Rollout consumes that resolution. An unavailable repository is reported as `unavailable`; Rollout does not fetch, clone, authenticate, or repair it.

See [Project and Portfolio Orchestration](project-portfolio-orchestration-guide.md) for complete topology examples.

## Define the policy

Create `SPECS/1.Scope/rollout.yaml` beneath the configured SPECS root:

```yaml
schema: ewai.rollout/v1
id: client-delivery-rollout
name: Client delivery rollout
owner: Network Delivery Director
stale_after_days: 30
baselines:
  - id: regulated-web-baseline
    name: Regulated web baseline
    owner: Architecture Council
    pack:
      id: org.example.regulated-web
      version: 2.1.0
      digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
cohorts:
  - id: autumn-adoption
    name: Autumn adoption cohort
    baseline: regulated-web-baseline
    owner: Cohort Lead
    review_by: 2026-10-31
    required_evidence:
      - blueprint
      - delivery
      - standards
      - manual-qa
      - security
    projects:
      - id: client-portal
        owner: Client Portal Owner
        review_owner: Assurance Lead
```

The schema permits at most 25 baselines, 50 cohorts, and 100 unique project assignments. A project can belong to one cohort only. Every baseline, cohort, assignment, and review route needs a named owner.

## Blueprint adoption is exact

The checker compares the exact Blueprint ID and version, plus the digest when the baseline declares one. It does not infer semantic-version precedence or compatibility:

- exact match: `aligned`;
- different ID, version, or required digest: `review-required`;
- no project-owned Blueprint pin: `not-adopted`.

A difference may be intentional, safe, unsafe, or mid-migration. Only the named review owner can decide that; the control plane identifies the decision rather than making it.

## Validate and review

```bash
ewai rollout validate --project . --json
ewai rollout status --project . --json
ewai rollout status --focus "projects with stale Manual QA evidence" --project . --json
ewai rollout assurance client-portal --project . --json
```

- `validate` checks the policy and Portfolio membership without changing either.
- `status` returns the bounded whole-rollout workspace.
- `status --focus` reruns contextual persona selection for the stated concern.
- `assurance PROJECT_ID` returns the same safe workspace with a structural selected-project view.

The equivalent MCP operation is `ewai_rollout_status` with optional `focus` and `projectId`. The HTTP surfaces are `GET /api/rollout` and `GET /api/rollout/projects/:projectId/assurance`. None accepts a repository-root override or mutation.

Start or reuse the dashboard with:

```bash
ewai dashboard --project .
```

Enable **Governed Rollout** in **Configuration** and save, then open it to inspect cohort progress, choose a baseline or cohort, and focus a project. See [dashboard configuration](operations/dashboard-configuration.md). The UI identifies the active personas and displays both authority notices.

## Evidence and interpretation

Keep these classes separate:

| Evidence class | Use |
| --- | --- |
| `declared-policy` | The governed baseline, cohort, assignment, evidence requirement, or owner. |
| `observed-project-evidence` | Allowlisted structural evidence read from a child project. |
| `automated-check` | Exact Blueprint comparison or deterministic freshness state. |
| `persona-hypothesis` | A concern or possible consequence raised by a persona lens. |
| `human-decision` | An actual named human decision within its recorded authority. |

The evidence checks are intentionally structural. Standards `present` means standards files were observed, not that they are adequate. Security evidence exposes configuration and run state, not findings or certification. Manual QA exposes the named-human gate state, not acceptance of a different release.

## Standard LLM and personas

The standard host LLM can perform the complete bounded review. Installed project and core personas can sharpen the baseline analysis. Premium and personal personas are optional: when already installed and relevant, they can join the active ensemble.

Every focused review shows each active persona's name, tier, matched signals, and engagement reason. Change the focus or selected project and refresh the snapshot so EWAI can swap lenses in and out. A premium persona that is absent is never approximated or treated as a blocker, and this feature does not trigger premium installation or synchronisation.

Personas can identify questions and possible blind spots. They cannot impersonate a client, create stakeholder evidence, approve adoption, judge evidence adequacy, accept risk, or replace the named reviewer.

## Isolation and redaction

The public projection exposes stable IDs and bounded structural facts. It excludes:

- absolute roots and unrestricted repository content;
- raw rollout, Blueprint, intent, persona, test, security, or approval documents;
- prompts, credentials, tokens, adapter entrypoints, and validator output;
- detailed security findings, dispositions, accepted risk, and release authority.

Unknown query parameters, unsafe focus values, unknown project IDs, symbolic policy files, excessive files, and topology escapes fail closed with stable errors and both notices.

## Recovery

| State | What it means | Next action |
| --- | --- | --- |
| `not-configured` | No rollout policy exists. | Ask the rollout owner whether one should be created. |
| `invalid` | Policy, Portfolio, topology, or project evidence cannot be safely interpreted. | Fix the reported source contract; do not override the result. |
| `unavailable` | The configured child root or evidence cannot be read. | Route topology to the Portfolio owner and project access to the project owner. |
| `stale` | Delivery evidence is older than `stale_after_days`. | Ask the project owner to refresh project-owned evidence through its normal workflow. |
| `not-adopted` | No exact project Blueprint pin exists. | Ask the project owner and cohort owner whether adoption is intended. |
| `review-required` | The project pin differs from the exact baseline. | Route compatibility or migration judgement to the named review owner. |
| evidence `missing` or `not-configured` | A required class has no qualifying structural evidence. | Use its limitation and owner route; do not reinterpret absence as success. |

Rollout remains read-only during recovery. Make any approved correction in the canonical host or child project, then request a fresh snapshot.

## Human authority and mandatory notices

The control plane does not approve Build or Manual QA, accept risk, certify security, decide Blueprint compatibility, dispatch work, alter project state, deploy, or release. Those decisions remain with the named accountable people in the relevant project and governance process.

> Rollout and persona analysis is advisory. Organisation Blueprint adoption, evidence adequacy, accepted risk, Manual QA, deployment and release decisions remain with named accountable humans.

> Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.
