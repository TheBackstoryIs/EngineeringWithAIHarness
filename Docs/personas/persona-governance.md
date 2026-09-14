# Persona governance guide

Use this guide to keep persona libraries useful, attributable, current, and appropriately bounded over time.

## Govern source and authority separately

| Persona source | Content owner | Change route | Decision authority |
| --- | --- | --- | --- |
| Core | EWAI maintainers | Framework release | None; advisory only |
| Premium | Managed pack publisher | Explicit entitled sync | None; advisory only |
| Personal | Individual practitioner | Personal library change | None; advisory only |
| Project | Project team | Reviewed project SPECS change | None; advisory only |
| Blueprint-derived project | Project after approval | Project change process | None; advisory only |

Higher selection precedence does not grant greater authority. In Guided Discovery, relevance is scored first; project, premium, personal, and core form the tier tie-break order.

## Assign an owner and review trigger

Every project or organisation persona should have:

- a content owner;
- the real roles or evidence it is grounded in;
- a current version;
- a last-reviewed date in adjacent project governance records;
- events that trigger review;
- a retirement or replacement route.

The current persona schema does not define all governance metadata. Keep additional review records in project SPECS or the organisation catalogue rather than adding unsupported frontmatter.

## Review when context changes

Review a persona when:

- user research contradicts or deepens its assumptions;
- the represented role's responsibilities change;
- regulation, policy, or operating practice changes;
- its questions repeatedly produce low-value or duplicated advice;
- it appears in irrelevant Discovery sections;
- it fails to appear when its perspective is needed;
- a Blueprint or premium release changes adjacent perspectives;
- the named owner leaves or changes role.

## Make changes traceable

For a material change:

1. explain the evidence or decision that prompted it;
2. update mission, stance, questions, metadata, and boundaries coherently;
3. increase the persona version;
4. inspect catalogue discovery with `ewai persona list`;
5. test relevant ensemble selection and UI reasons;
6. have the project or subject-matter owner review it;
7. record replacement or migration effects.

Do not change only the description to force a ranking result while leaving the underlying perspective inconsistent.

## Resolve duplicate and conflicting personas

Two personas may legitimately disagree. First determine whether they represent:

- different stakeholder outcomes;
- different organisational policies;
- the same role at different scopes;
- an obsolete and a current version;
- accidental duplication.

Keep distinct perspectives when the tension is useful and name the decision owner. Merge only when ownership and evidence are truly the same. Retire obsolete duplicates rather than relying on tier ordering to hide them.

## Manage premium updates

Premium personas are an explicitly synced managed library. Check-in reports entitlement, installation, and update status without downloading content.

When an update is offered:

1. confirm the environment is entitled and permitted to receive it;
2. preserve any project decision that depends on the current perspective;
3. run the explicit sync only with consent;
4. inspect changed catalogue metadata and relevant ensemble behaviour;
5. do not modify or publish the managed cache;
6. create a project persona if a durable local perspective is needed.

```bash
ewai persona premium sync --project . --yes
```

An update checks licence access and downloads a verified release ZIP from the website. It doesn't pull a Git branch. If the managed files were edited, belong to another seat or fail validation, stop and inspect the error; don't force replacement. See [setup and recovery](../operations/premium-personas-setup.md).

Status checks can enforce a confirmed expiry of the matching team licence. They preserve personal and project personas; individual subscriptions retain the installed pack after expiry but no longer receive updates.

## Retire a persona safely

The public CLI does not provide a persona-retire command. Retirement is therefore a reviewed ownership action:

- identify replacement or explain why the lens is no longer needed;
- check intents, Blueprints, or guides that refer to the persona ID;
- retain history needed to interpret past decisions;
- remove or archive the source through normal version control;
- refresh the catalogue and confirm it is no longer selected;
- communicate the change to affected teams.

Never delete a managed premium persona independently of its managed library.

## Audit questions

- Can we identify the owner and evidence behind each project persona?
- Are personas written as perspectives rather than hidden policies?
- Do active-persona reasons remain understandable?
- Are stale keywords causing irrelevant selection?
- Are critical real stakeholder perspectives missing?
- Have managed personas been copied into public or project history?
- Can past project decisions still be interpreted after a persona changes?

## Related guides

- [Working with personas](../working-with-personas.md)
- [Persona authoring cookbook](persona-authoring-cookbook.md)
- [Organisation rollout](../organisation-rollout-guide.md)
- [Governance team guide](../governance/governance-team-guide.md)
