# Completed-phase evidence amendments

EWAI treats a completed phase gate as durable delivery authority. If a referenced evidence file is legitimately corrected after phase completion, the delivery must not silently accept the new bytes and an operator must not edit the gate ledger by hand. The completed-phase evidence amendment command provides a narrow, reviewed recovery path.

This capability does not reopen the completed phase, repeat its Build approval, move the delivery, waive a gate, or approve Manual QA. It only replaces stale nested evidence hashes in an otherwise unchanged completed gate ledger, validates the resulting candidate with the normal deterministic phase checker, and records an immutable receipt.

## Which amendment operation?

| Situation | Operation | What it changes |
| --- | --- | --- |
| Approved pre-Build evidence and its completed gate ledgers have been amended; you're at Build before authorising implementation | `delivery ratify-amendments` | Revalidates completed pre-Build gates and records their updated fingerprints. See [Build approval operations](developer-delivery-guide.md#preserve-the-build-approval-boundary). |
| A referenced evidence file was corrected after phase completion, but the completed gate ledger itself is unchanged | `delivery evidence-amendment` | Previews and replaces only stale nested evidence hashes, subject to the original checker. Follow the steps below. |

Neither operation can turn failed evidence into a pass, rewrite outcomes or supply Build approval. Inspect which operation failed and what changed before choosing a recovery route. If the condition doesn't match either row, stop and investigate.

## When to use it

Use it only when all of these are true:

- the phase is already completed;
- the gate ledger itself is unchanged from the digest stored in `delivery-state.json`;
- one or more evidence files referenced by passing gate items were corrected or regenerated;
- the corrected evidence still passes the canonical deterministic gate contract; and
- a named person is prepared to ratify the exact previewed changes.

Do not use it to alter a gate result, conceal failed evidence, change an approval, reopen delivery work, or satisfy Manual QA. If the completed ledger itself changed, EWAI refuses the amendment and the delivery requires a different governed decision.

## Preview first

```sh
ewai delivery evidence-amendment <slug> --project . --json
```

The preview is read-only. It returns:

- `deliveryStateSha256`: the digest of the current durable state file;
- `stateSha256`: an amendment revision digest binding the durable state and exact proposed hash substitutions;
- each affected phase and gate item;
- the previous and current evidence hashes; and
- no evidence bodies or absolute filesystem paths.

Review the named paths and hashes. If anything changes after preview, the apply operation will reject the stale digest.

## Ratify the exact preview

```sh
ewai delivery evidence-amendment <slug> \
  --project . \
  --yes \
  --approved-by "Name or accountable role" \
  --reason "Why the completed evidence was corrected" \
  --expected-state-digest <stateSha256-from-preview> \
  --json
```

On success, EWAI:

1. confirms the original completed gate ledger still matches durable state;
2. rebuilds only the stale nested evidence hashes;
3. runs the canonical deterministic phase validator against the candidate ledger;
4. atomically updates the ledger, durable state, intent copies, and SQLite projection; and
5. writes an immutable receipt under `SPECS/6.Build/<slug>/evidence-amendments/`.

The receipt is deterministic for the slug, preview digest, approver, and reason. Repeating the exact successful command returns the existing receipt rather than creating a second decision.

## Failure and recovery behaviour

The amendment is all-or-nothing. If any write or projection update fails, EWAI restores the prior gate ledger, durable state, intent copies, operational projection, and receipt directory. Run the preview again after resolving the cause.

After a successful ratification, retry the originally blocked guarded operation. The next phase still starts only when every completed gate is fresh and the normal phase-order rules permit it.

## For EWAI maintainers

The [maintainer verification notes](maintainers/verification-walkthroughs.md#completed-phase-evidence-amendments) cover CLI, concurrency and package tests. They aren't additional commands an operator must run to ratify corrected evidence.
