# Team Hub guide

Team Hub is EWAI's optional, self-operated team visibility layer. Every project remains in **single mode** by default: delivery runs locally, SPECS stay local, and no network service is required. A contributor may deliberately connect a project and publish a bounded read-only snapshot to a separately running Team Hub.

```text
local EWAI project ── explicit bounded snapshot ──> Team Hub service
       │                                                │
       └── full local delivery authority                └── read-only portfolio
```

The service is an operational projection, not a replacement for Git, SPECS, the project-local dashboard or an engineering work-management system. It cannot approve Build or Manual QA, accept risk, certify compliance, deploy or release.

Team Hub's shared view isn't remote access to each project's editing dashboard. Contributors work in their local project, then explicitly publish the permitted summary. To review or edit a local draft together, work on the owner's computer or use an approved screen-sharing process.

## What the first release provides

- Single-contributor operation with no service, token or network dependency.
- An exact disclosure contract that identifies included fields and excluded categories.
- A local connection that stores an endpoint, project identifier, disclosure digest and token environment-variable **name**—never the token value.
- Explicit snapshot publication with an immutable local attempt record.
- A digest-bound receipt when the service accepts a snapshot. Acceptance is transport evidence, not delivery approval.
- A separate SQLite-backed service with an authenticated ingestion endpoint and read-only portfolio UI.
- An optional immutable registry for validated Organisation Blueprint and design-system releases.
- Separate reader and publisher credentials, with publishing disabled unless an operator configures it.
- Exact-version, exact-digest local installation with quarantine validation, rollback and local receipts.
- CLI and local-dashboard controls for disclosure, connection, publication status and disconnection.

It does not provide central intent editing, central gate actions, premium persona bodies, source code, SPECS bodies, enterprise identity, managed hosting, licensing, automatic synchronisation or production execution. Installing a governed resource makes it locally available; it does not select, apply or approve it.

## Operate a hub

Choose a dedicated local-disk directory outside every EWAI project. Do not use `.ewai-pipeline`, a repository folder, a cloud-synchronised folder or a network share. Set a long random bearer token in an environment variable, then start the separate service:

```bash
export EWAI_TEAM_HUB_TOKEN='replace-with-a-long-random-reader-secret'
export EWAI_TEAM_HUB_PUBLISHER_TOKEN='replace-with-a-different-publisher-secret'
ewai team-hub start \
  --data /srv/ewai-team-hub \
  --token-env EWAI_TEAM_HUB_TOKEN \
  --publisher-token-env EWAI_TEAM_HUB_PUBLISHER_TOKEN \
  --host 127.0.0.1 \
  --json
ewai team-hub status --data /srv/ewai-team-hub --json
```

Loopback is the safe default. A non-loopback bind requires `--allow-network`. The built-in service is HTTP-only; for any shared network deployment, put it behind an organisation-managed **TLS reverse proxy**, terminate HTTPS there, restrict network access, and use an HTTPS contributor endpoint. EWAI does not configure the proxy or certify the resulting deployment.

Open the URL returned by `start`. The central browser UI asks for a reader or publisher bearer token for the current tab only and holds it in session storage. The service state file records environment-variable names, never credential values. Omit `--publisher-token-env` when this hub must remain read-only.

Stop the service with:

```bash
ewai team-hub stop --data /srv/ewai-team-hub --json
```

## Connect a contributor project

First review the current disclosure:

```bash
ewai team disclosure --project . --json
```

Then make the token available under the variable name agreed with the operator and connect. Connection does not publish a snapshot.

```bash
export EWAI_TEAM_HUB_TOKEN='the-operator-supplied-secret'
ewai team connect https://hub.example.org \
  --project-id claims-platform \
  --token-env EWAI_TEAM_HUB_TOKEN \
  --acknowledge-disclosure \
  --yes \
  --project . \
  --json
ewai team status --project . --json
```

The same controls are available in the local dashboard's **Team Hub** view. Enable it in **Configuration** and save first; see [dashboard configuration](operations/dashboard-configuration.md). Showing the view doesn't connect the project. The dashboard accepts only the endpoint, project ID, token environment-variable name, explicit confirmation and disclosure acknowledgement. It cannot accept a project-root override or a token value.

## Publish a snapshot

Publication is always deliberate:

```bash
ewai team sync --yes --project . --json
```

The local dashboard has an equivalent **Publish current snapshot** action with a confirmation step. Each action writes an attempt record. When accepted, a separate receipt records the project ID, snapshot digest, idempotency key, acceptance time and whether the same snapshot was replayed.

A failed attempt does not remove the last accepted receipt. This lets an operator distinguish “the latest network attempt failed” from “this is the last snapshot the hub actually accepted.” Local engineering work remains available in either case.

## Distribute governed resources

An operator can publish immutable `org.*` Organisation Blueprint and design-system releases. Connected contributors can discover release metadata, inspect an exact release, and explicitly install it by version and SHA-256 digest. Publication and installation have separate receipts, and a failed update restores the previously installed release.

The registry does not carry premium persona bodies or governed starter-project executable material. A Blueprint can reference those capabilities by identity, while their own entitlement and materialisation controls remain authoritative. Installing a release does not activate it or change SPECS.

See the [Team Hub Resource Registry guide](team-hub-resource-registry-guide.md) for publisher configuration, packaging rules, contributor commands, dashboard operation, collision handling, offline cache replay, restoration and audit evidence.

## Disclosure and data custody

The snapshot uses a closed allow-list. Inspect the command output for the authoritative current list. At this release it contains bounded project identity, package version, a one-way repository-revision digest, intent counts, a compact latest-delivery status, selected reusable-resource identities and digests, timestamps, attention signals and the authority notice.

The snapshot excludes:

- credentials and environment-variable values;
- source code and SPECS document bodies;
- persona bodies, prompts and transcripts;
- logs and error-report packages;
- repository remotes and local filesystem paths.

Unknown fields are rejected on both the contributor and service sides. Snapshot and envelope digests are recomputed before storage. Treat the resulting database as internal operational metadata and apply your organisation's retention, access-control and incident-response policy.

## Token rotation

To rotate the shared token:

1. Stop the Team Hub service.
2. Replace the value in the configured environment variable.
3. Start the service again using the same variable name.
4. Update that environment variable for authorised contributors.
5. Run an explicit sync from one project and verify a new accepted receipt.

The connection files do not need changing when the environment-variable name remains stable. For a staged rotation, run a second hub endpoint or coordinate a maintenance window; the first release intentionally supports one active shared bearer token per service.

## Backup and recovery

The service database is under `<data-root>/data/team-hub.sqlite`; runtime state and logs are kept in sibling directories. For a simple consistent backup:

1. Run `ewai team-hub stop --data <data-root>`.
2. Copy the entire dedicated data root using your approved backup process.
3. Restart the service and confirm `status` is `running`.

For live backups, use a SQLite-aware backup tool and include write-ahead-log state correctly. Do not assume that copying only the main database file while the service is writing produces a recoverable backup.

To recover, stop the service, restore the dedicated data root to local disk with restrictive permissions, set the token environment variable, start the service, and verify `/health`, the portfolio UI and a deliberate contributor sync. The hub can also be rebuilt from future contributor snapshots; it is not the canonical source of delivery truth.

## Disconnect a project

```bash
ewai team disconnect --yes --project . --json
```

Disconnect removes only the active local connection. It does not delete local attempt history or the last accepted receipt, and it cannot recall data already accepted by a hub. The project immediately returns to single-contributor mode. Hub-side deletion and retention remain operator responsibilities in this release.

## Troubleshooting

- **Token environment variable is unavailable:** export the variable named by `ewai team status`, then retry. Do not put the token in a command argument or project file.
- **HTTP endpoint rejected:** shared endpoints must use HTTPS. Plain HTTP is accepted only for loopback development.
- **Snapshot rejected:** inspect the local attempt record and service log. Correct the cause and publish again; do not edit attempt or receipt files.
- **Service reports stale:** stop it, inspect the configured data-root log, and start it again. A stale state file is never treated as a healthy service.
- **Contributor is offline:** continue working locally. No gate or project operation depends on Team Hub availability.

## Operational verification

If you're maintaining the harness, see the [Team Hub verification notes](maintainers/verification-walkthroughs.md#team-hub) for the automated suites and commands.

Automated success is engineering evidence, not Manual QA or operational acceptance. Before a shared deployment, an accountable operator must still verify the chosen TLS proxy, identity and access controls, backup and restore procedure, retention policy, monitoring, service ownership, narrow-screen usability, keyboard operation and one real contributor-to-hub journey in the target environment.

## Authority and deployment responsibility

Team Hub remains read-only with respect to project truth and delivery authority. Its optional resource registry distributes immutable validated releases; installing one doesn't select or apply it. The organisation operating the Hub is responsible for its deployment, access controls, retention and recovery. Verify those controls in the target environment before inviting contributors.
