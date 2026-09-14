# Project and Portfolio Orchestration guide

Use Project and Portfolio Orchestration when one outcome depends on several EWAI projects and you need a safe programme-level view of ownership, declared dependencies, evidence freshness and attention. The capability is read-only. Each child project remains authoritative for its own delivery state, approvals, Manual QA, risk and release decisions.

The Portfolio workspace uses standard host LLM capabilities for its advisory review. Installed project and core personas give it better project context; installed relevant premium or personal personas can enrich the active ensemble. Premium access is optional and never blocks the baseline.

## What the capability produces

`ewai portfolio status` produces an `ewai.portfolio-workspace/v1` snapshot containing:

- the portfolio → programme → project hierarchy;
- owners and safe repository-relative member identities;
- declared project-to-project dependencies and their owners;
- bounded child intent and delivery-state evidence;
- missing, stale, unavailable and Markdown/JSON disagreement attention;
- the active persona name, tier, matched signals and engagement reason;
- standard LLM review questions and explicit evidence classes; and
- mandatory advisory and security-assurance notices.

The snapshot does not copy child documents into a central store. It does not create a health score, schedule work, mutate a child project or approve anything.

## Before configuring a portfolio

Every project member must already be beneath a repository root configured in the host project’s `SPECS/pipeline.yaml`. The host may be a project itself or a lightweight portfolio workspace. Initialise child EWAI projects normally so each has its own `.ewai-pipeline/project.json`, configured SPECS root and `SPECS/pipeline.yaml`.

Repository names in the portfolio manifest refer to the host’s configured `repositories` list. Paths are workspace-relative and are resolved without symbolic traversal. Absolute paths and `..` traversal are rejected.

## Supported repository shapes

### Single repository

The host and project can be the same repository. Configure one repository named `application`, then point the project member to `project_path: .`.

```yaml
repositories:
  - name: application
    path: .
    role: application
```

### Monorepo

Configure the monorepo root once and use bounded project subfolders. Each subfolder is an independently initialised EWAI project if it owns distinct delivery state.

```yaml
repositories:
  - name: product-monorepo
    path: .
    role: application
```

Portfolio members can then use `project_path: services/api`, `project_path: clients/web`, and similar relative locations.

### Folder containing multiple Git repositories

The EWAI host can sit in a parent folder containing multiple Git repositories. Configure each child repository by name, keeping every path beneath the host workspace:

```yaml
repositories:
  - name: api
    path: repositories/customer-api
    role: service
  - name: web
    path: repositories/customer-web
    role: client
```

Use `project_path: .` for each project when its EWAI root is the root of that child repository.

### Separate configured repositories

A programme can combine projects from several separately configured repositories and subfolders:

```yaml
repositories:
  - name: platforms
    path: repositories/platforms
    role: platform
  - name: operations
    path: repositories/operations
    role: operations
```

Members may use `repository: platforms` with `project_path: identity` and `repository: operations` with `project_path: service-transition`. Repository boundaries stay explicit even when the projects contribute to one programme.

Sibling or external paths outside the configured host workspace are deliberately unsupported. Move the host to a safe common parent or create a bounded workspace layout rather than using traversal.

## Create the portfolio manifest

Create `SPECS/1.Scope/portfolio.yaml` in the host’s configured SPECS root:

```yaml
schema: ewai.portfolio/v1
id: customer-transformation
name: Customer transformation
owner: Transformation Director
members:
  - id: customer-transformation
    kind: portfolio
    name: Customer transformation
    owner: Transformation Director
  - id: digital-service
    kind: programme
    name: Digital service programme
    owner: Programme Director
    parent: customer-transformation
  - id: client-portal
    kind: project
    name: Client portal
    owner: Product Owner
    parent: digital-service
    repository: product-monorepo
    project_path: clients/web
  - id: identity-service
    kind: project
    name: Identity service
    owner: Platform Owner
    parent: digital-service
    repository: product-monorepo
    project_path: services/identity
dependencies:
  - id: portal-needs-identity
    from: client-portal
    to: identity-service
    rationale: Portal authentication depends on the identity service contract.
    owner: Programme Director
```

There must be exactly one root portfolio. Programmes and projects require a parent; only projects declare repository and project path. Dependencies join projects only and must be acyclic. Limits are 100 members, 400 dependencies and hierarchy depth 8.

For this example, `product-monorepo` must be the configured repository containing the already-initialised `clients/web` and `services/identity` EWAI projects. It isn't a pack ID. Keep `portal-needs-identity` separate from a discovered code dependency: the manifest records what the programme owner declares.

## Validate and inspect

Run validation before asking for analysis:

```bash
ewai portfolio validate --project . --json
ewai portfolio status --project . --json
ewai portfolio status --focus "identity dependency and Manual QA ownership" --project . --json
```

Agent hosts can retrieve the same safe snapshot through the read-only MCP tool `ewai_portfolio_status`. The optional focus is bounded to 500 characters and helps EWAI swap in the relevant installed personas for that particular review.

In this example, check that both `client-portal` and `identity-service` were found, whether their evidence is current, and who owns `portal-needs-identity`. A missing child project is an attention item—not proof that the dependency is healthy. Open the owning project to resolve it; portfolio status doesn't repair or approve that child.

Neither interface accepts a root override or a write action. Re-running status never changes the manifest or child SPECS.

## Use the Portfolio workspace

Enable **Portfolio** in **Configuration** and save, then select **Portfolio** in the sidebar. See [dashboard configuration](operations/dashboard-configuration.md). The programme line shows hierarchy, owner, evidence state, current child phase and Manual QA status. Select a member or declared dependency to update the local context rail; the selection is retained in the page URL but is not written to a project.

The dependencies section deliberately separates **Declared dependency** from **Observed evidence**. V1 does not yet project bounded cross-project Source Map edges, so observed dependency evidence is shown as unavailable rather than inferred from the declaration.

The context rail shows the named route for each attention item. There are no approve, edit, build, dispatch, deploy or release controls in this workspace.

## Use standard LLM reasoning and personas

Invoke `$ewai-portfolio`, or give your host the safe JSON snapshot and ask it to review the returned questions. The review should proceed in this order:

1. `declared`: hierarchy, ownership and declared dependencies;
2. `observed`: bounded child evidence, freshness and disagreement;
3. `inferred`: model-derived consequences that still require confirmation;
4. `persona-hypothesis`: concerns raised through an active persona lens; and
5. `human-decision`: only decisions actually recorded by named accountable people.

The standard host model is enough to perform this method. Project and core personas improve its framing with local and EWAI responsibilities. When an installed premium or personal persona is relevant, it appears in the active ensemble with its tier and engagement reason. If the focus changes, retrieve the snapshot again so personas can swap in and out rather than accumulating.

Missing premium personas are informative and nonblocking. Portfolio review does not install, fetch, synchronise, copy or approximate premium content. Personas remain advisory lenses and cannot substitute for user evidence, specialist validation or accountable approval.

## Read attention and recovery states

| State or diagnostic | Meaning | Recovery |
| --- | --- | --- |
| `not-configured` | The canonical manifest is missing. | Create and review the manifest if you have authority. |
| `invalid` | Schema or topology validation failed. | Fix the reported stable code and safe field path, then validate again. |
| `missing` | No readable child delivery state exists. | Check that the child is initialised and its configured SPECS root is correct. |
| `stale` | Child delivery evidence is older than the 30-day default window. | Refresh the child through its normal EWAI workflow; do not edit the aggregate. |
| `disagreement` | Markdown and structured intent status differ. | Reconcile authoritative child intent state before relying on it. |
| `unavailable` | Child configuration or bounded evidence could not be read. | Inspect the named child project and keep the uncertainty visible. |
| `portfolio.duplicate-root` | Two members resolve to the same real root. | Keep one member or point each member at a distinct EWAI project. |
| `portfolio.symbolic-path` | A repository or project path crosses a symbolic link. | Use a real path beneath the configured repository. |
| `portfolio.unsafe-path` | A path is absolute, traverses upward or escapes its root. | Replace it with a bounded repository-relative path. |

Other stable diagnostics cover duplicate IDs, missing parents/targets, invalid member kinds, hierarchy cycles, dependency cycles and resource limits. Invalid configuration fails closed and exposes no absolute path.

## Assurance and human authority

The dashboard, CLI, MCP tool and skill always preserve this boundary:

> Portfolio and persona analysis is advisory. Child project approvals, accepted risk, Manual QA and release decisions remain with named accountable humans.

Portfolio findings aren't a security assessment. If they expose a security concern, follow the owning project's [security validation workflow](security-validation-guide.md) and its human review requirements.

Route each unresolved concern to the member or dependency owner. Review cannot approve Build or Manual QA, accept risk, certify security, change release readiness or mutate a child project.

## Current exclusions

V1 does not include portfolio editing, scheduling, work dispatch, cross-project writes, embedded model/provider clients, connectors, meeting or transcript ingestion, automated observed dependency edges, deployment or release.
