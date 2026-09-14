---
name: ewai-rollout
description: Review a governed consultancy, organisation, or multi-project EWAI rollout using its bounded read-only snapshot, exact Organisation Blueprint comparisons, structural assurance evidence, standard host-model reasoning, and contextually engaged installed personas. Use when Codex needs to examine rollout cohorts, baseline adoption, Blueprint drift, missing, stale, unavailable, or invalid evidence, accountable review routes, or one selected project's rollout assurance without changing client projects.
---

# EWAI Rollout Review

Resolve the host project and configured SPECS root before acting. Read [the rollout contract](references/rollout-contract.md) before interpreting a workspace or producing advice.

Use the standard host LLM for the review. Installed project and core personas enrich the normal baseline. Installed personal and premium personas are optional specialist lenses, not prerequisites.

## Retrieve the governed projection

Validate the project-owned policy first:

```bash
ewai rollout validate --project . --json
```

Retrieve the whole rollout or select a concise concern so EWAI can engage relevant personas:

```bash
ewai rollout status --project . --json
ewai rollout status --focus "Blueprint drift and security evidence" --project . --json
ewai rollout assurance client-portal --project . --json
```

When the EWAI MCP server is available, use `ewai_rollout_status` with optional `focus` and `projectId`. These surfaces are read-only. Do not provide a project-root override, credentials, approval, risk acceptance, raw client evidence, or mutation instructions.

Preserve `not-configured`, `invalid`, `ready`, and `attention` exactly. Preserve project adoption states `aligned`, `review-required`, `not-adopted`, `unavailable`, `stale`, and `invalid`. Missing or non-current evidence never means healthy.

When the focus or selected project changes materially, retrieve a fresh projection so the active persona ensemble can swap relevant lenses in and out.

## Disclose active personas

Before analysis, list each active persona's name, tier, matched signals, and engagement reason. Use only returned safe metadata.

- Apply project and core personas when selected by the current context.
- Apply personal or premium personas only when already installed and selected as relevant.
- Treat an absent premium library as nonblocking; the standard host model remains capable of the review.
- Never initiate entitlement checks, persona synchronisation, content retrieval, or installation from this skill.
- Never imitate, reconstruct, expose, or claim access to an unavailable persona body.

Personas surface questions and alternatives. They do not supply stakeholder evidence, approve a baseline, judge assurance adequacy, or become accountable decision-makers.

## Review in evidence order

1. Report `declared-policy`: the rollout owner, cohort, required evidence, assigned project, review owner, and exact Blueprint baseline.
2. Report `observed-project-evidence`: bounded child-owned Blueprint, delivery, standards, Manual QA, and security states with their stated limitations.
3. Report `automated-check`: exact Blueprint comparisons and freshness outcomes. Do not infer semantic-version precedence or compatibility.
4. Report `persona-hypothesis`: concerns, edge cases, or questions raised through a disclosed active persona lens.
5. Reserve `human-decision` for an actual named human decision. A suggested route is not the decision itself.

Use the returned review questions to find the baseline difference needing ownership, required evidence that is absent or unreliable, unsupported conclusions, and the named person who owns the next action.

## Produce an actionable review

Return:

1. rollout, cohort, project, and snapshot status;
2. active persona names, tiers, matched signals, and engagement reasons;
3. declared baseline and required evidence;
4. observed evidence, freshness, gaps, and limitations;
5. separately labelled automated checks and persona hypotheses;
6. the next route and named accountable owner; and
7. both returned advisory and security notices.

Keep absolute paths, repository roots, raw evidence documents, prompts, persona bodies, credentials, validator findings, risk dispositions, and unrestricted client content out of the response.

## Authority boundary

This skill is advisory and read-only. It cannot change rollout policy, update a Blueprint pin, write child SPECS, dispatch work, approve Build or Manual QA, accept residual risk, declare evidence adequate, certify security, change release readiness, deploy, or release.

Stop if validation fails, child evidence escapes the configured Portfolio topology, required fields are absent, the user asks the review to mutate a client project, or a conclusion would require treating model or persona output as human evidence. Route the decision to the returned project, review, cohort, Portfolio, security, or release owner.
