# Persona-driven test scenarios

Use persona-driven scenarios when a technically plausible test plan may still miss how a user, operator, maintainer, or specialist experiences the outcome. The process is especially useful for permissions, accessibility, privacy, recovery, operational failure, misuse, adversarial behaviour, and role-specific edge cases.

The process does not let personas invent requirements. Evidence establishes the expected behaviour; personas challenge its coverage; a named person accepts or rejects the resulting scenario; and the selected proof route establishes what happened.

Ask EWAI: “Review the test coverage for this intent from the users' and operators' perspectives. Show me what we might be missing.” The `ewai-test-scenarios` skill prepares the brief and uses relevant installed personas. You review the proposed scenarios, check their expected results against accepted requirements and decide which to record. The commands below are optional controls for engineers who want to inspect or repeat the process.

## Understand the authority chain

Keep five layers separate:

1. **Authoritative sources** define accepted journeys, criteria, constraints, standards, planning claims, and test obligations.
2. **Contextual impact evidence** identifies observed or inferred areas worth investigating but does not create an expected outcome by itself.
3. **Persona contributions** expose concerns, gaps, or hypotheses.
4. **Human decisions** accept, block, supersede, or retain a proposal as a hypothesis.
5. **Test evidence** proves the accepted observable result through automation, Manual QA, specialist assurance, or representative-user validation.

If a proposed expected result has no authoritative source, keep it as a blocked or unresolved hypothesis. Return to the Product Owner or relevant accountable person rather than quietly promoting it into the test plan.

## Prepare the scenario brief

EWAI prepares the current concern during the conversation. You can also run preparation directly:

```bash
ewai test-scenarios prepare <intent-slug> \
  --focus "permissions, recovery, and accessibility" \
  --project . \
  --json
```

Preparation reads project-owned intent and delivery evidence. It returns:

- stable source references and a source digest;
- contextual impact evidence when recorded;
- up to four active installed personas;
- each persona's name, tier, matched concerns, and engagement reason;
- honest availability for core, premium, personal, and project tiers;
- the allowed scenario, status, automation, and evidence-route values.

Preparation is read-only. It does not call an LLM, download premium content, mutate an approval, or create a scenario pack.

## Work with the active personas

EWAI shows which personas are active and the concern each is examining before they contribute challenges. Check that these perspectives cover the problem you want reviewed; ask for a different focus if they don't.

When you change the focus, EWAI prepares a new relevant set rather than accumulating personas from earlier topics. If you're using the CLI, run preparation again for the new focus. A project or premium persona is prioritised when its metadata matches, but its tier never grants authority.

Premium personas participate only when already installed. If premium is unavailable, you can continue with relevant project, personal and core personas. This workflow doesn't install or synchronise premium content; use the separate [premium setup](../operations/premium-personas-setup.md) workflow if you want to add it.

For each proposed scenario, capture:

- stable `PTS-###` ID and plain-language title;
- scenario type;
- cited authoritative source references;
- persona ID and the concern it contributed;
- preconditions and user- or operator-centred actions;
- observable expected results;
- evidence route and automation classification;
- planned test file and test name where automation applies;
- owner and status.

Use the [complete scenario input example](../examples/test-scenario-input.md) and [v1 candidate contract](../../skills-src/ewai-test-scenarios/references/scenario-contract.md#candidate-schema). The `ewai-test-scenarios` skill normally prepares the input with you; these references are available without first finding an installed skill directory.

## Review before recording

A named reviewer should:

1. remove duplicate scenarios without losing distinct concerns;
2. compare every expected result with its cited source;
3. preserve disagreements and missing authority as gaps;
4. decide whether the scenario is accepted, blocked, superseded, or a hypothesis;
5. select the credible proof route;
6. name the owner and planned automated test where applicable;
7. confirm that human evidence has not been simulated.

Then record the project-local candidate:

```bash
ewai test-scenarios record <intent-slug> \
  --input <project-relative-candidate.json> \
  --reviewed-by "Product Owner" \
  --project . \
  --json
```

EWAI writes paired `test-scenarios.json` and `test-scenarios.md` files under the intent's Build directory. JSON is authoritative. The Markdown copy is readable evidence whose digest is checked; do not edit it as a shortcut.

## Read status and recover safely

```bash
ewai test-scenarios status <intent-slug> --project . --json
```

| Status | Meaning | Safe response |
| --- | --- | --- |
| `missing` | No reviewed pack exists | Prepare, challenge, review, and record. |
| `recorded` | The JSON, Markdown, digest, and current sources match | Use accepted scenarios for planning and assigned tests. |
| `stale` | An authoritative source changed after review | Prepare again and obtain a fresh named review. Preserve the old record for comparison. |
| `invalid` | The pair, schema, slug, or digest cannot be trusted | Investigate the files and recovery evidence. Do not infer truth from Markdown. |

Open the work item's **Test scenarios** tab to see which behaviours have reviewed scenarios, where gaps remain and how each scenario will be checked. The panel labelled **Coverage loom** shows this coverage; it doesn't run tests. You can inspect the supporting evidence and active personas, then filter the view without changing the recorded work. Preparing, recording and running scenarios happens through the EWAI conversation or CLI, not this read-only panel.

## Build automated tests

During Build, select only scenarios that are:

- `accepted`;
- classified as `automated` or `hybrid`;
- assigned to the current task through a planned test inside its write set.

For each scenario:

1. read the accepted source and expected result (the test's **oracle**: what would demonstrate correct behaviour);
2. write and capture the failing test first;
3. preserve the accepted oracle;
4. make the smallest implementation change;
5. run the focused green command;
6. run refactor and standards checks;
7. report the scenario ID, test name, result, and remaining human route.

Never weaken the expected result to match current code. If implementation reveals that the oracle is wrong, return to the accountable reviewer and source evidence.

## Choose the right evidence route

| Route | Use it for | Authority boundary |
| --- | --- | --- |
| `automated` | Deterministic behaviour that code can observe reliably | A passing test proves its stated assertion, not the whole user outcome. |
| `manual-qa` | User-visible flow, layout, assistive technology, real interaction, or environment-specific behaviour | A named tester records actual evidence and approves the Manual QA gate separately. |
| `specialist-assurance` | Security, privacy, accessibility, legal, clinical, financial, or other accountable specialist judgement | A persona may improve questions but cannot supply the assurance decision. |
| `representative-user` | Language, usability, workflow fit, adoption, or lived experience | Real representative participants are required. |

A hybrid scenario may include automation and a human route. Automation does not mark the human portion passed.

## Product Owner checklist

- [ ] Each accepted oracle cites authoritative source evidence.
- [ ] Persona contributions are labelled as concerns rather than stakeholder facts.
- [ ] Active persona names, tiers, matched concerns, and reasons are visible.
- [ ] Missing relevant perspectives are acknowledged and owned.
- [ ] Conflicts and gaps remain visible.
- [ ] Every accepted scenario has a credible proof route and owner.
- [ ] Premium availability is reported honestly with no implicit sync.
- [ ] Manual QA, specialist assurance, and representative-user work remain human.

## Developer checklist

- [ ] The recorded JSON is current rather than stale or invalid.
- [ ] Selected scenario IDs belong to the leased task and write set.
- [ ] The failing test was written before production implementation.
- [ ] The accepted oracle was not weakened.
- [ ] Focused green, refactor, standards, and integration checks were recorded.
- [ ] Results trace back to scenario IDs and leave remaining human routes open.

## Related guides

- [Product Owner guide](../product-owner-guide.md)
- [Developer delivery guide](../developer-delivery-guide.md)
- [Persona engagement UI](../personas/persona-engagement-ui.md)
- [Blast Radius and Impact Routing](../blast-radius-and-impact-routing-guide.md)
- [Manual QA and acceptance](manual-qa-and-acceptance.md)
- [Human approval and assurance](../human-approval-and-assurance-guide.md)

## Current contract sources

- `src/test-scenarios.mjs`
- `skills-src/ewai-test-scenarios/SKILL.md`
- `skills-src/ewai-test-scenarios/references/scenario-contract.md`
- `src/runtime/dashboard-server.mjs`
- `public/app.js`
- `tests/test-scenarios.test.mjs`
- `tests/runtime.test.mjs`
