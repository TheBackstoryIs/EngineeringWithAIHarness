# Organisation rollout guide

Use this guide to introduce EWAI across several teams while keeping organisational consistency, project autonomy, and human accountability in balance.

## Recommended practice

EWAI supports project-local configuration, shared Blueprints and personas, delivery checks, an optional [Team Hub](team-hub-guide.md) and [Governed Rollout views](consultancy-network-rollout-control-plane-guide.md). Your organisation operates and configures the shared services; installing EWAI doesn't connect a project to them automatically.

The staged adoption model below is recommended practice, not a mandatory rollout enforced by the software.

## Start with an operating agreement

Before selecting tools or packs, agree:

- the problems EWAI is expected to reduce;
- which decisions remain with Product Owners, engineers, governance, and platform teams;
- the minimum Definition of Ready and Definition of Done;
- evidence and retention expectations;
- permitted AI hosts and data classifications;
- independent validation expectations;
- how exceptions are requested and reviewed;
- who owns shared Blueprints, standards, and personas.

Measure adoption by better decisions and safer outcomes, not the number of generated artefacts.

## Choose proportionate adoption levels

| Level | Suitable starting point |
| --- | --- |
| Foundation | One stakeholder perspective, one engineering lens, shared ready/done definitions, independent review, and one learning per delivery |
| Team | Project SPECS, contextual personas, repository index, guarded delivery, standards sweep, and Manual QA |
| Organisation | Reviewed Blueprint Packs, organisation personas, catalogue governance, versioning, rollout communication, and assurance reporting |

These level names describe an adoption plan, not selectable runtime modes. There isn't a `Foundation` switch that disables required gates. Configure the capabilities your teams need; accepted standards and the active delivery's required checks still apply.

Teams can stop at the depth their risk and maturity justify. Do not require every advanced artefact for every small change.

## Pilot before mandating

Select a small set of contrasting projects:

- one new internal tool;
- one existing system with knowledge gaps;
- one user-visible feature;
- one higher-assurance or sensitive workflow.

For each pilot, capture baseline cycle time, rework, escaped issues, onboarding effort, approval delay, and participant confidence. Add qualitative evidence about whether the method improved shared understanding.

## Build the organisation baseline

Use an [Organisation Blueprint Pack](designing-organisation-blueprint-packs.md) only for reviewed defaults that genuinely apply across its declared audience. Separate:

- mandatory organisation standards;
- optional modules for particular risk or technology contexts;
- organisation-specific persona templates;
- reference-only boilerplates;
- project decisions that must remain local.

Create a documented owner, review cadence, compatibility policy, and deprecation path before broad use.

## Preserve project autonomy

A project should be able to explain:

- which Blueprint version and modules it accepted;
- what was materialised into project truth;
- what local standards or personas were added;
- what exceptions were approved and why;
- whether an upstream update has been reviewed;
- who owns the resulting project decisions.

The organisation publishes a baseline. The project owner accepts the consequences.

## Develop organisation personas carefully

Organisation-specific personas should encapsulate a useful professional perspective—such as the organisation's architecture or API approach—without impersonating a real person or becoming a hidden policy store.

Use [Creating organisation-specific personas](personas/organisation-specific-personas.md) and [Persona governance](personas/persona-governance.md). Keep mandatory rules in standards, and use personas to ask context-sensitive questions about those rules.

## Establish a change process

For each shared release:

1. state the reason and affected audience;
2. classify breaking, additive, corrective, or deprecating changes;
3. validate the pack and its bounded content;
4. compare outputs against representative pilot projects;
5. publish provenance, version, compatibility, digest, and release notes;
6. communicate required project action;
7. allow projects to review before adopting;
8. monitor outcomes and record learning.

Never silently rewrite existing project truth from a changed upstream pack.

## Support non-technical teams

Offer colleagues a facilitated session through Guided Discovery rather than requiring everyone to use the terminal. Discovery shows its active personas and their reasons; use that information to discuss missing perspectives with the group. Explain technical consequences in plain language and involve the same authorised human approvers as in a CLI-based review.

See the [non-technical team guide](adoption/non-technical-team-guide.md).

## Governance without central bottlenecks

Central teams should own shared contracts and assurance expectations, not every project decision. A scalable model separates:

- **publisher ownership:** shared pack and standard quality;
- **project ownership:** local outcomes and adoption decisions;
- **delivery ownership:** implementation evidence and engineering quality;
- **governance ownership:** risk thresholds, exceptions, and auditability;
- **platform ownership:** installation, runtime health, and supported integrations.

## Measures worth tracking

Recommended measures include:

- time from idea to ready intent;
- decisions reopened because evidence was missing;
- onboarding time for inherited systems;
- standards exceptions by reason;
- defects found before and after Manual QA;
- percentage of shared updates deliberately reviewed;
- project and stakeholder confidence;
- reusable learning incorporated into standards or guides.

Avoid league tables based solely on AI usage, token volume, or artefact count.

## Rollout checklist

- [ ] Operating agreement and ownership model approved.
- [ ] Data and AI-host boundaries understood.
- [ ] Pilot portfolio selected and baselines recorded.
- [ ] Shared standards, personas, and Blueprints have named owners.
- [ ] Projects retain explicit adoption and exception decisions.
- [ ] Non-technical participation is supported.
- [ ] Update, deprecation, recovery, and assurance routes are documented.
- [ ] Measures assess outcomes and learning rather than activity.

## Related guides

- [Internal Blueprint catalogue](blueprints/internal-blueprint-catalogue.md)
- [Maintaining Organisation Blueprints](blueprints/maintaining-organisation-blueprints.md)
- [Governance team guide](governance/governance-team-guide.md)
- [Consultancy and multi-project rollout](adoption/consultancy-and-multi-project-rollout.md)
