# Verify changes to EWAI

These checks are for engineers maintaining the EWAI harness. They aren't extra setup or acceptance tasks for someone using EWAI on their own project.

Run the test commands from an EWAI source checkout with its development dependencies installed. They aren't npm scripts to add to a consuming application's package.json. Use disposable projects and synthetic records for failure-injection tests; don't run them against someone's active work.

Automated checks and the manual walkthroughs below cover different things. Passing a suite doesn't mean a human has completed the walkthrough or approved a release.

## Intent Studio

User guide: [Intent Studio](../guided-intent-workspace-guide.md).

Before accepting the feature for release, test it in the browser at desktop width and at 390 px:

1. Create, save, leave, and resume a draft.
2. Open the same draft in two tabs and confirm a stale save reports a revision conflict.
3. Discard a draft and confirm no canonical intent was removed.
4. Move through several sections and confirm the active persona names, tiers, matched signals and engagement reasons change appropriately.
5. Confirm the Standard host-model baseline remains visible when premium personas are absent.
6. Complete a new intent, inspect the exact destinations, and confirm unnamed or stale approval cannot materialise it.
7. Reconcile an eligible draft intent and inspect the before and after comparison.
8. Confirm an intent with active delivery is not offered for reconciliation.
9. Copy the AI review hand-off and confirm no draft field or approval state changes.
10. Confirm the approval copy clearly says it does not approve Build, Manual QA, certification, deployment, or release.

Record the observed evidence through the EWAI Manual QA gate. Automated tests and persona review do not complete that human gate.

## Solution Readiness Review

User guide: [Solution Readiness Review](../solution-readiness-review-guide.md).

Use a disposable initialized project and a real delivery slug.

1. List all five profiles and explain why their requirements differ.
2. Prepare `internal-only`; open at least three citations and compare their digests and limitations.
3. Prepare `critical-regulated`; confirm every dimension and named specialist route is visible.
4. Read **Active personas**. Confirm ID, tier and engagement reason are visible, premium is optional, and no persona is an approver.
5. Record fixtures producing `ready-for-human-decision`, `conditional`, `blocked` and `insufficient-evidence`.
6. Try to accept a missing required dimension. Confirm failure with no report written.
7. Change one cited file, run status, and confirm staleness while the original report remains unchanged.
8. Confirm every JSON, Markdown, text success and error path carries both notices.
9. Confirm delivery phase, Build approval, Manual QA, security dispositions and release state did not change.

Record the reviewer, date, environment, assessment IDs and observations in the delivery's Manual QA evidence. Do not approve Manual QA until the human walkthrough is satisfactory.

## Team Hub

User guide: [Team Hub](../team-hub-guide.md).

The repository test suite exercises Team Hub as both a library and an operated service. It includes:

- deterministic two-worker races against independent SQLite connections, proving exact publication becomes one acceptance plus one replay while changed bytes under the same identity produce one stable conflict;
- late snapshot arrival and process restart, proving every receipt is retained without allowing older evidence to replace the newer portfolio projection;
- real CLI subprocesses for managed service start, status, stop, contributor connection, publication and resource operations;
- loopback HTTP authentication, payload limits, invalid envelopes, disabled publishing, service outage and corrupt-storage failure behaviour;
- a real Chromium journey through the central and local dashboards at a 375-pixel viewport, including keyboard focus, session-only token storage, stale and empty states, exact installation confirmation and authority copy; and
- an isolated smoke test of the exact `npm pack` artefact, including its installed CLI, managed Team Hub lifecycle and completed-evidence preview.

Maintainers can run the whole suite and the focused transaction/coordination coverage gate with:

```bash
npx playwright install chromium
npm test
npm run test:team-hub:coverage
```

The focused coverage gate deliberately measures the two coordination-critical modules that own local installation state and the central SQLite ledger. The wider Team Hub service, CLI, package and browser surfaces remain mandatory behavioural tests but are not used to dilute or inflate that transactional percentage.

## Team Hub Resource Registry

User guide: [Team Hub Resource Registry](../team-hub-resource-registry-guide.md).

The mandatory test suite proves exact replay and immutable-identity conflict using two
independent workers and SQLite connections. It injects failures immediately before the
installed-state and receipt writes, then verifies the prior active pack, state and
receipt history are byte-for-byte preserved. It also covers live/dead/malformed leases,
digest and identity disagreement, invalid JSON, request timeout, outside-owned pack
collisions, symlink refusal, offline cache replay and safe outage rendering.

The local dashboard test uses Chromium to inspect a release, complete the named human
confirmation and install the exact digest. This is deliberately a browser journey—not a
DOM string assertion—because form behaviour, keyboard submission and narrow-layout
defects only exist in the rendered application.

Run `npm test` for behavioural assurance and `npm run test:team-hub:coverage` for the
enforced transaction/coordination coverage thresholds. Neither command selects or
applies the installed resource, approves its organisational use, or replaces Manual QA.

## Completed-phase evidence amendments

User guide: [Completed-phase evidence amendments](../completed-phase-evidence-amendments.md).

EWAI's automated suite invokes the public `ewai delivery evidence-amendment` command in real subprocesses rather than calling only its internal functions. It proves preview, missing-authority refusal, stale-digest refusal, exact ratification, deterministic replay and the final `no-changes` state.

A deterministic two-worker barrier also launches two CLI processes against the same preview at the same moment. A process-owned mutation lease must leave one complete amendment decision, no partial ledger or SQLite state, and only governed replay or bounded in-progress refusal for the competing process. A dead lease owner is recoverable, while a live owner is never displaced. The exact packaged npm CLI repeats the preview against a fixture built with the public delivery APIs, which guards against files being present in the repository but absent or unusable in the published artefact.

Run the relevant assurance directly with:

```bash
node --test tests/evidence-amendment-cli.test.mjs
node --test tests/team-hub-package.test.mjs
```

These tests establish deterministic software behaviour. A named human must still inspect the corrected evidence, reason and preview digest before ratification; the suite cannot supply that authority.
