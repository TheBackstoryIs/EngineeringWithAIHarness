# Worked examples

These compact scenarios demonstrate how to apply EWAI proportionately. They're illustrative decision patterns, not specifications to copy unchanged or exhaustive phase checklists. A stage omitted from an example isn't waived; follow the current delivery's required gates.

For a step-by-step exercise with observable results, try [your first session](../tutorials/first-session.md) and [first delivery](../tutorials/first-delivery.md).

## 1. Start a new internal application

**Situation:** An operations team needs a small case-triage tool.

**Approach:**

1. The Product Owner supplies the current process, users, desired response-time outcome, data classification, and non-goals.
2. Guided Discovery engages product, operator, accessibility, and security perspectives as the sections change.
3. If the organisation provides an applicable internal-application Blueprint, the team reviews it, accepts its required security and testing modules, and declines an irrelevant public-service module. Otherwise, Discovery continues without an Organisation Blueprint.
4. Review shows the exact standards and project personas to be created.
5. A named owner approves Discovery.
6. The first intent delivers one journey: view and assign an untriaged case.
7. Manual QA uses safe test records and checks keyboard access, permissions, exception handling, and operational visibility.

**Key lesson:** Start with one useful journey and the evidence needed to operate it, not a generated backlog for the entire imagined product.

## 2. Onboard a poorly documented legacy system

**Situation:** A team inherits a service with sparse documentation and several years of history.

**Approach:**

1. The owner describes why the service exists, its users, known failures, and what must not be inferred from current code.
2. After briefing and source permissions are agreed, the owner accepts the offer of Archaeology. It maps repositories, entry points, integrations, data, tests, and deployment.
3. The inferred purpose conflicts with one current batch process. The discrepancy is presented before deep analysis.
4. The owner confirms that the batch is a temporary workaround, not intended behaviour.
5. Operations and data personas join the relevant deep passes; their output remains hypothesis until supported.
6. Reviewed findings become canonical SPECS, while the workaround becomes a bounded migration intent.

**Key lesson:** Repository behaviour is strong evidence of what exists, not automatic authority for what should continue.

## 3. Deliver a user-visible feature

**Situation:** Users need to export a filtered report.

**Approach:**

1. Intent records the user outcome, supported filters, data permissions, accessibility, performance expectation, and export retention.
2. The repository index identifies the query, permission, UI, and audit-log blast radius.
3. The plan creates one vertical slice through UI, service, authorization, export generation, and evidence.
4. Build approval names that scope.
5. Automated tests cover permissions, filters, empty results, volume, and formula-safe output.
6. Standards review checks data handling and existing patterns.
7. Manual QA exercises an authorised and unauthorised user, keyboard flow, a large report, and the downloaded result.

**Key lesson:** User-visible acceptance and data-boundary testing belong in the same slice as implementation.

## 4. Make a low-risk technical-debt change

**Situation:** A duplicated parser should be consolidated without changing behaviour.

**Approach:**

1. The intent states the maintainability outcome and an explicit no-user-visible-change constraint.
2. Index and tests identify callers and observable contracts.
3. Reconcile confirms both copies currently behave the same—or records the differences.
4. The plan uses characterization tests as the first failing or safety evidence.
5. Build changes the smallest shared boundary.
6. Manual QA is proportionate: a focused maintainer walkthrough plus one representative user journey.

**Key lesson:** Low risk can reduce ceremony, but it does not justify inventing equivalence or skipping impact evidence.

## 5. Apply a mandatory organisation Blueprint

**Situation:** A regulated project must use the organisation's reviewed baseline.

**Approach:**

1. Guided Setup shows publisher, version, compatibility, required modules, dependencies, digest, and destinations.
2. Required modules cannot be deselected. Optional modules are chosen from actual project applicability.
3. A compliance persona surfaces questions, but a qualified owner confirms applicable obligations.
4. Existing destination conflicts stop application.
5. The team reconciles the existing standard rather than deleting it.
6. Named approval materialises organisation standards, project personas, receipt, and pipeline pin.

**Key lesson:** Mandatory organisational input still requires visible project consequences and accountable adoption.

## 6. Use project and premium personas together

**Situation:** A payments project has a local settlement-operations persona and access to managed specialist personas.

**Approach:**

1. Check-in reports entitlement and that the premium library is installed; no download occurs.
2. In user-outcome sections, a product lens leads.
3. In data and assurance sections, the relevant project payments persona and a matching premium specialist are deliberately considered.
4. The UI displays both names, tiers, concerns, and engagement reasons.
5. The project persona points to existing local operating evidence; it doesn't invent new facts. The premium persona challenges specialist gaps.
6. A real payments owner resolves the decision.

**Key lesson:** Mixed tiers improve perspective coverage, but relevance, evidence, and human authority remain separate.

## 7. Deliver a security-sensitive capability

**Situation:** A public feature processes sensitive personal data.

**Approach:**

1. Discovery records classification, purpose, access model, retention, jurisdictions, threat context, and operational ownership.
2. Candidate compliance findings remain triage until qualified owners confirm them.
3. Security and privacy standards become explicit Build constraints.
4. Plan includes abuse cases, authorization boundaries, logging restrictions, dependency risk, incident visibility, and deletion behaviour.
5. An independent security review is used when configured; if unavailable, the gap is recorded rather than marked passed.
6. Manual QA uses non-production test data and verifies denial, recovery, and audit behaviour as well as the happy path.

**Key lesson:** More AI review does not replace data governance, qualified interpretation, or operational readiness.

## 8. Roll a Blueprint update across projects

**Situation:** An organisation publishes a new major Blueprint version with a changed mandatory API standard.

**Approach:**

1. The publisher releases an immutable version with compatibility, affected modules, migration guidance, and deprecation dates.
2. Catalogue owners identify projects pinned to the earlier version.
3. Each project compares its receipt and materialised standards with the candidate release.
4. One project adopts immediately, one records a time-bound exception, and one remains unaffected because the module does not apply.
5. Each decision is approved and evidenced locally.
6. The old source remains available long enough to interpret historical receipts.

**Key lesson:** A shared release creates review work; it does not create permission to overwrite every consuming project.

## Adapt an example safely

For your own project, replace:

- users and outcomes with direct evidence;
- risk and data classifications with confirmed context;
- personas with the installed relevant catalogue;
- Blueprint and module choices with reviewed local packages;
- tests and Manual QA with observable acceptance criteria;
- approvers with people who have real authority.

Retain the boundaries: personas advise, SPECS holds durable truth, reusable inputs require review, Build requires explicit scope approval, and Manual QA remains human.

## Related guides

- [All EWAI guides](../README.md)
- [Product Owner guide](../product-owner-guide.md)
- [Developer delivery guide](../developer-delivery-guide.md)
- [Organisation rollout](../organisation-rollout-guide.md)
