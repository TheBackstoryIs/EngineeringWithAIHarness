# Record one reviewed test scenario

Use this complete input shape after preparing scenarios for an existing intent. The fictional feature here is `customer-access`; it isn't a requirement your project inherits.

## Prepare from accepted requirements

Ask EWAI to challenge the intent's permissions and recovery paths, or run:

```bash
ewai test-scenarios prepare customer-access --focus "permission and recovery" --project . --json
```

Read `authoritativeSources`, `sourceDigest` and `activePersonas`. For this example, the accepted requirement is that an authenticated, authorised delegate can submit a valid access request and receive a clear outcome. If that isn't an accepted requirement in your project, don't record it as one.

Save this as `scenario-input.json`. Substitute the returned digest, current persona ID and real source IDs. Set the slug, test file and owner for your project.

<!-- example: test-scenario -->
```json
{
  "schema": "ewai.persona-test-scenarios/v1",
  "slug": "customer-access",
  "focus": "permission and recovery",
  "preparedSourceDigest": "SOURCE_DIGEST",
  "scenarios": [{
    "id": "PTS-001",
    "title": "An authorised delegate can submit an access request",
    "type": "happy-path",
    "sourceRefs": ["JOURNEY_SOURCE_ID", "ACCEPTANCE_SOURCE_ID"],
    "personaContributions": [{
      "personaId": "ACTIVE_PERSONA_ID",
      "concern": "Check the permission boundary as well as the successful outcome."
    }],
    "preconditions": ["The delegate is authenticated and authorised to request access."],
    "actions": ["Submit a valid access request."],
    "expectedResults": ["The request is accepted and a clear success outcome is displayed."],
    "evidenceRoute": "automated",
    "automation": "automated",
    "plannedTest": {
      "file": "tests/access.test.mjs",
      "name": "authorised delegate completes access request"
    },
    "owner": "Delivery team",
    "status": "accepted"
  }],
  "gaps": []
}
```

The expected result is the test's **oracle**: the agreed behaviour against which the implementation will be checked. The persona suggests what to investigate; it can't invent that expectation.

This one happy-path scenario isn't complete permission coverage. Consider denial and recovery separately, with their own accepted sources.

## Review, record and inspect

Only set `accepted` after the named reviewer has compared the expectation with its source. Then:

```bash
ewai test-scenarios record customer-access --input scenario-input.json --reviewed-by "Example reviewer" --project . --json
ewai test-scenarios status customer-access --project . --json
```

The result should be `recorded`, with paired `test-scenarios.json` and `test-scenarios.md` under the intent's Build directory. Recording a scenario doesn't create its test file or run a test.

Unknown source IDs, an unrecognised active persona or stale preparation require corrected input and review. Don't remove traceability fields merely to make validation pass.

The [complete v1 candidate contract](../../skills-src/ewai-test-scenarios/references/scenario-contract.md#candidate-schema) lists all fields and enums. This contract is enforced by the [scenario validator](../../src/test-scenarios.mjs); there isn't a separate standalone JSON Schema file for it in this release.

Return to [persona-driven test scenarios](../quality/persona-driven-test-scenarios.md).
