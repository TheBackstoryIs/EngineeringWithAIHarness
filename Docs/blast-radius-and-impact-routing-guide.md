# Blast Radius and Impact Routing guide

Use Blast Radius before changing an existing capability when you need to understand which repository paths, people, standards, and review responsibilities may be affected.

The assessment is deliberately advisory. It combines bounded repository evidence with clearly labelled inference, then asks a named person to decide which reviews are appropriate. It does not approve Build, security, compliance, release, or Manual QA.


<!-- editorial: contents -->
## On this page

- [What the assessment answers](#what-the-assessment-answers)
- [When to use it](#when-to-use-it)
- [Before you begin](#before-you-begin)
- [Step 1: check the repository map](#step-1-check-the-repository-map)
- [Step 2: describe the proposed change](#step-2-describe-the-proposed-change)
- [Step 3: provide files or symbols](#step-3-provide-files-or-symbols)
- [Step 4: analyse impact](#step-4-analyse-impact)
- [Understand coverage before deciding](#understand-coverage-before-deciding)
- [Override a recommendation responsibly](#override-a-recommendation-responsibly)
- [Record the assessment](#record-the-assessment)
- [Use the result downstream](#use-the-result-downstream)
- [Worked examples](#worked-examples)
- [Troubleshooting](#troubleshooting)
- [Assessment checklist](#assessment-checklist)
- [Related guides](#related-guides)
- [Current contract sources](#current-contract-sources)

## What the assessment answers

Blast Radius helps answer four related questions:

1. **What repository evidence is connected to the proposed change?**
2. **What consequences might follow from that evidence?**
3. **Which installed perspectives are useful for challenging the assessment?**
4. **Which accountable people should review the change?**

It does not prove that every dependency has been found. Dynamic calls, runtime configuration, external systems, generated code, human processes, and undocumented relationships may sit outside the repository map.

## When to use it

Run an assessment:

- while shaping an intent that changes existing behaviour;
- before Plan when the likely implementation area is known;
- when a proposed change touches permissions, data, public interfaces, operational behaviour, or a user journey;
- when new repository evidence materially changes an approved plan;
- before choosing Manual QA scenarios for a cross-cutting change;
- after refreshing a stale repository map;
- when a seemingly small refactor may have several consumers.

Repeat the assessment when the proposed behaviour, selected targets, repository index, or material implementation boundary changes. A previous assessment remains historical evidence; it is not an assurance statement about later code.

## Before you begin

You need:

- an EWAI work item that can be selected in the project dashboard;
- a concrete description of the proposed behavioural change;
- at least one repository-relative path or symbol that represents the likely change boundary;
- a fresh repository map;
- a person willing to review the result and own the routing decisions.

Open the project dashboard, select the relevant work item, and open its **Impact** tab.

## Step 1: check the repository map

The Impact workspace states whether the Repository Source Map is fresh and reports its explicit outcomes, analysis depths, profile provenance, and a bounded sample of files needing attention.

If the map is stale or unavailable, select **Refresh repository map**. Refresh is an explicit operation because indexing can be expensive. The proposed-change draft is preserved, but any previous preview is cleared because its evidence belonged to the older index run.

A fresh map means the assessment is based on the current indexed project state and effective profile catalogue. It does not mean that every file was deeply analysed or that every runtime dependency or business process is represented. Explicitly partial Power Platform or Salesforce metadata also keeps the assessment partial even when its document parsed successfully. Review the full [Repository Source Map guide](repository-source-map-guide.md) and [platform export analysis guide](platform-export-analysis-guide.md) when coverage is partial.

## Step 2: describe the proposed change

Describe the behaviour and intent, not merely an implementation instruction.

Prefer:

> Allow delegated users to request access through the customer access form, with an auditable permission decision and clear failure guidance.

Avoid:

> Change `if` statement on line 42.

The summary helps EWAI classify possible user, interface, data, security, operational, maintainability, testing, documentation, and training consequences. The current limit is 2,000 characters.

State an explicitly internal change honestly. For example:

> Refactor the internal sorting helper without changing behaviour or public interfaces.

This helps prevent an internal refactor from being treated as a user-facing product change. It is still the assessor's responsibility to verify that the claimed boundary is true.

## Step 3: provide files or symbols

The paths below illustrate the fictional customer-access application. Replace them with paths returned from your own repository search; they aren't files to create and don't refer to EWAI's implementation.

Enter one repository-relative path or symbol per line. Exact repository-relative paths are the clearest starting points:

```text
src/permissions/access.ts
confirmImpactAssessment
public/app.js
```

The current assessment accepts between one and twelve unique targets. Each target must be no longer than 240 characters. Absolute paths, URLs, traversal such as `../`, and paths beginning with `./` are rejected.

EWAI resolves targets in this order:

1. exact file path;
2. exact symbol name;
3. a unique path suffix or partial symbol match.

An unresolved target remains visible as a coverage limitation. An ambiguous target lists bounded candidates. Prefer an exact path or a more specific symbol rather than choosing based on guesswork.

## Step 4: analyse impact

Select **Analyse impact**. Preview is write-free: it does not create assessment evidence or change a delivery approval.

Read the result in three bands.

### Observed: repository evidence

The observed band begins with the resolved targets and follows recognised imports in both directions:

- **downstream dependency** — the current path imports another indexed path;
- **upstream consumer** — another indexed path imports the current path;
- **seed** — a path resolved directly from the supplied target.

Traversal is intentionally bounded to two relationship steps and eighty nodes. Each result includes its direction, distance, relationship, and repository-relative path.

The graph is evidence about indexed source relationships. It is not a claim that every shown file must change, and absence from the graph is not proof that a file, service, person, or workflow is unaffected.

### Inferred: possible consequences and active perspectives

EWAI classifies possible impact areas from the proposed-change summary and bounded repository evidence. These consequences are labelled **inferred**. Review them as hypotheses to confirm, correct, or reject.

Attached standards may also appear. Their presence means the standard may be applicable to the affected evidence; it does not establish compliance.

The active persona ensemble can include up to four relevant installed personas from:

- core EWAI personas;
- the installed premium library;
- reusable personal personas;
- local project personas, including approved organisation-specific personas.

For every active persona, the UI shows its name, tier, matched concerns, and engagement reason. Tier communicates provenance, not rank or authority. The assessment exposes safe persona metadata rather than proprietary persona definitions or filesystem paths.

Personas help identify missing questions, failure modes, and stakeholder consequences. They do not provide stakeholder evidence or make the routing decision. If no installed persona matches, involve the relevant real person rather than treating the empty ensemble as proof that no specialist review is needed.

### Decided: human review routes

EWAI recommends one of `required`, `recommended`, or `not indicated` for each route:

| Route | What the reviewer contributes | What the route does not do |
| --- | --- | --- |
| Product Owner | Confirms user, outcome, public-interface, acceptance, documentation, or training consequences. | Approve Build. |
| Security or identity owner | Reviews security, identity, permissions, privacy, or data boundaries. | Certify security or compliance. |
| Service operator | Reviews runtime, support, recovery, logging, and operational consequences. | Approve release. |
| Maintainer | Reviews dependencies, tests, implementation quality, and a broad or truncated technical radius. | Replace product or assurance review. |
| User validation | Tests user-visible consequences with representative people. | Allow persona simulation to replace human evidence. |

Review every route. A recommendation is a prompt for accountable judgement, not an automatic workflow assignment.

## Understand coverage before deciding

Coverage is reported as complete only within the configured bounds when:

- the Source Map contains no inventory-only, shallow, sensitive, oversized, or failed evidence;
- every supplied target resolved unambiguously;
- graph traversal did not reach the node limit.

Coverage is partial when any target is unresolved or ambiguous, any evidence is less than deep, an indexed file was deliberately unopened or failed analysis, or traversal was truncated. Treat a narrow result under partial coverage as uncertainty—not proof of low impact.

Before recording a decision, ask:

- Did we choose the correct change boundary?
- Are generated code, runtime wiring, external services, data migrations, or manual processes missing from the repository graph?
- Does the summary state the intended behavioural effect clearly?
- Do the inferred consequences match the evidence?
- Are the active perspectives relevant, and which real perspectives are missing?
- Is further archaeology or specialist review needed before planning?

## Override a recommendation responsibly

You may change a route recommendation when project evidence supports a different decision. EWAI requires a rationale for every override.

A useful rationale names the evidence and the boundary:

> Product review is not indicated because this replaces an internal helper behind an unchanged public contract; existing contract and journey tests remain unchanged.

An inadequate rationale merely restates the selection:

> Not needed.

If the evidence is too weak to explain an override, retain the safer route or gather the missing evidence first.

## Record the assessment

To record the result:

1. review the observed evidence, coverage statement, inferred consequences, active personas, and every route;
2. enter the name of the assessor;
3. supply a rationale for each changed recommendation;
4. acknowledge the evidence and coverage limits;
5. select **Record assessment**.

EWAI recomputes the preview against the current repository map rather than trusting browser-supplied analysis. If the index changed after preview, the confirmation is rejected and the assessment must be run again.

A successful confirmation writes content-addressed JSON and Markdown under:

```text
SPECS/6.Build/<intent-slug>/impacts/<assessment-id>.json
SPECS/6.Build/<intent-slug>/impacts/<assessment-id>.md
```

The record includes the proposal, targets, repository run, coverage, observed paths, inferred areas, applicable standards, active personas, recommendations, human decisions, rationales, assessor, time, and authority boundary.

Evidence is immutable. Repeating the same decision returns the existing assessment; EWAI does not overwrite an incomplete, conflicting, or tampered record.

## Use the result downstream

An impact assessment should inform—not silently mutate—later work:

- update intent journeys or acceptance criteria when a product consequence is confirmed;
- involve the selected accountable reviewers;
- add affected standards and constraints to planning evidence;
- create test obligations for important paths and failure modes;
- use confirmed user-visible consequences to choose Manual QA scenarios;
- add documentation, training, migration, support, or recovery work where required;
- repeat the assessment if implementation crosses the assessed boundary.

Do not treat an assessment ID as approval evidence for another gate. Build approval, specialist assurance, release authorisation, and Manual QA each retain their own owner and evidence.

## Worked examples

### Bounded internal refactor

**Proposal:** Refactor an internal helper without changing behaviour or public interfaces.

**Targets:** the helper path and its exported symbol.

Expected review focus:

- verify consumers and tests in the observed radius;
- engage a maintainer perspective;
- confirm that user and public contracts really are unchanged;
- avoid forcing Product Owner review when no product consequence is evidenced.

### User-facing permission change

**Proposal:** Change which delegated users can submit an access request and how rejection is explained.

**Targets:** the form, permission service, and relevant endpoint or handler.

Expected review focus:

- Product Owner review of journey and acceptance consequences;
- security or identity review of the permission boundary;
- representative user validation;
- negative, cross-boundary, audit, recovery, and accessible-error scenarios;
- documentation or training changes where the user guidance changes.

### Operational recovery change

**Proposal:** Change retry and logging behaviour when a background operation fails.

**Targets:** the worker, retry policy, and logging adapter.

Expected review focus:

- service-operator review of recovery, observability, and support impact;
- maintainer review of dependencies and regression coverage;
- data or security review if payloads or sensitive values could reach logs;
- a Manual QA or operational exercise that demonstrates recovery rather than only a passing unit test.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Repository map is stale or unavailable | Refresh it explicitly, then analyse again. |
| Target is unresolved | Check spelling, use an indexed repository-relative path, or refresh after adding the file. |
| Target is ambiguous | Use an exact path or a more specific exported symbol. |
| Coverage is partial | Resolve what you can, inspect parser failures or truncation, and record remaining uncertainty. |
| An expected persona is absent | Check that the persona is installed and relevant to the supplied signals; involve the real stakeholder regardless. Do not download premium content implicitly. |
| A recommendation appears wrong | Improve the proposal and targets if the evidence is wrong; otherwise override with a specific evidence-based rationale. |
| The repository map changed before confirmation | Re-run the analysis against the new index run. |
| Existing evidence is incomplete or conflicting | Preserve it and investigate; the immutable writer will not overwrite it. |

For index or dashboard failures, use [Troubleshooting and recovery](operations/troubleshooting-and-recovery.md).

## Assessment checklist

- [ ] The repository map is fresh.
- [ ] The proposal describes behaviour and intent.
- [ ] Targets are exact and cover the likely change boundary.
- [ ] Unresolved, ambiguous, failed, or truncated coverage is understood.
- [ ] Observed evidence is distinguished from inferred consequences.
- [ ] Active persona names, tiers, concerns, and reasons were reviewed.
- [ ] Missing real stakeholder perspectives were identified.
- [ ] Every review route has a deliberate decision.
- [ ] Every override has an evidence-based rationale.
- [ ] The named assessor reviewed and acknowledged the limits.
- [ ] The assessment record is used as input, not as another gate's approval.
- [ ] Material scope changes trigger a fresh assessment.

## Related guides

- [Product Owner guide](product-owner-guide.md)
- [Developer delivery guide](developer-delivery-guide.md)
- [Repository Source Map](repository-source-map-guide.md)
- [Power Platform and Salesforce export analysis](platform-export-analysis-guide.md)
- [Persona engagement UI](personas/persona-engagement-ui.md)
- [Manual QA and acceptance](quality/manual-qa-and-acceptance.md)
- [Existing-project onboarding](existing-project-onboarding-guide.md)
- [Human approval and assurance](human-approval-and-assurance-guide.md)

## Current contract sources

- `src/runtime/impact-analysis.mjs`
- `src/runtime/repository-index.mjs`
- `src/runtime/persona-engagement.mjs`
- `src/runtime/dashboard-server.mjs`
- `public/app.js`
- `tests/impact-analysis.test.mjs`
- `tests/runtime.test.mjs`
