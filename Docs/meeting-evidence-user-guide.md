# Meeting evidence user guide

Use Meeting evidence when you have meeting minutes or an existing transcript and want to turn useful statements into traceable project evidence without treating the conversation as automatic project truth.

Ask EWAI: “Help me analyse these meeting notes and show the information we might use as project evidence.” Identify the local file and agree its classification and processing permission before analysis. EWAI uses the `ewai-meeting-evidence` skill to prepare proposed statements and source references. You review every proposal; a separate approval saves the accepted evidence. You don't need to construct the extraction contract yourself. The commands below let you inspect or repeat the individual steps.

The workflow is **register → prepare → review → promote**. Each boundary is deliberate: registration records permission, preparation establishes safe processing and personas, review records a named human decision for every candidate, and promotion creates evidence only.

## What you need

- An initialised EWAI project.
- A local `.md`, `.markdown`, `.txt`, `.text`, `.vtt` or `.srt` source.
- Authority to process the material.
- A classification and an explicit decision about hosted cloud processing.
- A named reviewer and, later, a named evidence approver.

Meeting evidence does not connect to Teams, Zoom or another meeting platform and does not transcribe audio or video. Export or prepare the source before using EWAI.

## What the capability produces

Meeting evidence does not import a transcript into the project knowledge base.
It produces a reviewed evidence record that can be cited by later governed work.

The workflow deliberately keeps three layers separate:

1. **Private source registration** records the local path, classification,
   processing policy and file digest in gitignored EWAI runtime state. This is
   how EWAI can detect a changed or missing source without publishing its
   contents.
2. **Candidate and review state** records concise proposed observations,
   interpretations, line anchors and the named review decision for every
   candidate. Rejected and deferred material stays here rather than becoming
   project evidence.
3. **Promoted evidence** writes only accepted and amended statements, safe
   provenance and integrity digests into paired Markdown and JSON files under
   SPECS. The source text, absolute path and rejected statements are not copied
   with them.

This means a later intent, plan or decision can cite the meeting evidence while
still showing where it came from and who accepted it. It does not mean the
meeting has become unquestionable truth. A human must still reconcile the
evidence with current product, stakeholder and repository evidence.

## How personas participate

Persona engagement is contextual rather than a fixed panel attached to every
meeting. During preparation, EWAI starts with the standard host model and the
relevant project and EWAI core personas. That baseline is complete and does not
depend on a paid library.

If premium or personal personas are already installed, EWAI can select relevant
ones for specialist depth. For example, a Product Owner lens may identify an
unresolved outcome, an Operator may expose a recovery concern, and a privacy
specialist may flag a statement that should not be promoted without more
evidence. Changing the source or focus replaces personas that are no longer
relevant rather than accumulating an ever-growing panel.

Every interface shows the personas currently engaged, including:

- the persona name and tier: project, core, premium or personal;
- the concern or signal that caused it to be selected;
- why it is useful at this point in the workflow.

Personas help propose questions, interpretations and candidate coverage. They
cannot supply missing stakeholder evidence, decide that a statement is true,
review their own candidates, accept risk, approve Manual QA or authorise a
release. Those decisions remain with named people.

## Ways to use it

The same domain workflow is available through four surfaces:

| Surface | Best used for | Important boundary |
| --- | --- | --- |
| CLI | Repeatable local operation, scripting and inspecting exact JSON results | Commands still require the same named review and promotion confirmation |
| EWAI skill | Asking an AI host to analyse an allowed source and prepare schema-valid candidates | The skill cannot inspect denied or unknown cloud-processing material and cannot approve its own output |
| MCP tools | Letting a compatible AI host register, prepare, review or promote through typed operations | The server owns the project root; callers cannot redirect operations to another folder |
| Mind Palace | Human inspection of sources, provenance, dispositions and active personas | It never previews raw transcript content or silently calls a model |

These are adapters over one evidence contract, not four different workflows.
A candidate prepared through the skill can be inspected in Mind Palace and
promoted through the CLI without changing its review or authority requirements.

## 1. Register the source

```bash
ewai meeting register ./meeting-notes.txt \
  --project . \
  --label "Product review" \
  --classification internal \
  --cloud-processing allowed \
  --yes \
  --json
```

Choose `public`, `internal`, `confidential` or `restricted`. Set cloud processing to `allowed`, `denied` or `unknown`; never select `allowed` merely to make the workflow convenient.

EWAI fingerprints the file and stores its absolute path in private gitignored runtime state. It does not copy raw meeting material into SPECS or return the path in public status data.

## 2. Check processing permission and prepare analysis

EWAI checks that the file hasn't changed and establishes what processing is allowed before the host analyses it. You'll see the source status and relevant persona perspectives. If you want to inspect preparation directly, run:

```bash
ewai meeting prepare <source-id> --project . --json
```

Preparation checks that the registered digest is current and returns:

- whether hosted processing is permitted;
- the strict candidate schema and line bounds;
- safe source facts;
- the active persona ensemble, including each name, tier, matched concern and engagement reason;
- the human-authority boundary.

See [how personas participate](#how-personas-participate) for selection and authority. Preparation never installs or updates a persona pack; changing the focus or source replaces the active ensemble.

If processing is denied or unknown, the result names a manual local handoff. A hosted AI must not open the source.

Preparation isn't a successful extraction: proposed statements come next, and none become evidence until reviewed and approved. The host's permitted source, output format and citation limits are defined in the [implementer guide](meeting-evidence-implementer-guide.md); you don't need to author that protocol to use the guided conversation.

## 3. Review candidates

An AI host using `$ewai-meeting-evidence` can prepare a candidate bundle. Each item separates a concise observed statement from interpretation and cites exact line anchors. Raw transcript excerpts are excluded.

Review every candidate as `accepted`, `rejected`, `amended` or `deferred`. Amendments require replacement text and a rationale. Then record the complete named review:

```bash
ewai meeting review <source-id> \
  --input ./meeting-review.json \
  --reviewed-by "Product Owner" \
  --project . \
  --json
```

The input file contains both `bundle` and `dispositions`. Follow the [complete meeting-review example](examples/meeting-review.md) for the candidate schema, the registration ID/digest handoff and the files created after promotion.

The input file must be inside the project. A persona cannot perform this review for you.

## 4. Inspect in the Mind Palace

Open the loopback dashboard, select **Mind Palace**, then choose the keyboard-reachable **Meeting evidence** mode.

The source rail shows safe labels, classification, processing policy, digest freshness and counts. For each proposed statement, you can see where it came from in the meeting notes, how the reviewer treated it, and whether it was added to the saved evidence. The context rail always shows the active personas and their tiers. It never shows a raw transcript or absolute source path.

“Prepare extraction” returns a contract to the dashboard; it does not call a model. “Promote accepted” appears only for a current, fully reviewed source.

## 5. Promote evidence

Check status first:

```bash
ewai meeting status <source-id> --project . --json
```

Then make a separate named decision:

```bash
ewai meeting promote <source-id> \
  --project . \
  --yes \
  --approved-by "Product Owner" \
  --json
```

Only accepted and amended candidates are written to paired files under the configured SPECS root at `3.Evidence/meeting-evidence/<source-id>/`. Rejected and deferred history remains in the private review record.

The paired files serve different readers while representing the same accepted
evidence set:

- Markdown provides a readable provenance and review record for people.
- JSON provides deterministic identifiers, anchors, digests and dispositions
  for EWAI tooling.

Promotion checks both the registered source digest and reviewed candidate
digest before writing. If either changed, it stops instead of silently applying
an old decision. The paired write is atomic, so an interrupted promotion cannot
leave Markdown and JSON claiming different outcomes. Repeating an identical
promotion returns the existing receipt rather than duplicating evidence.

If your project uses [lifecycle hooks](using-lifecycle-hooks.md), promotion can notify them through `ewai.meeting-evidence.promoted`. The notification excludes transcript text, the source path and credentials. A hook failure doesn't undo the saved evidence; see the implementer guide for the event format.

Promotion does not create a task, intent, requirement, process, policy, persona, architecture decision, Build approval, accepted risk, Manual QA result or release decision. Use the normal governed workflow if the evidence suggests downstream work.

## When EWAI stops

- **Source stale or missing:** register or review the current file; old review cannot be promoted.
- **Processing denied or unknown:** use an approved local route; hosted inspection is blocked.
- **Malformed candidates:** correct the candidate JSON; do not edit around validation.
- **Incomplete review:** record one decision for every proposed statement: accept it, amend it, reject it or defer it.
- **Conflicting evidence pair:** preserve it and investigate instead of overwriting it.
- **Repeated identical promotion:** EWAI returns the existing result idempotently.

Accepted meeting evidence can still be incomplete or wrong. Check the sources, interpretation and relevance before using it in a decision. If the notes raise security concerns, route them through [security validation](security-validation-guide.md); promoting the notes doesn't resolve those concerns.

## Related guidance

- [Working with personas](working-with-personas.md)
- [Human approval and assurance](human-approval-and-assurance-guide.md)
- [Meeting evidence implementer guide](meeting-evidence-implementer-guide.md)
