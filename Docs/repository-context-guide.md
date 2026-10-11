# Repository context guide

Use repository context when you want the index to travel with the file you are reading, the command you are running, and the change you are about to make.

The reading is advisory. It names evidence the index can see. Personas advise. Accountable people decide. Nothing in this reading approves Build, Manual QA, or release.

## What you receive

A session reading says whether a completed index exists, which commit it indexed, and whether HEAD is ahead of that commit. A spec-only commit can move HEAD without making the file fingerprints stale. The session reading names an active intent when one is in the active lane. It does not dump SPECS.

A file reading is for that file only:

- resolved callers, with the basis of each resolution;
- recorded routes on that file;
- ownership and files that usually change with it, when git history is available;
- records that name the file;
- a decision-point hint.

An empty caller list is not proof that nothing calls the file. If the file on disk differs from the indexed fingerprint, the reading stops there.

A change rank orders the current diff against this repository’s own recent commits. It is not a probability. The command stays quiet when the diff is small and no directive applies. Directives can name a route, a missing co-change, a missing test file, or a record that names a changed file.

A health packet orders one file for review. The rank uses change history, authorship, decision-point density, and nearby tests. Decision-point density is a keyword hint, not cyclomatic complexity. The packet does not create an intent. Creating an intent stays on the existing approved route after a person accepts it.

## How references resolve

Relative imports resolve in any language the index has stored. Composer PSR-4 prefixes, TypeScript and JavaScript path maps, package imports, a Go module prefix, and `~/` or `@/` aliases resolve when they name an indexed file. A map that claims a specifier but misses the file stays unresolved.

A bare dependency name is external. It is not evidence that the map is incomplete, and it is not evidence that nothing else references the file.

Recognised route conventions are stored on the file that declares them. File-based pages stay informational. A handler that resolves to another indexed file can appear in Blast Radius as a downstream relationship, within the same two-hop and eighty-node bounds.

PHP, JavaScript, TypeScript, and Vue can be read in depth. Other source files stay text-summary or inventory and still receive history, health, citations, and recognised route conventions.

## Citations

A citation says a project record names a file. The wording is “named by”. A citation has no stale, invalid, or expired state. SPECS and ADRs are broader than one file. A retrospective asks what surprised the team or contradicted the SPECS, and that review is what changes a record. The index does not edit SPECS.

## Commands

```bash
ewai index update --project .
ewai index file <path> --project .
ewai index health <path> --project .
ewai index change-risk --project .
ewai index citations <path> --project .
ewai index adoption --project .
ewai context install --project .
ewai distill --project . -- <command>
```

`index update` re-parses missing, changed, and deleted files into the current run. It rebuilds the run only when there is no completed index or the profile catalogue has changed. A commit hook can run this in the background. A hook failure does not undo the commit.

`ewai distill` wraps a recognised test or git command. You still get the command’s exit code. The short reading is what an agent should start from. The full log is stored under `.ewai-pipeline/runtime/command-logs/`. Hash that log when the command is gate evidence. Distill does not replace a SPECS context pack.

The dashboard Repository view shows the same signals. On a work item, the impact reading includes index freshness, the change rank, and the reminder that a health packet does not create an intent.

## Adoption

EWAI counts file cards, session cards, repeated cards that were kept back, index searches, index graphs, and distill runs. `ewai index adoption` reads those counts. The counts measure whether the reading is being used. They are not a cost report.

## Boundary

Local git history never changes canonical SPECS or delivery evidence. If the project is not a git repository, history is unavailable and the index still completes. Editor hooks read the local index and local git state. They do not call a model, and a hook failure stays silent.

Lifecycle hooks are a different feature. They notify an organisation handler after a milestone. They cannot approve or veto that milestone.

## Related guides

- [Repository Source Map](repository-source-map-guide.md)
- [Blast Radius and Impact Routing](blast-radius-and-impact-routing-guide.md)
- [CLI and configuration reference](reference/cli-and-configuration.md)
- [Dashboard and delivery state](operations/dashboard-and-delivery-state.md)
