# Shared project coordination

EWAI 0.4.0 adds an optional central coordination service for teams whose developers work on separate machines. Each developer keeps a local checkout, local SPECS files and local command execution. The service holds versioned intent and delivery records, ownership leases, approval records, activity and evidence references.

Git remains the way to distribute source documents and code. Do not place the service database in Git, a shared filesystem or a cloud synchronisation folder. Existing standalone projects continue to work without a service.

## Prepare the service

Use the same EWAI version on the server and developer machines. The service requires Node.js 22.5 or later. Choose a private data directory outside every project and a separate credentials definition file. Give each person a distinct, cryptographically random token of at least 32 characters, provided through the service's environment. Keep token values in your secret manager or private service configuration; the definition file contains environment variable names only.

```json
[
  {"actorId":"project-owner","role":"owner","projects":["example"],"tokenEnv":"EWAI_OWNER_TOKEN"},
  {"actorId":"developer-one","role":"developer","projects":["example"],"tokenEnv":"EWAI_DEVELOPER_ONE_TOKEN"},
  {"actorId":"reviewer-one","role":"approver","projects":["example"],"tokenEnv":"EWAI_REVIEWER_ONE_TOKEN"}
]
```

Roles are project-scoped. Readers inspect records; developers perform ordinary delivery work; approvers can record human decisions; owners also create projects, import existing records and recover leases. An assistant's label does not supply identity: the credential determines its actor and role. Restart the service after changing or revoking credentials.

Start with loopback access while configuring the service:

```bash
ewai coordination start --data /path/to/private-service-data \
  --credentials-file /path/to/coordination-actors.json --port 47747
ewai coordination server-status --data /path/to/private-service-data
```

For private network or Tailscale access, use an address available on the server and explicitly allow network binding:

```bash
ewai coordination start --data /path/to/private-service-data \
  --credentials-file /path/to/coordination-actors.json \
  --host 0.0.0.0 --port 47747 --allow-network
```

The service speaks **HTTP**. Connect using the server's reachable private address, for example `http://server-address:47747`. `0.0.0.0` is a bind address, not a client URL. Use an encrypted private network such as Tailscale, or put a TLS reverse proxy in front of the service. Authentication tokens alone do not encrypt HTTP traffic. The ordinary local dashboard remains a separate process and port.

The start command launches a background process. Use a service manager with the same command and environment when you need automatic startup after a reboot. Stop it with:

```bash
ewai coordination stop --data /path/to/private-service-data
```

## Register and connect a project

With the owner's token available under `EWAI_OWNER_TOKEN`, create one stable project identifier:

```bash
ewai coordination create-project --url http://server-address:47747 \
  --project-id example --name "Example project" --token-env EWAI_OWNER_TOKEN --yes
```

In the owner's existing, initialised EWAI project:

```bash
ewai coordination connect --project . --url http://server-address:47747 \
  --project-id example --machine-id owner-laptop --token-env EWAI_OWNER_TOKEN --yes
ewai coordination seed --project . --yes
```

Seeding is an explicit owner import. It refuses an existing intent rather than replacing it. Inspect the source project before importing; existing recorded approvals retain their provenance and are not new approval decisions.

Each developer pulls the same source documents and initialises their local EWAI runtime. Connect using that person's token environment variable and a unique machine identifier:

```bash
ewai coordination connect --project . --url http://server-address:47747 \
  --project-id example --machine-id developer-laptop \
  --token-env EWAI_DEVELOPER_ONE_TOKEN --yes
ewai coordination status --project .
```

The connection file stores the endpoint, project identifier, machine identifier, server identity, observed revisions and token environment variable **name**. It never stores the token value. Keep `.ewai-pipeline` machine-local.

## Work normally

Use the existing EWAI intent, delivery, active-work and task tools. Shared mode obtains current central records before guarded transitions, checks local source fingerprints and commits against the expected central revision. A competing owner cannot overwrite an active lease. Approval changes require an approver or owner credential and the normal human decision.

Code editing, Docker, tests and Git run on the developer's machine. The service accepts domain operations, not arbitrary SQL, shell commands or remote file access. Test reports remain local/Git files; registered references bind their paths and hashes to the intent source fingerprint. Registered evidence records what was reported; it is not independent verification that a test ran or a human accepted the result.

After deliberately changing an intent's authored text or metadata, commit and distribute the source through Git, then publish its fingerprint against the central revision you reviewed:

```bash
ewai coordination read product/example --project .
ewai coordination publish product/example --project . --expected-revision 12
```

Use the actual returned revision. Changed personas, relationships and other authored frontmatter count as source changes. Missing or divergent documents and task graphs block execution until reconciled. A catalogue scan does not import or delete central intents.

MCP hosts also expose `ewai_coordination_status`, `ewai_coordination_publish` and `ewai_coordination_recover`. Existing delivery tools retain their names. Configure the host to pass the client's token environment variable to the trusted EWAI stdio process. An environment variable set in a terminal does not update an already-running desktop host, and some hosts filter inherited variables. Restart or reconnect the host after configuration; keep token values out of tracked MCP settings.

## Interruptions and recovery

A central outage blocks shared authoritative operations. Local editors, Git and local tests remain available. EWAI does not silently switch to standalone writes.

A pending operation journal records the request before publication. Inspect `coordination status`, then resolve a reported request:

```bash
ewai coordination recover REQUEST_UUID --project .
```

Recovery checks the original operation receipt, retries only the recorded central request if necessary and refreshes the local projection. It does not repeat the native workflow callback. Deferred lifecycle events use their stable source identities. Preserve pending journals until the outcome is resolved.

If the original lease expired or the service restarted before the proposal committed, repeat recovery with `--yes` after reviewing the candidate. EWAI checks that its predecessor is unchanged and that no replacement owner is active before obtaining fresh intent authority. It never converts a task lease into intent authority.

A prepared operation without a durable candidate needs owner review. Stop and inspect the local worker first, then an owner may use `recover REQUEST_UUID --yes --execution-stopped --reason "Reviewed interrupted operation"`. This explicitly abandons its operational projection and records the attestation; it does not assert that external side effects were undone. The local journal resolution is bound to the authenticated central decision.

Lease expiry fences late commits; it does not prove that a developer's process has stopped. Cancel a worker on its own machine. A process ID from another machine is never authority to kill a local process.

Disconnect explicitly:

```bash
ewai coordination disconnect --project . --yes
```

This refuses pending operations and disables shared authority. It does not automatically enable standalone mutations. Keep the disconnected marker until an owner has reconciled the exported central records and deliberately established a new standalone project.

## Export, backup and restore

```bash
ewai coordination export --project . --output /path/to/private-export.json
```

Exports contain intent records and audit history without private lease capabilities. They are snapshots, not writable database replicas. Prefer keeping routine snapshots outside authored source trees.

Stop the service before copying its entire private data directory for a backup. SQLite WAL files belong with the database. On restart the database retains its identity and operation receipts; active leases are interrupted by a fresh service epoch. Developers must acquire fresh leases.

An unexpected server identity or a revision older than the client's last acknowledged revision blocks that client. Do not remove the client's revision history to hide a rollback. An owner should reconcile the backup and newer exports before reconnecting developers. Restore and shared-to-standalone conversion require operator review; do not run two live services against copies of one project's authority.

## Validate with your team

Before adopting shared mode for live work, use two independent checkouts and distinct credentials. Exercise handoff, source changes, the configured Build gate, a real local task/test report, approval and Manual QA, an interrupted connection and service restart. Review the resulting audit records. Automated checks and package preparation do not substitute for your acceptance of those journeys.
