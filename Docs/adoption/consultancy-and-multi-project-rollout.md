# Consultancy and multi-project rollout guide

Use this guide when one delivery organisation supports several clients, business units, or independent projects with EWAI.

The engagement practices below are recommendations, not a required commercial service or a special consulting mode in EWAI. Teams can install and operate EWAI themselves. Where you operate it for a client, agree who owns the workspace, evidence and decisions before processing their material.

## The isolation principle

Several repositories can belong to one project; several clients shouldn't be treated as one project just because the same team supports them. Use separate project records and runtimes for independently owned work.

When you need an overview, [Portfolio](../project-portfolio-orchestration-guide.md) compares configured local projects, [Team Hub](../team-hub-guide.md) shares explicitly published summaries and resources, and [Governed Rollout](../consultancy-network-rollout-control-plane-guide.md) compares adoption against agreed baselines. These views are optional; enable them through [Configuration](../operations/dashboard-configuration.md).

Reusable methodology may cross project boundaries. Project truth, client evidence, decisions, credentials, and runtime state must not.

Each project should resolve its own:

- project root and configured SPECS root;
- repositories and ownership;
- Organisation Blueprint selection and receipt;
- project personas and evidence;
- validation providers and approval policy;
- delivery state, dashboard, indexes, and logs;
- data classification and AI-processing permission.

Never carry a path, persona, source document, or delivery state from one client project into another merely because the same consultant or machine is involved.

## Design three knowledge layers

| Layer | Suitable content | Owner |
| --- | --- | --- |
| EWAI framework | Portable method, core skills, core personas, public schemas | EWAI maintainer |
| Consultancy or organisation baseline | Reviewed delivery standards, organisation personas, approved Blueprint Packs | Practice or platform owner |
| Project | Client purpose, users, evidence, constraints, decisions, project personas, delivery records | Client/project owner |

Keep client-specific knowledge out of shared packs. Keep mandatory organisation rules in standards rather than hiding them inside personas.

## Start every engagement with authority

Agree:

- who owns the project's SPECS and repository outputs;
- what the consultancy may inspect, process, retain, and publish;
- permitted AI hosts and data classifications;
- approval and delegated-authority boundaries;
- whether reusable learning may be generalised;
- how secrets and client-identifying material are excluded;
- handoff and deletion obligations at engagement end.

Do not infer permission to reuse material from access alone.

## Use Blueprint Packs as proposals

A consultancy Blueprint can provide a high-quality starting point, but the client or project owner must review:

- publisher and version;
- required and optional modules;
- applicable standards and their consequences;
- persona templates and source ownership;
- dependencies and compatibility;
- governed starter receipts, with separate approval before adding starter files;
- exact project destinations, receipt, and pin.

The material becomes project-owned only after named approval. Record local exceptions and additions in the project, not by silently changing the shared pack for one client.

## Create client-specific personas carefully

Use project personas for client roles, workflows, vocabulary, and evidence-backed perspectives. Do not place them in a personal or shared organisation library.

When extracting reusable learning:

1. remove client identity and confidential facts;
2. separate an observed project fact from a general practice hypothesis;
3. obtain contractual and accountable approval for reuse;
4. validate the generalisation with other evidence;
5. publish it through the shared governance process as a new version.

Managed premium personas remain licensed content and must not be republished in client packs or deliverables.

## Operate separate runtimes

Run check-in against the exact project:

```bash
ewai checkin --project /path/to/client-project --json
```

Use the returned dashboard URL for that project. Do not assume a single SQLite database or dashboard represents every engagement. Confirm the project title and root before acting on a handoff or approval.

For multi-repository products, use one configured shared SPECS root and explicit repository roles. Do not create competing SPECS trees in each repository.

## Offer review as a distinct service

A consultancy can separate:

- facilitation and intent quality;
- engineering delivery;
- standards and security review;
- independent validation;
- Manual QA support;
- production-readiness or governance assessment.

State independence honestly. The agent or team that produced work is not automatically an independent reviewer. Define evidence, scope, limitations, and decision authority for every assurance report.

## Handoff a usable project

At engagement end, provide:

- canonical SPECS and repository history;
- current intent and delivery states;
- Blueprint receipts, pins, versions, and local changes;
- project persona ownership and evidence;
- standards, decisions, exceptions, and open risks;
- validation and Manual QA evidence;
- installation and runtime recovery steps;
- support ownership and unresolved questions.

Remove consultancy-only access and runtime material according to the agreed retention process without deleting client-owned evidence.

## Multi-project checklist

- [ ] Each project has an unambiguous root and SPECS owner.
- [ ] Client data and personas remain project-local.
- [ ] Shared packs contain only approved reusable material.
- [ ] Premium content is not copied or republished.
- [ ] Validation independence is stated accurately.
- [ ] Project approval remains with an authorised person.
- [ ] Runtime and dashboard actions target the correct project.
- [ ] Handoff preserves durable truth and clarifies retention.

## Related guides

- [Organisation rollout guide](../organisation-rollout-guide.md)
- [Internal Blueprint catalogue](../blueprints/internal-blueprint-catalogue.md)
- [Organisation-specific personas](../personas/organisation-specific-personas.md)
- [Human approval and assurance](../human-approval-and-assurance-guide.md)
