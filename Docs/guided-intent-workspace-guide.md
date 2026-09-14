# Guided Intent Workspace

The Guided Intent Workspace, labelled **Intent Studio** in the local dashboard, helps a product owner, facilitator, or engineer shape one feature intent without using the command line. It supports two bounded outcomes:

- **Create a new intent** from a recoverable draft.
- **Reconcile an eligible draft intent** while preserving its identity and delivery relationships.

It does not replace participant conversations, approve delivery, or turn model output into project truth. Premium personas aren't required to create or review an intent. Installed personas improve the questions and challenges presented during shaping.

## Before you begin

Run the normal EWAI check-in and open the local dashboard URL it returns. Select **Intent Studio** from the main navigation.

The workspace reads its project and persona context from the local EWAI runtime. It does not accept a project root, model provider, delivery command, or arbitrary output path from the browser.

## Create a new intent

An **intent identifier** points to one proposed outcome. For example, domain `support` and slug `export-filtered-tickets` identify a feature to export the filtered ticket list; its saved reference may include the domain. Use the reference EWAI returns in later commands rather than copying an example slug. Keep the title human-readable—the identifier is for finding the same work again.

1. Select **Create a new intent**.
2. Give the intent a stable slug, domain and title.
3. Work through the evidence spine:
   - identity;
   - problem;
   - desired outcome;
   - users and affected roles;
   - journeys;
   - acceptance criteria;
   - constraints and non-goals;
   - intent relationships;
   - delivery shape;
   - evidence;
   - open decisions;
   - review.
4. Use **Save and continue** to store a project-local draft and move to the next section.
5. At Review, resolve every blocking omission and check the exact Markdown and JSON destinations.
6. If you're the accountable approver, enter your name, confirm the review statement and approve the current draft revision. Otherwise, have that person review and approve it themselves.

Approval atomically creates the canonical adjacent Markdown and JSON intent records. It does not approve Build, Manual QA, certification, deployment, or release.

## Reconcile an eligible draft intent

Choose **Reconcile an eligible draft intent**, then select a listed intent. An intent is eligible only when it is still genuinely draft work: its canonical Markdown and JSON agree, and delivery has not started.

The workspace imports the existing intent into a new project-local working draft. Identity, relationships and delivery state remain protected. You can refine the title, personas, delivery shape and evidence-bearing intent sections.

Review displays the proposed before and after values. A named approval of the current revision performs one atomic canonical replacement. If the underlying intent has moved into delivery or no longer matches the imported identity, reconciliation is rejected and the working draft is retained for recovery.

## Recoverable drafts and revision conflicts

Every successful save creates a new draft revision. If another tab or operator saved after you opened your copy, your save is rejected with a **revision conflict** rather than overwriting their newer work.

When that happens:

1. Copy any unsaved text you need to retain.
2. Reload Intent Studio to obtain the current project-local draft.
3. Reapply the relevant change and save again.

**Discard draft** requires explicit confirmation and the current revision. It removes only the recoverable working draft, never an approved canonical intent.

Failed canonical creation or reconciliation leaves the project-local draft in place. Resolve the reported collision or consistency problem, reload if necessary, and retry.

## How persona engagement works

EWAI recalculates the actively engaged personas when the current section or material draft context changes. The right-hand rail shows, for each active persona:

- name;
- source tier: project, core, installed premium, or personal;
- the signals that matched;
- why the persona is engaged now.

The ensemble is deliberately replaced as the work moves from problem framing to journeys, assurance, delivery shape, and review. A small relevant ensemble is more useful than asking every persona every question.

The **Standard host-model baseline** remains sufficient when no persona matches. Premium personas are optional. When the installed premium library is unavailable, the workspace explains that state and continues; it does not download or synchronise premium content. Project-local and personal personas can add organisation-specific language and responsibilities without weakening the baseline.

Personas are advisory lenses. Their output is not participant evidence, legal approval, specialist assurance, business acceptance, or permission to build. Record interviews, workshops, repository observations, policies and research under Evidence, and keep unresolved claims under Open decisions.

## Using the AI review hand-off

**Copy AI review hand-off** places a bounded summary and instructions on the clipboard for use in the current host-model conversation. It does not send project data to a browser-selected provider, call a hidden model endpoint, save model output, or approve the draft.

Ask the model to identify ambiguity, missing evidence, conflicting acceptance criteria, overlooked users and delivery-shape concerns. Bring useful suggestions back into the relevant section yourself and preserve their status as hypotheses until supported.

## Review and accountable approval

The Review section provides four distinct checks:

1. **Readiness:** structural omissions that prevent materialisation.
2. **Exact destinations:** the canonical Markdown and JSON paths that will change.
3. **Before and after:** reconciliation changes, when applicable.
4. **Accountable intent decision:** a named approval tied to the current revision.

Intent approval means only: “this is an adequate statement of the intended outcome and its current evidence, constraints and open decisions.” Build approval remains a later durable gate. Manual QA, certification, deployment and release also remain separate decisions.

## For EWAI maintainers

The tests for changing Intent Studio itself are in [Verify changes to EWAI](maintainers/verification-walkthroughs.md#intent-studio). They aren't steps you need to complete to use the workspace.

## Troubleshooting

**No intent appears for reconciliation:** it is not a consistent draft, delivery has started, or its Markdown and JSON do not agree. Resolve canonical state through the governed workflow rather than bypassing the filter.

**Premium personas are unavailable:** continue with the standard baseline and installed project or core personas. Use the normal entitlement and installation process separately if premium access is expected.

**A save is rejected:** reload after preserving unsaved text. Revision conflicts are intentional concurrency protection.

**Approval is disabled:** complete the blocking fields, provide the approver name, tick the review confirmation, and ensure the displayed revision is current.

**Canonical materialisation fails:** the draft remains recoverable. Review the collision or consistency message; do not edit delivery state to force eligibility.
