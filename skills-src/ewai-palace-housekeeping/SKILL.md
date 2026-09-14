---
name: ewai-palace-housekeeping
description: Inspect and maintain an EWAI project's SPECS Mind Palace using deterministic tidiness findings, the SPECS Knowledge Curator persona, and human-reviewed changes. Use when the user asks to tidy, clean, organise, validate, deduplicate, reconnect, or review project knowledge; when `ewai palace tidiness` recommends housekeeping; after Archaeology, Context Import, a large Retro, or substantial SPECS changes; or when knowledge appears stale, conflicting, unsupported, misplaced, duplicated, orphaned, or linked to files that no longer exist.
---

# EWAI Palace Housekeeping

Keep the project Mind Palace trustworthy without treating AI interpretation as project truth. Deterministic checks identify possible disorder; the SPECS Knowledge Curator and project owner decide what it means and what should change.

## Inspect before interpreting

1. Run `ewai palace tidiness --project <root> --json`.
2. If the result is `tidy`, report the no-op clearly and stop. Do not manufacture improvements.
3. Read every flagged source document before proposing a change. A filename or link graph is evidence of structure, not evidence that the content is wrong.
4. Use `ewai palace search <query> --project <root> --json` to find related decisions, intents, personas, standards, risks, runbooks, evidence, and code references.
5. Apply the `ewai.core.specs-knowledge-curator` perspective when routing accepted knowledge.

Treat tidiness codes as prompts for review:

- `broken-internal-link`: verify whether the target moved, was intentionally removed, or was never created.
- `duplicate-content`: determine the canonical record; similar files can legitimately represent different scopes.
- `orphaned-document`: decide whether to add meaningful links, refile it, archive it, or leave it intentionally independent.
- `missing-title` or `empty-document`: distinguish incomplete knowledge from an intentional placeholder or machine-readable artefact.

## Review with the user

Offer these routes in plain language:

1. A short walkthrough grouped by the decisions one answer can resolve.
2. A document-by-document review.
3. A proposed housekeeping plan without changing anything.
4. Apply only the low-risk corrections the user explicitly approves.

Synthesize cross-document questions so one answer can resolve several genuinely shared findings. List every affected file before asking. Split the question when one answer would conceal meaningful differences.

## Apply approved housekeeping

- Never delete, merge, archive, refile, supersede, or rewrite canonical SPECS without explicit approval.
- Preserve provenance and history. Prefer superseding links over erasure.
- Do not promote an inference into a decision, constraint, standard, requirement, persona, risk, or accepted fact.
- Refuse to overwrite different canonical knowledge silently.
- Keep raw archaeology and context-import evidence in its evidence bundle when accepted knowledge is curated elsewhere.
- Update affected indexes and reciprocal links when a record moves or changes status.
- Do not commit changes unless the user asks.

After approved changes:

1. Run `ewai palace refresh --project <root>`.
2. Run `ewai palace tidiness --project <root> --json` again.
3. Explain what improved and what remains deliberately unresolved.
4. Record material housekeeping under `SPECS/3.Evidence/palace-housekeeping/<date>-<subject>.md`, including the before/after findings, approvals, changed records, deferred items, and provenance. Do not create a report for a no-op unless the user requests one.

## Completion contract

Housekeeping is complete only when approved changes are applied, the derived index is refreshed, tidiness is rerun, unresolved findings remain visible, and no canonical meaning was changed without owner approval.
