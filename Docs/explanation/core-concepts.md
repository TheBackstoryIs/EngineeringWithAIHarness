# The parts you'll use in EWAI

These terms turn up while you're working. You don't need to learn them all before [starting a project](../tutorials/first-session.md).

| Term | What it means in your work |
| --- | --- |
| Host | The AI tool you're talking to, such as Codex or Claude Code. It runs the guided conversation and supporting tools. |
| Skill | Instructions that help the host perform a particular job. You can ask naturally; you don't need to invoke every skill by name. |
| ewai-deliver | The coordinating skill for feature delivery. It brings other skills into the fourteen-stage workflow. |
| Runtime | The CLI and shared domain code that read project state, validate inputs and record permitted operations. It doesn't make a human decision for you. |
| Dashboard | A local interface to your project's work. Its loopback URL isn't a remote team workspace. |
| SPECS | Scope, Purpose, Evidence, Constraints and Strategy: readable files for project knowledge and delivery evidence. |
| Intent | One proposed outcome, with its context, boundaries and acceptance criteria. `support/export-filtered-tickets` is an example identifier, not a universal command argument. |
| Persona | An advisory perspective used to challenge a decision or find gaps. It isn't evidence of a real user's opinion or approval. |
| Source Map | A derived index of repository files and relationships. Check its coverage and the underlying source before relying on a finding. |
| Blueprint | Reviewed organisational guidance packaged for adoption by a project. It isn't required for every project. |
| Gate | A check that the required evidence and approvals exist before work progresses. A failed gate calls for a correction or decision, not a manual status edit. |
| Digest | A content fingerprint. A changed digest means the content differs; it doesn't tell you whether the change is good. |
| Receipt | A saved record of an operation, such as selecting a particular pack version. It proves what was recorded, not that a person accepted every resulting change. |
| Pack installation, selection and application | Installation makes a pack available. Selection records which approved pack the project uses. Application prepares its relevant guidance for particular work. These aren't interchangeable. |

## Where to make a change

Change requirements and decisions through their reviewed workflows. Rebuild an index when it is stale. Don't edit a derived database to manufacture an approval or change canonical project knowledge.

The [dashboard and delivery state guide](../operations/dashboard-and-delivery-state.md) explains inspection and queued work. [Human approval and assurance](../human-approval-and-assurance-guide.md) explains who can accept which outcomes.
