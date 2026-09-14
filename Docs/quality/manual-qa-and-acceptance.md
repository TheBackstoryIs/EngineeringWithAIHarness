# Manual QA and acceptance guide

Use this guide to turn a technically completed delivery into evidence that an authorised person can inspect and accept.

## Manual QA has a distinct job

Automated tests, standards checks, and external review answer important questions about implementation. Manual QA asks whether the delivered outcome works for people and operations in the intended context.

It remains a separate human gate after the Delivery phase. A green pipeline cannot approve it automatically.

## Define the acceptance decision

Before writing steps, state:

- the outcome being accepted;
- the user or operator journey;
- the environment and version;
- included and excluded scope;
- known limitations and residual risks;
- who may accept the result;
- what happens after pass, failure, or partial acceptance.

Do not ask a tester to “check everything”.

## Prepare a reproducible walkthrough

Include:

1. prerequisites and access;
2. safe test data and reset conditions;
3. exact starting state;
4. numbered actions in user language;
5. expected observable outcomes;
6. negative, boundary, and recovery cases;
7. accessibility and supported-device checks where relevant;
8. operational observation, logs, or alerts where relevant;
9. cleanup and data-retention instructions;
10. a place to record actual results and evidence.

Separate setup commands from the behaviour the tester is judging.

## Choose scenarios from impact

Cover at least:

- the primary happy path;
- one important alternate or error path;
- permissions and organisation boundaries where applicable;
- user-visible consequences identified through [Blast Radius and Impact Routing](../blast-radius-and-impact-routing-guide.md);
- data creation, change, and deletion semantics;
- recovery from a realistic interruption;
- any accepted technical-debt or migration edge.

When a reviewed persona scenario pack exists, use [Persona-driven test scenarios](persona-driven-test-scenarios.md) to select every accepted `manual-qa` or hybrid route assigned to the walkthrough. Preserve its `PTS-###` ID in the result table. A persona may have exposed the scenario, but only the named tester can record the actual result and approve the Manual QA gate.

For a low-risk documentation change, the walkthrough may be a role-based read-through. For a sensitive public capability, it should include deeper security, privacy, accessibility, resilience, and operational evidence.

## Record evidence

A project-owned QA evidence file should contain:

```markdown
# Manual QA evidence

- Intent: <slug>
- Build or commit: <revision>
- Environment: <environment>
- Tester: <name and role>
- Date: <time>

## Results

| Scenario | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- |

## Limitations and residual risks

## Decision

Pass, fail, or returned for correction—with rationale.
```

Use links, screenshots, logs, or recordings only when permitted by data and retention policy. Do not place secrets or unnecessary personal data in SPECS.

## Fail, fix, and rerun

When a scenario fails:

1. preserve the observation and evidence;
2. classify severity and affected scope;
3. decide whether the issue blocks acceptance;
4. return material scope or design changes to the appropriate delivery phase;
5. implement an authorised correction;
6. rerun affected automated checks, standards review, and Manual QA;
7. retain the original failure and the successful retest.

Do not edit the evidence to make the first run appear successful.

## Approve the human gate

After the authorised tester accepts the evidence:

```bash
ewai delivery approve-manual-qa <intent-slug> \
  --project . \
  --yes \
  --approved-by "Tester or accountable owner" \
  --evidence SPECS/6.Build/<intent-slug>/qa-evidence.md \
  --notes "Accepted result and limitations"
```

The evidence file must already exist inside the project. Approval records its hash so later changes are detectable.

## Acceptance is not deployment

Manual QA approval confirms the defined acceptance decision. It does not automatically:

- deploy to production;
- approve a destructive migration;
- authorise a release outside the project's change process;
- certify regulatory compliance;
- accept a later changed build;
- close the retrospective.

Follow the project's release and operational governance after acceptance.

## Reader-based QA for documentation

For guide or policy changes, ask representative readers to complete tasks:

- Can they find the correct starting page?
- Can they distinguish requirements from recommendations?
- Do they know what they own and where to stop?
- Can they follow every link and command example?
- Can they identify project truth, runtime state, and approval evidence?
- Do they know how to recover from likely mistakes?

## Acceptance checklist

- [ ] Decision, scope, environment, revision, and tester are recorded.
- [ ] Steps are reproducible and outcomes observable.
- [ ] Important negative, boundary, and recovery cases are covered.
- [ ] Actual results and failures are retained honestly.
- [ ] Residual risks and untested areas are visible.
- [ ] The approver has authority for this outcome.
- [ ] Evidence is project-owned and free of inappropriate sensitive data.
- [ ] Deployment and Retro remain separate follow-on decisions.

## Related guides

- [Developer delivery guide](../developer-delivery-guide.md)
- [Blast Radius and Impact Routing](../blast-radius-and-impact-routing-guide.md)
- [Persona-driven test scenarios](persona-driven-test-scenarios.md)
- [Human approval and assurance](../human-approval-and-assurance-guide.md)
- [Governance team guide](../governance/governance-team-guide.md)

## Current contract sources

- `src/delivery.mjs`
- `src/delivery-gates.mjs`
- `config/delivery-artifacts.yaml`
- `tests/delivery.test.mjs`
