---
name: ewai-portfolio
description: Review an EWAI project portfolio or programme using the bounded read-only portfolio snapshot, explicit evidence classes, standard host-model reasoning, and contextually engaged installed personas. Use when Codex needs to examine portfolio hierarchy, project ownership, cross-project dependencies, stale or missing child evidence, programme attention, or the effect of installed core, project, personal, or premium persona lenses without changing child projects.
---

# EWAI Portfolio Review

Resolve the project and configured SPECS root before acting. Read [the portfolio contract](references/portfolio-contract.md) before interpreting a workspace or producing advice.

Use the standard host LLM or model for reasoning. The complete baseline combines the bounded snapshot, its explicit review questions, and installed project and core personas. Personal and premium personas are optional enrichment, not a prerequisite.

## Retrieve the safe snapshot

Validate the project-owned manifest first:

```bash
ewai portfolio validate --project . --json
```

Then retrieve the current workspace, using a concise focus when the user has named a concern:

```bash
ewai portfolio status --focus "delivery ownership and dependency risk" --project . --json
```

When the EWAI MCP server is available, `ewai_portfolio_status` with an optional `focus` is the equivalent read-only route. Do not send a repository root, user identity, approval or child content through either interface.

Respect `not-configured`, `invalid`, `ready`, and `attention` exactly. Do not convert missing, stale, unavailable or disagreeing evidence into a healthy conclusion. If the focus changes materially, retrieve a fresh snapshot so the active ensemble can swap relevant personas in and out.

## Disclose the active reasoning ensemble

Before review, list every active persona with its name, tier, matched signals, and engagement reason. Use only the returned safe metadata and apply each lens within that stated reason.

- Treat installed project and core personas as part of the baseline available to this project.
- Use installed personal or premium personas only when the snapshot selects them as relevant.
- Treat missing premium access as informative and nonblocking.
- Do not run entitlement or library synchronisation commands, fetch premium content, reconstruct unavailable personas, or expose persona bodies.

Personas challenge the evidence. They are not users, stakeholders, validators, approvers or sources of project truth.

## Review in evidence order

1. Report declared hierarchy, ownership and dependencies as `declared`.
2. Report allowlisted child state and attention as `observed` or `declared-child-state`, preserving freshness and disagreement.
3. Label model-derived relationships or consequences as `inferred`.
4. Label persona concerns and alternative interpretations as `persona-hypothesis`.
5. Reserve `human-decision` for an actual recorded decision by a named accountable human.
6. Use the workspace review questions to examine exposed dependencies, missing evidence, the next owner decision, and unsupported conclusions.

Never merge those classes into a score or an automatic portfolio verdict. The V1 workspace does not project observed cross-project Source Map edges; state that limitation rather than inventing them.

## Produce an actionable review

Return:

1. the selected portfolio context and snapshot status;
2. active persona names, tiers and reasons;
3. declared facts;
4. observed evidence, freshness and disagreements;
5. explicitly labelled inferences and persona hypotheses;
6. unresolved questions and the named owner or child project that can answer them; and
7. the advisory and security assurance notices.

Keep absolute paths, raw child documents, prompts, persona bodies, credentials and unrestricted file content out of the output.

## Authority boundary

This skill is advisory and read-only. It cannot edit the manifest, write child SPECS, dispatch work, approve Build or Manual QA, accept risk, certify security, change release readiness, deploy, or release. Route every unresolved decision to the named accountable human or child project.

Stop if safe validation fails, evidence escapes the declared workspace, required fields are missing from the server contract, the user asks the review to mutate a child project, or a conclusion would require pretending persona/model output is human evidence.
