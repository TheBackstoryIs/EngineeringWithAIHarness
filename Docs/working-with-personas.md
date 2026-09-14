# Working with personas

Personas give EWAI deliberate perspectives to apply during Discovery and delivery. They help expose blind spots, ask better questions, and translate consequences for different people.

A persona is an advisory lens. It is not a real stakeholder, a source of factual evidence, an approval, or a grant of authority.

For example, an export may look straightforward until an operator asks how a failed download is retried and a privacy lens asks which fields should be excluded. Those perspectives change the questions you put to the owner and the tests you plan. They don't decide the permission rules or claim real users approved them.

## Choose the right persona source

| Type | Owned by | Lives in | Best for | How it enters a project |
| --- | --- | --- | --- | --- |
| Core | EWAI maintainers | Bundled framework persona pack | General engineering and delivery disciplines | Available with EWAI. |
| Premium | Managed persona-pack publisher | Local entitled pack cache under `~/.ewai/packs/…/premium-personas/` | Broader specialist perspectives maintained outside the public repository | Explicit entitlement check and user-approved sync. |
| Personal | One practitioner | `~/.ewai/personas/` | A reusable working lens across several projects | Create once; the local catalogue can select it when relevant. |
| Project | The project or team | Configured `SPECS/1.Scope/personas/project/` | Product, domain, organisation, or user knowledge that belongs with this project | Create in the project and version it with SPECS. |
| Blueprint-derived project | Organisation pack publisher, then the approving project | Starts in an Organisation Blueprint Pack; materialises into the project-persona directory | A reviewed organisation perspective that should become project-owned truth | Previewed with the blueprint and created only after named Discovery approval. |

Use the narrowest ownership that is true. If a perspective only makes sense for one product, it is a project persona—not a personal global default. If a team has developed a perspective beyond the managed premium version, create a project persona that states the project-specific stance rather than editing managed files.

## Inspect the available catalogue

List personas available to the current environment:

```bash
ewai persona list --project .
```

Narrow the list by a word found in the persona's metadata, tags, capabilities, or path:

```bash
ewai persona list --project . --query security
ewai persona list --project . --query finance
ewai persona list --project . --query accessibility
```

For a compact machine-oriented view, use:

```bash
ewai persona index --project . --query architecture
```

The index exposes public metadata such as ID, name, description, category, tier, tags, capabilities, and local path. It does not make the persona an authority over project decisions.

## Create a personal persona

Use a personal persona for a lens you own and expect to reuse:

```bash
ewai persona create security-reviewer \
  --name "Security Reviewer" \
  --category engineering
```

Locate the personal library with:

```bash
ewai persona path --scope personal
```

The default root is `~/.ewai/personas/`.

## Create a project persona

Use a project persona for product-specific stakeholders, domain roles, organisation conventions, or locally agreed decision lenses:

```bash
ewai persona create finance-controller \
  --scope project \
  --project . \
  --name "Finance Controller" \
  --category finance
```

Locate the configured project library with:

```bash
ewai persona path --scope project --project .
```

The default contract location is the configured SPECS root beneath `1.Scope/personas/project/`. Do not assume the SPECS root is literally `./SPECS`; `.ewai-pipeline/project.json` identifies it for the current project.

The create command refuses to overwrite an existing persona unless `--force` is supplied. Review the existing project truth before using that replacement option.

## Shape a useful persona

The generator creates portable metadata and four body sections. A project persona can look like this:

```markdown
---
schema: ewai.persona/v1
id: project.finance-controller
name: Finance Controller
version: 0.1.0
description: Tests product decisions against financial control, auditability, and month-end operations.
category: finance
pack: ewai.personas.project
tier: project
tags:
  - finance
  - audit
  - reporting
capabilities:
  - control-design
  - financial-reporting
---

# Finance Controller

## Mission

Make financial consequences and control obligations visible before delivery choices become expensive to reverse.

## Operating stance

- Trace every material figure to an accountable source.
- Prefer explicit controls and reconciliation evidence over confident narrative.
- State which conclusion is evidence and which is a working assumption.

## Questions to keep asking

- Who owns this control in normal operation?
- What happens at month end, year end, or during an audit?
- Can a user explain and reproduce this figure?

## Boundaries

- This persona advises; the real Finance Controller and Product Owner remain accountable.
- Real stakeholder evidence takes priority over simulated feedback.
```

### Metadata that improves engagement

Discovery matches each section's perspective signals against the persona's ID, name, category, description, tags, and capabilities. Make those fields specific enough to be discoverable:

- Write a description around the decisions and risks the persona examines.
- Use stable, plain-language tags such as `accessibility`, `privacy`, `finance`, `operations`, or `api`.
- Use capabilities for concrete work such as `threat-modelling`, `control-design`, or `user-research`.
- Avoid stuffing every possible keyword into one persona. A persona that matches everything adds little discrimination.

The body should say what the persona is trying to protect, how it reasons, what evidence it expects, the questions it keeps asking, and where its authority stops.

## Use premium personas safely

For first-time setup, [enter your licence and install the pack](operations/premium-personas-setup.md). Setup installs immediately; later updates require your consent.

A status check doesn't download content, but it can enforce confirmed team expiry by removing an unchanged managed pack. Individual expiry keeps installed personas; your personal and project libraries aren't touched. Read the current state when needed:

```bash
ewai persona premium status --project . --json
```

The normal EWAI check-in and explicit status command report three separate facts:

1. whether premium access is available;
2. whether the managed premium library is installed;
3. whether an installed library is verified against its validated content and external receipt.

Remote freshness is a further fact: a verified local library can remain installed while network access is unknown. Entitlement, installed state, verified state, and active persona engagement are not interchangeable.

Check-in does not download premium content. If it offers an install or update, decide explicitly whether this project environment should receive it. Only after that decision run:

```bash
ewai persona premium sync --project . --yes
```

The `--yes` flag is an intentional consent boundary. Do not hide this command in unattended setup or run it merely because access exists.

The sync process protects the managed cache and uses a fresh staged candidate:

- it checks licence access with the configured website;
- it verifies the downloaded ZIP against the advertised checksum and size;
- it refuses to replace locally edited managed files;
- it validates the manifest, safe paths, allowed text/data files, file count and bounded size;
- it records a deterministic content digest in a receipt outside the pack;
- it atomically promotes valid content and restores the prior pack if promotion fails.

Do not edit premium definitions in place, copy them into public project history, or present them as project-owned evidence. If the project needs a durable local variation, author a new project persona that states what changed and why.

The public persona schema uses its published ownership tiers. Guided Discovery presents personas loaded from the managed premium library with the user-facing tier `premium`. Do not hand-author a project file with `tier: premium`; use the supported sync path and preserve managed provenance.

## Use blueprint-derived personas

An [Organisation Blueprint Pack](designing-organisation-blueprint-packs.md) may contain persona templates. Selection does not immediately add them to the active ensemble.

During Review, EWAI shows the persona consequences alongside the selected standards and boilerplate receipts. After named approval it materialises each template as a project persona with:

- an ID in the form `project.<publisher>.<persona>`;
- `tier: project`;
- the source pack, version, digest, approver, and approval time;
- project-owned Markdown under `SPECS/1.Scope/personas/project/`.

From that point, the definition is a project-owned asset and can be improved through the project's normal reviewed change process. Its responses remain advisory; they aren't evidence from a real stakeholder.

## How Discovery engages personas

Discovery does not permanently activate every installed persona. For the current section it:

1. compares the section's perspective signals with persona metadata;
2. adds smaller relevance signals from existing answers;
3. ranks candidates by match strength, then by tier and stable name/ID ordering;
4. deliberately tries to include a relevant project persona and a relevant premium persona;
5. fills the remaining places with the strongest relevant candidates, up to four.

The tier tie-break order is project, premium, personal, then core. Relevance comes first: a high-tier persona with no match is not engaged.

### What you'll see in Discovery

At every Discovery section, EWAI shows the current personas. For each one you'll see:

- **name** — who the lens represents;
- **tier** — where it came from;
- **engagement reason** — why it is relevant to this section;
- **matched concerns** — the perspective signals that caused the match, when useful.

The active list can change as the participant moves between sections or adds answers. That is expected: personas are being swapped in and out to fit the work at hand.

Use this display to understand and challenge the selection. If a critical perspective is absent, ask EWAI to reconsider the focus. If the catalogue lacks the necessary project-specific perspective, you can review and improve its metadata or create a project persona; bring in real stakeholders wherever their evidence is needed. The [UI integration guide](personas/persona-engagement-ui.md) describes the presentation requirements for interface authors.

## Use personas in a working session

1. State the real decision and the real people affected.
2. Check the active persona names, tiers, and reasons before answering the section.
3. Invite the persona questions that expose a distinct risk, user need, or operational consequence.
4. Label what comes from real evidence and what is a persona-generated hypothesis.
5. Ask EWAI for a missing perspective. It handles contextual selection; you decide whether a new or improved project persona is needed and review its definition.
6. Record the accountable human decision in project-owned SPECS.

Personas should broaden the conversation, then get out of the way of evidence and ownership.

## About overlays

The project contract reserves a persona `overlays` area for future composition patterns. The current persona resolver does not automatically merge those files into active personas.

For behaviour you need today, put the complete reviewed persona in the project-persona directory. Do not rely on an overlay file being discovered or composed automatically.

## Maintain and review personas

- Keep IDs stable; change names and descriptions deliberately.
- Increase the version when the perspective or evidence standard changes.
- Review project personas with the real roles they represent whenever practical.
- Remove obsolete keywords rather than allowing stale personas to keep matching.
- Check version control for unexplained changes to project personas.
- Re-run `ewai persona list --project . --query <term>` after changes.
- Confirm in Guided Setup that the expected names, tiers, and engagement reasons appear in the relevant sections.
- Never interpret a persona response as approval.

## Troubleshooting

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Persona is missing from the catalogue | Wrong scope/root, invalid Markdown metadata, or project path not supplied | Run `persona path`, inspect the file, and list again with `--project .`. |
| Persona never becomes active | Its metadata does not match the section's signals or current answers | Make description, tags, and capabilities more specific to the intended decisions. |
| Too many generic personas appear | Broad or duplicated keywords produce similar relevance scores | Narrow their missions and metadata; keep one accountable lens per distinct concern. |
| Premium library is absent | Access may be unavailable or sync has not been explicitly approved | Read check-in status and choose whether to install it through [premium setup](operations/premium-personas-setup.md). |
| Premium update is refused | Managed files were edited, the installed pack belongs to another seat, or archive validation failed | Preserve edits and read the specific error. Don't force replacement. Use the [setup and recovery guide](operations/premium-personas-setup.md). |
| Overlay has no effect | Automatic overlay composition is not current behaviour | Move the complete reviewed perspective into a project persona. |

## Related guides

- [Designing Organisation Blueprint Packs](designing-organisation-blueprint-packs.md)
- [Persona entitlement and pack providers](persona-entitlement-provider-guide.md)
- [Product Owner guide](product-owner-guide.md)
- [All EWAI guides](README.md)

## Contract sources

- `src/personas.mjs` — personal/project roots, creation template, parsing, listing, and indexing
- `config/persona.schema.json` — public metadata contract
- `src/checkin.mjs` — safe check-in and CLI entitlement adapters
- `src/persona-entitlements.mjs` — provider access, pack validation, receipts, atomic promotion, and recovery
- `src/runtime/dashboard-server.mjs` — core, premium, personal, and project catalogue assembly
- `src/runtime/guided-discovery.mjs` — contextual matching, tier tie-breaks, maximum ensemble, and engagement reasons
- `src/discovery.mjs` — blueprint persona materialisation and provenance
