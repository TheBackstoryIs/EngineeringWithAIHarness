# Turn reviewed evidence into project knowledge

A meeting or retrospective can reveal a missing requirement, a useful working practice or a risk nobody had recorded. Knowledge proposals helps you turn that learning into proposed project documents, check each one and add only the changes you've agreed to SPECS.

The original evidence stays linked to the proposal. Reviewing a proposal and adding its file are separate decisions, so you can check the destination and content before anything becomes part of the project's working knowledge.

In normal use, [ask EWAI to help](#ask-ewai-to-help). The later [terminal exercise](#prepare-and-record-proposals-from-the-terminal) is a complete scripting example, not a requirement to write JSON before discussing the evidence.


<!-- editorial: contents -->
## On this page

- [What it produces](#what-it-produces)
- [Eligible evidence](#eligible-evidence)
- [How personas participate](#how-personas-participate)
- [Ask EWAI to help](#ask-ewai-to-help)
- [Prepare and record proposals from the terminal](#prepare-and-record-proposals-from-the-terminal)
- [Review every proposal](#review-every-proposal)
- [Approve adding the documents to SPECS](#approve-adding-the-documents-to-specs)
- [Recover an interrupted write](#recover-an-interrupted-write)
- [Ways to operate](#ways-to-operate)
- [Related guidance](#related-guidance)

## What it produces

EWAI saves the proposed documents together under `SPECS/3.Evidence/knowledge-proposals/`. This is a **proposal bundle**, not an update to your working documentation. For each proposal you can see the source passage it refers to, the proposed file and location, why it's useful and what's still uncertain. A reviewer must decide on every proposal before an owner separately approves adding the agreed files to SPECS.

The supported document types cover project personas, systems, processes, data concepts, journeys, pending requirements, feature candidates, risks, policies, constraints, standards, decisions, patterns, anti-patterns, runbooks and SOPs. Each type has an allowed location. A proposal can't invent another destination or change delivery state.

## Eligible evidence

Start with meeting evidence that's already been reviewed and promoted, or a retrospective saved in the project's SPECS. List the available sources below and use the returned source reference. A raw transcript, arbitrary folder or private review record isn't an eligible source; use [Meeting evidence](meeting-evidence-user-guide.md) first for a transcript. This workflow doesn't fetch material from an external connector.

```bash
ewai knowledge sources --project . --json
```

## How personas participate

EWAI selects relevant personas for the source and the concern you're exploring. Your normal AI assistant and the project/core personas are enough to use the workflow. Installed premium or personal personas can add specialist perspectives; this operation never downloads them.

Every interface shows active persona name, tier, matched signals and engagement reason. A Product Owner may question whether a feature candidate reflects an actual outcome; a Knowledge Curator may challenge its destination; an Archaeologist may distinguish current evidence from historical interpretation; and a project persona may apply local language or constraints.

Personas remain advisory. They cannot turn inference into fact, supply absent stakeholder research, perform named review, approve materialisation, accept risk or authorise release.

## Ask EWAI to help

In your EWAI conversation, ask: “Use `$ewai-knowledge-proposals` to review this retrospective and suggest what we should add to our project docs.” Identify the source from the list above. You'll review the proposed content and destinations before deciding whether to add any files. You don't need to author JSON for the conversational route.

To inspect a saved bundle, open **Mind Palace → Knowledge proposals**. The source document stays private; this view shows the proposed documents, their evidence references and any conflicts.

## Prepare and record proposals from the terminal

The following is a complete, fictional example for a disposable, initialised project. In real work, use a genuine reviewed source returned by `knowledge sources`; don't add fictional evidence just to make a command run. These paths assume the default `SPECS` location. If yours differs, use its actual relative path in the source and destination.

Save this example as `SPECS/3.Evidence/retros/sprint-24.md`:

<!-- example: knowledge-retrospective -->
```markdown
# Retrospective: Sprint 24

## What we learned

The team couldn't follow the recovery notes during a failed import.

## Agreed follow-up

Try recovery instructions with a colleague before the next release.
```

From the project root, prepare the source:

```bash
ewai knowledge prepare retrospective:sprint-24 --project . --json
```

Preparation doesn't create proposals or change files. Its JSON result includes `source.ref`, `source.digest` and `source.anchors`: the source identity, a fingerprint of its current contents and IDs for passages you can cite. Check the passage behind an anchor before using it. The AI host receives the allowed source context and format; the browser doesn't receive the source text.

Create `proposal-bundle.json` in the project root with the following content. Replace `SOURCE_DIGEST_FROM_PREPARE` with `source.digest`, and both occurrences of `ANCHOR_ID_FROM_PREPARE` with the ID of the passage supporting the proposal. Preserve the outer `bundle` object: that's what the CLI reads.

<!-- example: knowledge-proposal-bundle -->
```json
{
  "bundle": {
    "schema": "ewai.knowledge-proposal-bundle/v1",
    "sourceRef": "retrospective:sprint-24",
    "sourceDigest": "SOURCE_DIGEST_FROM_PREPARE",
    "proposals": [
      {
        "id": "KNP-001",
        "kind": "pattern",
        "title": "Try recovery notes before release",
        "destination": "SPECS/5.Strategy/patterns/try-recovery-notes.md",
        "evidenceAnchors": ["ANCHOR_ID_FROM_PREPARE"],
        "rationale": "The retrospective records difficulty following the recovery instructions.",
        "uncertainty": "Confirm which changes need a recovery walkthrough.",
        "relationships": [],
        "proposedMarkdown": "# Try recovery notes before release\n\nAsk a colleague to try the recovery instructions before release.\n\n## Provenance\n\n- Source: retrospective:sprint-24\n- Anchor: ANCHOR_ID_FROM_PREPARE\n"
      }
    ]
  },
  "activePersonas": []
}
```

This hand-written example has no persona contribution, so `activePersonas` is empty. When an AI host prepares the proposals, record the returned metadata for the personas actually used; don't invent contributors. Keep observation separate from interpretation in the proposal.

Record the file:

```bash
ewai knowledge record retrospective:sprint-24 \
  --input ./proposal-bundle.json \
  --project . \
  --json
```

The response returns a `bundleId`. Copy that value for the review and approval commands below. A successful record saves the proposals for review; it doesn't create `try-recovery-notes.md`.

Input files must be inside the project; run these examples from its root so relative paths resolve correctly. EWAI doesn't store raw model output, discarded drafts, prompts or source bodies in the bundle. The input files you save yourself remain your responsibility—keep them free of private source text.

## Review every proposal

Inspect each proposed kind, destination, anchors, rationale, uncertainty and destination state in **Mind Palace → Knowledge proposals**. The active personas remain visible alongside the bundle.

A named reviewer decides `accepted`, `rejected`, `amended` or `deferred` for every proposal. Rejected and deferred items need rationale. Amendments need replacement title, complete replacement Markdown and rationale.

For the single proposal above, save this as `proposal-review.json` **only if the reviewer accepts it**:

<!-- example: knowledge-review-accepted -->
```json
{
  "dispositions": [
    {"proposalId": "KNP-001", "decision": "accepted"}
  ]
}
```

`dispositions` means the decisions you've made. Include exactly one entry for each proposal ID in the bundle. Use the actual reviewer's name or accountable role in the command, not the example role unless that's who made the decision.

```bash
ewai knowledge review <bundle-id> \
  --input ./proposal-review.json \
  --reviewed-by "Product Owner" \
  --project . \
  --json
```

The response confirms the review and its decision counts. It still hasn't added the proposed document to SPECS.

### If the reviewer wants a change

Use this alternative `proposal-review.json` for the same one-proposal bundle. Replace the anchor placeholder with the same source anchor you checked earlier. An amendment replaces the whole proposed document, not a fragment; retain its `## Provenance` section and source reference.

<!-- example: knowledge-review-amended -->
```json
{
  "dispositions": [
    {
      "proposalId": "KNP-001",
      "decision": "amended",
      "rationale": "Limit this practice to changes that introduce or alter a recovery procedure.",
      "replacementTitle": "Check changed recovery procedures",
      "replacementMarkdown": "# Check changed recovery procedures\n\nWhen a change introduces or alters a recovery procedure, ask a colleague to follow it in a safe test environment before release.\n\n## Provenance\n\n- Source: retrospective:sprint-24\n- Anchor: ANCHOR_ID_FROM_PREPARE\n"
    }
  ]
}
```

### If the reviewer rejects or defers it

These are two alternative files for the same one-proposal bundle, not two decisions to submit together:

<!-- example: knowledge-review-rejected -->
```json
{
  "dispositions": [
    {"proposalId": "KNP-001", "decision": "rejected", "rationale": "The existing release checklist already covers this practice."}
  ]
}
```

<!-- example: knowledge-review-deferred -->
```json
{
  "dispositions": [
    {"proposalId": "KNP-001", "decision": "deferred", "rationale": "The release owner needs to confirm which changes require a walkthrough."}
  ]
}
```

Choose the correct decision before recording the review. A recorded review can't be replaced. EWAI allows one bundle per version of a source: changing only the proposal or review doesn't create another bundle and will be refused. A new bundle needs genuinely changed eligible evidence or a new eligible source. Don't edit evidence just to bypass this restriction. If the source hasn't changed, keep the existing record and ask the project owner how to handle the follow-up outside this workflow. Rejected and deferred proposals aren't added to working documentation.

If every proposal was rejected or deferred, stop here. There are no documents to add, and `materialise` will refuse the operation with “no accepted or amended records to materialise”.

## Approve adding the documents to SPECS

Check status with `ewai knowledge status <bundle-id> --project . --json`. Review the accepted content and destination conflicts. When the owner separately approves adding the documents, run the command below. **Materialise** is the CLI's name for this step; recording the review wasn't permission to do it.

```bash
ewai knowledge materialise <bundle-id> \
  --project . \
  --yes \
  --approved-by "Product Owner" \
  --json
```

EWAI handles each accepted or amended proposal independently:

- absent destination: add it;
- byte-identical destination: report it as current;
- differing, linked or non-file destination: report a conflict and leave it unchanged.

There is no automatic overwrite, model merge or deletion. Materialisation also does not create a ready intent automatically. A feature candidate remains a candidate until someone uses the normal intent and delivery workflow.

## Recover an interrupted write

If status reports `recovery-required`, inspect the bundle and ask an accountable person before running:

```bash
ewai knowledge recover <bundle-id> --project . --yes --json
```

Recovery removes a transaction-created file only when it is still a safe regular file and its bytes match the digest recorded at creation. It leaves edited files, symbolic links, hard-linked replacements and files with no original digest untouched. Older journals without digests therefore need manual review, not an automatic deletion.

If anything is preserved, you'll see **Recovery paused** with the affected paths and reasons. The journal stays in place; unchanged transaction files may already have been removed. Retrying doesn't force deletion.

Review and back up the listed files. If you choose to keep an edited document, move it to a safe location outside its proposed destination before retrying recovery. Once recovery finishes, restore your document; a later materialisation will report it as a conflict rather than overwrite it. Ask the project owner before moving shared work. Don't delete or rewrite the journal just to clear the warning.

If the final materialisation ledger already exists, recovery removes only the stale journal and leaves the completed documents in place.

## Ways to operate

| Surface | Best use | Boundary |
| --- | --- | --- |
| CLI | Repeatable local operation and exact JSON | Project-relative inputs and the same human gates apply |
| EWAI skill | Persona-led analysis and schema-valid drafting | It cannot approve its own proposals |
| MCP | Typed AI-host preparation, record, review and materialisation | Server owns the project root; recovery is explicitly destructive |
| Mind Palace | Source route, proposals, conflicts, review and active personas | It never shows private source bodies or grants release authority |

Saving a reviewed proposal makes it project knowledge, not proof that its claims are correct. Review the source, intended meaning and applicability with the responsible people. Security concerns still need the separate [security validation workflow](security-validation-guide.md).

## Related guidance

- [Meeting evidence user guide](meeting-evidence-user-guide.md)
- [Working with personas](working-with-personas.md)
- [Human approval and assurance](human-approval-and-assurance-guide.md)
- [Knowledge proposals implementer guide](knowledge-proposals-implementer-guide.md)
