---
name: ewai-shape-intents
description: Explore a broad product idea, capability, workflow, or feature request with a project owner and turn it into a reviewed, interconnected map of draft EWAI intents. Use when a user wants to add several related features, shape an initiative, decompose a large idea, discover an MVP or release slice, build a backlog from a function, or decide which intents should exist before refining them individually.
---

# EWAI Shape Intents

Turn a human idea into an understandable product map before creating individual intents. Stay conversational, ask one useful question at a time, and never start planning, delivery, or implementation from this skill.

Read [intent mapping contract](references/intent-mapping-contract.md) before proposing or creating the map.

## Establish project truth

1. Run `ewai checkin --project <path> --json`.
2. Read the project purpose, users, existing intents, technology strategy, constraints, imported context, and relevant Archaeology findings under `SPECS/`.
3. Search existing intents for overlapping outcomes. Prefer extending or relating existing work over creating duplicates.
4. If the project has not completed discovery, pause intent shaping and use `$ewai-project-discovery` first.

## Select the shaping perspective

Query the installed persona index:

```bash
ewai persona index \
  --project <path> \
  --query "product definition prioritization requirements release shaping" \
  --json
```

- Prefer the premium `product-owner` persona when the index confirms it is installed. Read its full persona privately and use its product-shaping method to drive the interview.
- If premium access exists but the persona library is not installed or has an offered update, ask before running `ewai persona premium sync --project <path> --yes`.
- If it is unavailable, say so briefly and continue using the project's purpose, users, evidence, and core personas. Never impersonate or reconstruct an unlicensed premium persona.
- If the premium `product-owner` persona is installed and selected, record it as a shaping persona on the map. Otherwise record another available shaping persona or omit the field. Never create an unlicensed reference or false provenance. Attach a shaping persona to an individual intent only when its perspective is needed throughout that intent's lifecycle.

## Explore the idea

Begin with what is on the user's mind. Then ask one question at a time, adapting to what is already known. Establish:

- the problem, desired outcome, and why it matters now;
- the people affected and the jobs or journeys they need to complete;
- the rules, decisions, hand-offs, integrations, data, and operational consequences;
- the smallest valuable outcome and what is explicitly out of scope;
- security, privacy, assurance, accessibility, support, and failure expectations;
- evidence of success, assumptions, and unknowns that could change the shape.

Do not interrogate the user for information already present in project evidence. Summarise your evolving understanding and invite correction.

## Shape interconnected intents

Split by independently valuable, testable outcomes—not by frontend, backend, database, or engineering task. Keep one intent when one coherent outcome is the honest shape.

Use discovery spikes only when an unresolved choice blocks responsible intent definition. Mark relationships explicitly as `depends-on`, `enables`, `complements`, `conflicts-with`, `supersedes`, or `relates-to`.

For each proposed intent, add a delivery-shape preview. Most intents created from this skill should be `single`; use `split` or `decision-required` only when the map still contains an umbrella item that needs further decomposition before delivery.

Present:

1. the overall idea and intended outcome;
2. a compact table of proposed intents, users, value, and boundaries;
3. a readable relationship map and suggested sequence;
4. assumptions, open decisions, overlap with existing intents, and possible deferrals.

Ask the user to merge, split, rename, resequence, defer, or reject items. Iterate until they explicitly approve the map.

## Create only after approval

Use the `ewai_create_intent_map` MCP tool with `confirmed: true`. If MCP is unavailable, write the approved request to JSON or YAML and run:

```bash
ewai intent map-create <request-file> \
  --project <path> \
  --yes \
  --approved-by "<name>"
```

The operation must create the durable map plus every linked draft intent atomically. Do not create intents speculatively or one-by-one before approval.

After creation, offer:

- to refine one draft through `$ewai-intent`;
- to review the map in the dashboard;
- to leave the approved drafts in the backlog.

Never begin the fourteen-stage delivery cycle from this skill.
