# Team Hub Resource Registry guide

The Team Hub Resource Registry distributes immutable, organisation-owned EWAI working
material without turning the Hub into project authority. The first release supports
Organisation Blueprint packs with `type: organisation` and design-system packs with
`type: design-system`, both using strict `ewai.pack/v1` manifests and `org.*` IDs.

Blueprints may reference ordinary local project personas, policies, standards,
design-system IDs and governed starter metadata. The registry transports the Blueprint
manifest and its referenced policy, persona and standard text files. It does **not**
retrieve starter source, execute adapters, or distribute premium persona bodies.

```text
author pack -> validate -> publish immutable release -> discover -> inspect
                                                          |
                                                          v
                      select/apply separately <- install exact verified digest
```

Publication means a release is available. Installation means the bytes are available
inside one project's managed pack root. Neither action selects a design system, applies
a Blueprint, changes SPECS, approves Build, accepts risk or approves release.

## Configure reader and publisher authority

Use different long random values and different environment-variable names:

```bash
export EWAI_TEAM_HUB_READER_TOKEN='replace-with-a-long-random-reader-secret'
export EWAI_TEAM_HUB_PUBLISHER_TOKEN='replace-with-a-different-publisher-secret'

ewai team-hub start \
  --data /srv/ewai-team-hub \
  --token-env EWAI_TEAM_HUB_READER_TOKEN \
  --publisher-token-env EWAI_TEAM_HUB_PUBLISHER_TOKEN \
  --host 127.0.0.1 \
  --json
```

The reader can list and download releases and can continue to publish bounded project
snapshots. It cannot publish a governed resource. The publisher can publish and inspect
resources. The service stores only the environment-variable names in service state.
Starting without `--publisher-token-env` keeps the original portfolio capability and
returns an explicit `publisher-not-configured` response for resource publication.

## Prepare a resource

Start from a folder that already validates with EWAI's organisation Blueprint or
design-system tooling. A package contains only `pack.yaml` and local files directly
referenced by Blueprint standards, personas and policies or by design-system
contributions.

Allowed file extensions are `.md`, `.yaml`, `.yml`, `.json`, `.txt`, `.toml` and `.css`.
The registry rejects hidden or escaping paths, symlinks, invalid UTF-8, binary NUL
content, executable/archive types, more than 100 files, a file over 256 KiB, or total
content over 2 MiB. This is deliberately narrower than the normal local pack limits.

Use a new semantic version when content changes. The registry will not accept different
bytes under an existing resource ID and version.

## Publish an immutable release

```bash
ewai team-hub resource publish ./packs/acme-delivery \
  --data /srv/ewai-team-hub \
  --publisher-token-env EWAI_TEAM_HUB_PUBLISHER_TOKEN \
  --publisher-name "Acme Engineering" \
  --yes \
  --json
```

Organisation Blueprint publisher identity comes from its manifest. A design-system
publisher name comes from `--publisher-name`; its publisher ID is the organisation
segment of the `org.*` pack ID. Successful publication returns a package digest and an
immutable publication receipt. Repeating the exact release is idempotent. Different
content under the same ID/version returns a conflict.

The central Team Hub browser shows the retained release catalogue after a reader or
publisher credential is entered for the current tab. It deliberately does not provide
project installation or activation controls.

## Discover and inspect from a project

Connect the project using the **reader** token as described in the Team Hub guide, then:

```bash
ewai team resources --project . --json
ewai team resource inspect org.acme.delivery 1.0.0 --project . --json
```

Discovery returns safe release metadata, not package bodies. Inspect downloads and
validates one exact package for review but does not write it to the pack root. The local
dashboard provides equivalent **Refresh resources** and inspect controls. Nothing is
queried automatically during check-in or ordinary dashboard load.

## Install an exact release

Copy the digest from the catalogue or inspection result and name the accountable person
or role:

```bash
ewai team resource install org.acme.delivery 1.0.0 \
  --expected-digest sha256:REPLACE_WITH_THE_EXACT_DIGEST \
  --approved-by "Platform Owner" \
  --yes \
  --project . \
  --json
```

EWAI downloads the exact release if it is not already cached, verifies every file and
the aggregate digest, reconstructs it in a private quarantine, runs the existing pack
parser, checks for an outside-owned ID collision, then atomically exposes one managed
active copy under `.ewai-pipeline/packs/team-hub/`. Immutable cached versions remain
outside pack discovery.

An install receipt records the prior and installed version/digest, action, approver and
time. View safe history with:

```bash
ewai team resource receipts --project . --json
```

After installation, use the normal Blueprint preview/apply or design-system
inspect/resolve/select workflow. The registry never performs that next decision for you.

After installation succeeds, use the relevant adoption workflow:

- Design-system pack: [resolve and select it](design-systems/design-system-user-guide.md#select-a-project-design-system), then apply it to a delivery.
- Organisation Blueprint: [review it in Guided Setup](designing-organisation-blueprint-packs.md#review-and-approve-in-guided-setup) and approve its project consequences.

An install receipt isn't either selection decision.

## Restore, offline use and recovery

Install an older exact version with its digest to perform a deliberate restore. If that
release is already in the immutable cache, the install can complete while the Hub is
offline. The cache is not a discovery catalogue and EWAI never chooses a cached update
automatically.

Active-copy promotion uses a bounded backup. If validation or promotion fails, EWAI
restores the prior active pack and does not write a success receipt. If an ID already
exists in bundled, personal or non-managed project packs, installation stops and leaves
that content untouched.

Only one install may mutate a project resource workspace at a time. EWAI holds a
process-owned local lease across download, quarantine, cache, promotion, state and
receipt publication. A live owner produces a stable `resource-install-busy` refusal;
a dead owner, or sufficiently old malformed lease metadata, is recovered on the next
explicit install. EWAI never breaks a lease belonging to a live process merely because
it is old.

To recover operational state, restore the project-local `.ewai-pipeline/team-hub/resources`
and `.ewai-pipeline/packs/team-hub` folders together from an approved backup. Do not edit
installed state or receipts by hand. Re-inspect and install the exact retained digest if
the cache or managed copy cannot be trusted.

## Registry assurance tests

EWAI maintainers can find the automated coverage, browser checks and commands in [Registry verification](maintainers/verification-walkthroughs.md#team-hub-resource-registry). Those checks don't replace your organisation's decision to adopt a resource or its deployment checks.

## Current boundaries

This release does not support technology/stack/core packs, standalone persona packs,
premium persona distribution, signatures, assignments, revocation, automatic updates,
central approval, multi-user editing, remote code execution, EDD licensing, deployment,
npm publication or release acceptance. A Team Hub receipt is operational evidence, not
certification that a pack is safe, correct or suitable for a project.
