# Evidence-to-Knowledge Proposals implementer guide

Use this guide when extending EWAI or building an integration for knowledge proposals. The CLI, MCP tools and dashboard all call the same domain module. That module validates destinations, review decisions and file changes; the interfaces must not implement different rules.

Connectors are not implemented by this capability; organisation-owned consumers use the generic post-persistence lifecycle-hook boundary.

## Domain architecture

`src/knowledge-proposals.mjs` owns the domain rules, grouped here by responsibility:

- sources and preparation: promoted-meeting-evidence and retrospective adapters, bounded reads, digests, anchors, contextual installed-persona selection and the host-model contract;
- proposals and decisions: closed taxonomy, evidence-only bundles and complete named review;
- publication and recovery: separately confirmed materialisation, additive/current/conflict classification, transaction journals and idempotency;
- integration: public-safe state and `ewai.knowledge-proposals.materialised`.

The configured project root comes from EWAI. MCP and browser callers cannot provide another root.

## Storage

```text
3.Evidence/knowledge-proposals/<bundle-id>/
├── bundle.json
├── review.json
├── materialisation.json
└── proposals/SPECS/<closed destination>.md
```

The `proposals/` tree is evidence, not canonical destination knowledge. A private journal under `.ewai-pipeline/knowledge-proposals/transactions/` records transaction-owned destinations and a `createdDigests` map of the SHA-256 of each recorded write. It stores no document bodies.

Bundle, review and materialisation records have independent digests. Materialisation re-resolves the source and verifies all authority layers before any destination write.

## Domain operations

| Function | Mutates | Boundary |
| --- | --- | --- |
| `listKnowledgeSources` | Nothing | Allowlisted canonical source families, no content/path |
| `prepareKnowledgeProposals` | Nothing | Bounded model context, strict schema and active personas |
| `recordKnowledgeProposalBundle` | Proposal evidence only | Closed taxonomy, exact destination, anchors and provenance |
| `recordKnowledgeProposalReview` | Review evidence only | Named complete dispositions and amendment rationale |
| `materialiseKnowledgeProposals` | Absent accepted destinations and ledger | Separate exact confirmation, named approver and digest revalidation |
| `recoverKnowledgeMaterialisation` | Unchanged transaction-created files or stale journal | Exact confirmation, safe paths and matching creation digests; preserve unknown or changed files |
| `readKnowledgeProposalWorkspace` | Nothing | Safe source, proposal, review, outcome and persona projection |

Normal materialisation doesn't overwrite, merge or delete an existing destination. An identical file is current; a differing file is a conflict. Interrupted recovery is a separate operation that may remove unchanged transaction-created files under the conditions below.

## CLI, MCP and HTTP

CLI:

```bash
ewai knowledge sources --project . --json
ewai knowledge prepare SOURCE_REF [--focus TEXT] --project . --json
ewai knowledge record SOURCE_REF --input FILE --project . --json
ewai knowledge review BUNDLE_ID --input FILE --reviewed-by NAME --project . --json
ewai knowledge materialise BUNDLE_ID --yes --approved-by NAME --project . --json
ewai knowledge recover BUNDLE_ID --yes --project . --json
ewai knowledge status [BUNDLE_ID] --project . --json
```

MCP exposes matching `ewai_knowledge_proposal_*` tools. Sources, status and prepare are read-only. Record and review are non-destructive mutations. Materialisation is additive and non-destructive. Recovery is marked destructive because it can remove transaction-owned incomplete files. No tool accepts `projectRoot`.

Loopback HTTP provides `GET /api/knowledge-proposals?bundle=<id>`, plus `POST` routes for prepare, record, review, materialise and recover. Browser-safe preparation strips `modelContext` and reports only that host context is available. AI-host CLI and MCP preparation receive the bounded content. Unknown query/body fields are rejected and errors include the mandatory disclaimer.

## Mind Palace behavior

Knowledge proposals is a secondary Mind Palace mode, not primary navigation. The source rail shows eligible evidence and bundles. The centre shows review receipts, provenance/destination cards and additive/current/conflict state. The context rail always shows actively engaged personas with name, tier and engagement reason.

The browser can prepare a safe host handoff, record a complete named review, separately materialise and recover. It cannot register arbitrary sources, preview source bodies, choose paths, sync premium content, create a downstream intent, approve Build, accept risk or release.

At 960px the ledger and context rail stack. At 600px review fields, receipts and cards use one column with no fixed-width child requiring horizontal scroll.

## Persona and model contract

Standard host-model reasoning and installed project/core personas are the complete baseline. Premium and personal personas are optional installed enrichment. Selection is contextual and replacement-based. Interfaces display the active ensemble but never expose managed persona bodies.

The host distinguishes source observation, interpretation and proposed knowledge. Only the final validated `ewai.knowledge-proposal-bundle/v1` enters evidence storage. Raw model output, prompts, chain-of-thought and discarded drafts are never stored.

## Lifecycle boundary

After canonical destination writes and the immutable ledger exist, EWAI publishes `ewai.knowledge-proposals.materialised` with bundle/materialisation identifiers and digests, added/current/conflict counts and timestamp. The event references the project-relative ledger and contains no source body, proposal body, prompt, credential or private path. Hook failure cannot veto, delete or roll back canonical truth. Consumers implement connectors through the generic hook contract.

## Recovery and idempotency

Before ledger persistence, an interrupted transaction retains its created paths and their original content digests. Recovery validates the complete destination list before deleting anything and inspects every path component from the workspace root, including ancestors of a nested SPECS directory. Only single regular files with unchanged bytes are removed.

Missing files need no action. Changed, linked, unreadable or oversized files, and existing files from legacy journals without digests, are preserved. Recovery keeps the journal and throws `KNOWLEDGE_RECOVERY_REQUIRES_REVIEW`; its message identifies affected relative paths and tells the user to review and back up the files. The error also includes `preserved` and `removed` arrays for local callers. Existing dashboard and CLI error handling presents this as a paused recovery, not a successful completion.

After ledger persistence, a remaining journal is stale runtime state and is removed without touching canonical destinations. Repeating a materialised bundle returns its existing result. These are local filesystem safeguards, not an atomic guarantee against another process changing paths concurrently; don't run recovery while another writer is modifying those destinations.

These safeguards protect the publication boundary; they don't establish the correctness of generated knowledge. Preserve named review and separate materialisation approval in any integration.

## Contract sources

- [src/knowledge-proposals.mjs](../src/knowledge-proposals.mjs)
- [config/knowledge-proposals-proposal.schema.json](../config/knowledge-proposals-proposal.schema.json)
- [src/runtime/lifecycle-hooks.mjs](../src/runtime/lifecycle-hooks.mjs)
- [src/cli.mjs](../src/cli.mjs)
- [src/runtime/mcp-server.mjs](../src/runtime/mcp-server.mjs)
- [src/runtime/dashboard-server.mjs](../src/runtime/dashboard-server.mjs)
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `tests/knowledge-proposals.test.mjs`
- `tests/knowledge-proposals-cli.test.mjs`
- `tests/lifecycle-hook-emissions.test.mjs`
- `tests/runtime.test.mjs`
