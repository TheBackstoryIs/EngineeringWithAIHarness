# Jev decision assistance beta

Jev evaluates bounded choice, score and yes/no questions. Use it to rank an existing set of options before asking a generative model to compare the whole set. It can also compare a structured recommendation returned by an LLM. This experiment does not replace coding models, validate arbitrary prose or establish that an answer is correct.

## Enablement and credentials

Jev is off by default. In Configuration, use **Jev API credentials** to check and save a TypeSafe key, then select **Shadow** in **Decision assistance**, choose uses, accept the text-processing disclosure and save. First enablement should use shadow. Select Active explicitly after reviewing measurements. Saving credentials does not enable inference.

CLI equivalents:

```sh
ewai jev credentials configure --project .
ewai jev configure --mode shadow --use-cases context,personas,skill,claim,failure,impact,tests --acknowledge-cloud-processing --yes --project .
ewai jev status --project . --json
ewai jev measurements --project . --json
ewai jev experiment --limit 6 --project . --json
ewai jev configure --mode off --yes --project .
```

Credential configuration requires a genuinely interactive hidden terminal prompt. Never put a key in arguments or project JSON. The saved key is an owner-only **unencrypted** file at `~/.ewai/credentials/jev.json`, outside the project. `TYPESAFE_API_KEY` in the launching environment takes precedence. Credential status, check and remove commands are available; removing a saved key does not remove an environment override. Check uses the fixed metadata endpoint without inference and does not prove credit or decision quality.

CLI, dashboard and MCP share project-local settings at `.ewai-pipeline/jev.json`. Saves require explicit confirmation and the current revision. An off policy makes no inference calls. Shadow automatic journeys retain their local baseline; explicit decision tools return suggestions for comparison. Active mode permits the bounded automatic applications below. No recommendation grants approval, executes a suggested skill, installs a persona pack, changes provider roles or removes required reviews/tests.

## Use boundaries

| Use | Integration | Boundaries |
|---|---|---|
| Context | CLI/MCP/dashboard context preparation | Rank nonmandatory segment labels; reassemble locally, preserve mandatory evidence, fidelity and overflow failures. Source bodies stay local. |
| Personas | Context preparation and `jev personas` / `ewai_jev_personas` | Resolve core, project, personal and installed premium metadata locally; score names, categories, tags and capabilities for up to 256 unique available personas in batches of 16. Expose considered/available counts and incomplete coverage. Add eligible advice only after complete evaluation; retain baseline reviewers. |
| Skills and answer options | `jev decide`, `ewai_jev_decide`, focused companion status | Choice probabilities order up to 31 candidates (each combined label and description at most 255 characters) and select the recommended ID. Companion automatically reorders only equal-class eligible work, preserving human/blocked positions and handoffs. |
| Claim support | Explicit decision tool | Compare the full claim with supplied eligible evidence: supports, contradicts or insufficient. A supplied quotation must exist verbatim locally before calling. Advice is not factual verification or a gate pass. |
| Failure triage | Explicit decision tool | Classify a supplied sanitised diagnostic into auth, rate, dependency or unknown. Never upload automatic raw process capture or execute a remedy. |
| Impact | Dashboard impact preview | Preserve canonical route recommendations and personas. Show Jev specialist advice in the inferred-consequences cards and a supplemental API field; human changes still require a rationale. |
| Tests | Explicit decision tool | Rank supplemental tests; return mandatory test IDs unchanged. Required tests cannot be deselected. |

Persona recommendation without sending the catalogue to the coding LLM:

```sh
ewai jev personas --focus 'Review keyboard access to the settings form' --limit 4 --project . --json
```

The response contains safe IDs, names, tiers, scores and coverage. Tier describes provenance, not authority. Premium recommendations require an installed persona; this operation never purchases, downloads or updates a pack. Automatic persona advice can add to the local baseline up to its existing eight-persona cap.

## Rank options and review LLM recommendations

Write a bounded decision input to a project-local JSON file, then call `ewai jev decide --input decisions/options.json --project . --json`, or send the same fields directly to `ewai_jev_decide`. The dashboard exposes the same engine at `/api/jev/decisions` to matching-origin callers.

```json
{
  "useCase": "skill",
  "source": "public",
  "task": "Recommend reusable model-to-model access in Laravel",
  "candidates": [
    {"id": "relationship", "label": "Native Eloquent relationship"},
    {"id": "queries", "label": "Duplicate controller queries"}
  ]
}
```

The result supplies `orderedIds`, `recommendedId`, `decision`, probabilities and confidence. `none` means no suitable option; it is excluded from ordered candidate IDs and gives a null recommendation. Probabilities express the model's judgement, not an independently measured correctness rate.

For supported structured options already returned by an LLM, also supply `"origin": "llm"` and `"recommendedId": "queries"`. Jev evaluates the candidates without being shown the LLM's preferred ID, then returns `validation.status` as `agrees`, `disagrees` or `inconclusive`. A recommendation ID outside the supplied set or unsupported shape is rejected. Agreement is a semantic comparison, not proof of validity. Keep the existing recommendation on timeout, low confidence or other inconclusive outcomes; escalate unresolved decisions when needed.

Use these tools as preflight operations where bounded choices are sufficient. They do not intercept every host-model turn or guarantee that a host follows advice. Avoid asking a larger model to re-rank the same full set unless Jev falls back or the decision needs reasoning beyond the rubric.

## Data, budgets and measurements

Enablement discloses that focus text, selected labels and descriptions leave the machine for TypeSafe. Automatic persona ranking uses names, categories, tags and capabilities, excluding descriptions that might have been derived from persona bodies. Explicit checks can send evidence or sanitised diagnostics supplied by the caller. Automatic ranking excludes project source and persona bodies. Explicit sources must be `public`, `synthetic`, `cloud-approved` or `metadata-only`; unknown/imported/cloud-denied material is refused. Source assertions are the caller's responsibility. Common credential patterns and the configured key are rejected, but pattern matching is not a complete data-classification system. Do not label confidential text metadata-only to bypass its handling policy.

Requests use the fixed HTTPS TypeSafe endpoint and pinned `jev-1.13.0`, with no retries or redirects. Defaults: 100 calls, 100,000 reserved input tokens, three-second deadline and 0.65 minimum confidence. Limits apply across processes to a saved policy revision; a new explicitly saved revision starts another bounded budget. UTF-8 bytes plus headroom reserve input capacity conservatively. Reported usage determines measured cost; over-reservation or unknown usage blocks further calls in the current budget. A cache hit requires the same policy, credential identity and request; disabling or changing these invalidates application of in-flight advice.

Telemetry stores bounded IDs, outcome codes, numeric results, model, usage, timings and effects. It excludes prompts, candidate descriptions, evidence bodies, raw provider responses and credentials. Numeric cache entries are bounded separately. The history retains the latest 500 observation events; latency/call/fallback/cache figures cover that history, while recorded input and cost totals accumulate across revisions. Before dispatch, an unresolved reservation is persisted. Concurrent or interrupted unresolved calls block new inference in that policy revision and leave total cost unknown; it is never silently reported as zero. Measurements distinguish suggestions from application; downstream savings remain unknown.

The synthetic runner evaluates at most six labelled challenge cases using the already enabled policy and configured key. It never widens limits or enables Jev. Run comparisons on equivalent completed coding tasks before claiming lower overall token use, cost or elapsed time. Include Jev's own latency, cache hits, fallback frequency, reviewer quality and any large-model calls still needed. A local deterministic selector is usually faster than a network call; Jev's potential benefit is better semantic selection or avoiding a more expensive model comparison.

API and model references: [TypeSafe API](https://docs.typesafe.ai/api), [models and pricing](https://docs.typesafe.ai/models), [confidence](https://docs.typesafe.ai/confidence), [coding-agent guidance](https://docs.typesafe.ai/introduction/coding-agents).

This is an experimental beta. Packaging and automated browser checks do not replace owner Manual QA or establish completed coding-task savings.

OpenAI Decisions joins the shared bounded engine in `0.3.4-beta.3`. New settings default off with Automatic provider preference; historical Jev policies retain their vendor consent. Private CLI/dashboard OpenAI key setup, independent text consent, typed conversion and provider-aware costs are described in the [OpenAI Decisions beta guide](openai-decisions-beta.md). Live OpenAI access and completed-task savings remain unmeasured.
