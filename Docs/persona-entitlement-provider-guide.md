# Persona entitlement and pack providers

EWAI distributes premium personas separately from the public framework package. Distribution is website-only: this guide explains licence-checked Easy Digital Downloads (EDD)/WordPress delivery and the independent local verification controls.

Premium personas are optional advisory lenses. Core and project personas, together with the standard host model, remain a complete baseline. Entitlement does not engage a persona, and a persona does not acquire approval authority.

This is the integration reference. If you just want to enter a key or update your pack, start with [Set up and update premium personas](operations/premium-personas-setup.md).


<!-- editorial: contents -->
## On this page

- [Keep four states separate](#keep-four-states-separate)
- [Inspect safe status](#inspect-safe-status)
- [Install, repair, or update](#install-repair-or-update)
- [Pack contract](#pack-contract)
- [Verification receipts](#verification-receipts)
- [Website provider: wordpress-edd](#website-provider-wordpress-edd)
- [This is governance, not DRM](#this-is-governance-not-drm)
- [Provider implementation checklist](#provider-implementation-checklist)
- [Troubleshooting](#troubleshooting)
- [Related guides](#related-guides)
- [Contract sources](#contract-sources)

## Keep four states separate

| Question | Meaning | Evidence |
| --- | --- | --- |
| Is the user entitled? | The configured provider currently permits acquisition. | Provider access result. |
| Is the pack installed? | A local managed pack directory exists. | Local filesystem state. |
| Is the pack verified? | The current files, source, revision, manifest, and external receipt agree. | Core validation plus receipt. |
| Is a persona active? | The current workflow selected an installed persona as a relevant lens. | The workflow's active-persona ensemble. |

These states must never be collapsed into one `premium: true` flag. In particular, a verified local installation may still be useful during a temporary provider outage, while an entitled user may choose not to install it.

## Inspect safe status

Run the status command (it never downloads; confirmed matching team expiry can perform the cleanup described below):

```bash
ewai persona premium status --project . --json
```

The `ewai.persona-entitlement/v1` result includes the provider, access classification, local status, installed and verified flags, compatibility, safe revision and digest metadata, an optional action, and a conditional upgrade URL. It intentionally omits credentials, raw provider responses, absolute cache paths, pack contents, and persona bodies.

Access has three values:

- `available`: the provider confirmed access to the configured pack revision;
- `unavailable`: authenticated status confirms that the subscription no longer grants access;
- `unknown`: connectivity or another unclassified failure prevented a trustworthy conclusion.

Unknown is not denied access. It must not trigger an upsell. A purchase link is available when no key is configured or authenticated status confirms unavailable access, and no local pack is installed.

Local status is one of:

- `not-installed`;
- `installed-unverified`;
- `installed-not-remotely-verified`;
- `current`;
- `update-available`.

The action may instead report `blocked-local-changes`. Do not force or merge a managed cache in that state.

## Install, repair, or update

First-time licence submission in the dashboard or interactive `persona premium configure` calls `configureAndInstallPremiumPersonas`: activation, private credential storage, download, validation and readiness confirmation happen in that operation. Submitting the key authorises installation. A saved key with a failed download isn't a ready pack.

Status and normal check-in never download premium content. After the user explicitly agrees to the offered action, run:

```bash
ewai persona premium sync --project . --yes
```

If a matching verified pack is already current, sync reports that without downloading again. Otherwise it acquires an immutable archive into `.ewai/packs/.staging/`, verifies the advertised SHA-256 and byte size, validates ZIP paths and the manifest version, and independently validates the content. It then moves the existing pack to a temporary backup, promotes the candidate atomically, writes the receipt, and removes the backup. If promotion or receipt writing fails, it restores the previous installation and receipt.

The `--yes` option is a command confirmation, not a standing entitlement or approval. Automation must not add it unless a person has explicitly authorised that particular install, repair, or update.

## Pack contract

The minimal persona-only manifest in `pack.yaml` is:

```yaml
schema: ewai.persona-pack/v1
id: ewai.personas.professional
version: 1.0.0
content:
  personas: premium-personas
```

The minimal format's schema is published at `config/persona-pack.schema.json`. The canonical premium source library instead uses the richer `ewai.pack/v1` persona manifest. The runtime supports that source-compatibility format only for `type: persona`, the expected id/version/content, and allowlisted inert name, description, commercial, source, updates, compatibility and normalisation metadata. Boilerplates must be absent or empty; commands, skills and deployment fields are rejected. This compatibility adapter does not expand the minimal JSON schema or execute pack metadata.

CCE archives include the customer reference `docs/model-selection.md` and `manifest.json`, the commerce release manifest. Its schema is `ewai.persona-pack/v1` and it counts personas by collection. The client requires pack.yaml version to match the advertised immutable release. For maintainers testing both sides of delivery—not ordinary pack users or independent client implementers—the joint integration test builds and server-validates the actual dual-manifest archive, then installs identical bytes. This optional test uses `EWAI_CCE_PLUGIN_ROOT` or the sibling checkout and PHP ZipArchive; self-contained npm tests explicitly skip that joint test when those dependencies are unavailable.

### Legacy compatibility, not the authoring format

New releases should use the current full manifest above. Compatibility identifies older installed content; it isn't a recommendation to publish missing identity/version metadata.

During transition, a legacy manifest without `schema`, `id`, and `version` remains compatible when it declares `content.personas`; status reports that as `compatible-legacy` rather than pretending it is current.

Core validation applies regardless of provider:

- the declared persona directory must be a safe relative path inside the candidate;
- symbolic links and special files are rejected;
- only Markdown, text, YAML, JSON, CSV, and recognised extensionless notice files are accepted;
- no file may exceed 1 MiB;
- a pack may contain at most 1,000 files and 16 MiB in total;
- the declared persona directory must contain at least one file;
- the deterministic SHA-256 digest covers every accepted relative path, size, and file body in stable order.

These bounds make validation predictable and stop a persona pack from becoming an unbounded executable or binary delivery channel.

## Verification receipts

A downloaded archive is not trusted merely because the server accepted a licence. EWAI writes a separate `ewai.persona-pack-receipt/v1` receipt beneath the local `.ewai/packs/.receipts/` directory. It records:

- pack and provider IDs;
- manifest version and compatibility mode;
- exact source revision;
- deterministic content digest;
- verification time.

Status revalidates the current pack and compares it with the receipt. Editing a persona, replacing the source, changing revision, or altering the receipt makes the installation unverified. The receipt lives outside the pack so a candidate cannot provide its own evidence of trust.

## Website provider: `wordpress-edd`

Use `ewai persona premium configure --project .` in an interactive terminal. The hidden prompt verifies the key and registers this installation before writing owner-private `~/.ewai/entitlements/conversational-coding.json`, then downloads and verifies the pack immediately. This EWAI config stores the key and activation token for later session check-ins; no credential enters project YAML, Git, SPECS or safe dashboard output.

Machine identity is a random 64-hex installation secret in owner-private `~/.config/conversational-coding/installation.json`, schema `cce.installation/v1`, field `installationSecret`. EWAI and Monomyth clients must reuse that secret on the same machine, rather than hashing a hostname or copying the file to another machine. Machine name is a display label. A seat supports three machines. Deactivate old machines in My Account. Monomyth integration itself is deferred to its own build.

The website provider is the default even before key setup. Missing credentials offer the private terminal prompt without a network request and never block core EWAI use. Project persona configuration accepts only `provider: wordpress-edd` and an optional server; obsolete source fields and raw licence fields are rejected. Existing unsupported caches stay untouched and excluded until safely replaced through an explicitly owned recovery. The default server is `https://www.conversationalcoding.dev`. A separately approved self-hosted origin can be supplied during setup; never use a different origin as an authentication-failure fallback.

Each check-in and dashboard launch performs fresh authenticated status, including reuse of a server; check-in shares one promise with its dashboard launch. Status contains the immutable current manifest/version. Launches never request a grant or archive. When offered an update, obtain consent before sync. Cross-seat/provider replacement additionally requires `--replace`.

The REST contract uses activation, bearer-authenticated status and download-grants under `/wp-json/conversational-coding/v1/persona-pack`. Grants return same-origin `/?cce-download=...` URLs. Credential-bearing requests never follow redirects. JSON is capped at 64 KiB, archives at 20 MiB; streams time out. The immutable archive size and SHA-256 must match the release; ZIP entries are bounded before writing and pack validation remains independent. Website revision is its archive SHA-256, not a Git commit. pack.yaml version must match the current release. No source repository is queried or cloned for persona delivery.

The external receipt additionally records safe provenance: server, subscription ID, seat ID and plan type. Atomic promotion/receipt rollback and exclusive mutation locking protect the active cache. Interrupted operations may leave a lock/staging directory needing investigation; no timer silently steals an active lock.

### Expiry is not a generic error

The updated CCE authenticated status supplies subscription id, `plan_type`, explicit `status`, `ends_at`, seat ID and activation ID. The client requires those fields and a consistent unavailable/expired result before expiry handling. Older/malformed contracts produce uncertainty and preserve files.

Confirmed team expiry removes **only** the managed premium cache and receipt matching that server/subscription/seat/team plan. A key from another seat cannot delete an individually supplied pack. An expired individual subscription retains its installed personas and reports that updates have ended. No new download is permitted. Cancellation keeps access for the remainder of the paid term. Refunded/revoked/inactive status does not invent an expiry purge policy. There is no invented offline deletion deadline.

Personal `~/.ewai/personas` and authored project personas are never scanned or mutated by cleanup. Unknown access, invalid activation, arbitrary 403, timeout and outage never trigger deletion. Unsafe paths/symlinks or a concurrent mutation block cleanup visibly.

Locally changed team content is preserved rather than erased. A known-expiry block is recorded in an independent private `persona-access-denial.json` projection before acquiring the pack mutation lock, then in the receipt when safe cleanup can proceed. The denial binds to that installed receipt generation, server, subscription and seat; it cannot follow a fresh authenticated replacement pack. The shared premium catalogue path becomes unavailable, so CLI, dashboard and persona selectors cannot engage the retained expired team pack, including while another mutation holds the lock. That confirmed block survives a later outage. A valid renewed matching subscription can explicitly install a fresh verified pack to restore access; individual receipts are never blocked by this team rule. Filesystem failures that prevent safe denial recording or deletion require an explicit stop and manual investigation, not a successful-cleanup claim.

For a deployment acceptance test, verify an individual purchase, an allocated team seat, the three-machine limit and archive delivery against that deployment. A passing local fixture test isn't evidence that a particular live server has been configured correctly.

## This is governance, not DRM

The mechanism does not provide DRM and cannot guarantee that an authorised recipient will never copy files. Its purpose is to keep commercial content out of the public package, make authorised acquisition explicit, record local provenance, detect drift, and avoid accidental disclosure through product surfaces.

Entitlement status is operational evidence. It does not approve Build, cannot approve Manual QA, certify persona quality, accept licence terms on someone's behalf, or replace a commercial system of record.

## Provider implementation checklist

Before enabling another provider, verify:

- all three access outcomes are deterministic and tested;
- safe output has no credential, raw response, absolute path, or pack-body leakage;
- check-in/status never download; only authenticated matching team expiry may remove managed content;
- sync still requires explicit human consent;
- acquisition is confined to core-supplied staging;
- the common validator and receipt writer cannot be bypassed;
- failed validation and failed promotion preserve the previous verified installation;
- concurrent or interrupted operations cannot produce a half-promoted pack;
- an upgrade link appears only for known unavailable access without an installation;
- legacy compatibility is visible rather than silently upgraded;
- full package and npm dry-run tests include the adapter without including commercial persona content.

## Troubleshooting

| Status or symptom | Meaning | Safe response |
| --- | --- | --- |
| `access: unknown` | The provider could not be classified reliably. | Preserve any verified local pack and retry later. |
| `installed-unverified` | Local content and its receipt do not agree. | Do not use it as trusted premium content; offer governed repair when access is available. |
| `installed-not-remotely-verified` | Local validation passes, but current entitlement or freshness is unknown. | Keep the verified local state visible and avoid claiming it is current. |
| `blocked-local-changes` | The managed cache is dirty or has another origin. | Preserve it for investigation; never force-sync over it. |
| Candidate rejected | Release digest/size, grant origin, ZIP path/file limits, CRC, manifest version or content validation failed. | Keep the prior pack and report the bounded reason. |
| Receipt drift | Current files no longer match verified provenance. | Treat the installation as unverified and reacquire only after explicit consent. |

## Related guides

- [Installation, updating, and entitlements](operations/installation-updating-and-entitlements.md)
- [Working with personas](working-with-personas.md)
- [Human approval and assurance](human-approval-and-assurance-guide.md)
- [Troubleshooting and recovery](operations/troubleshooting-and-recovery.md)

## Contract sources

- [src/persona-entitlements.mjs](../src/persona-entitlements.mjs)
- [src/checkin.mjs](../src/checkin.mjs)
- [src/cli.mjs](../src/cli.mjs)
- [src/runtime/dashboard-server.mjs](../src/runtime/dashboard-server.mjs)
- [config/persona-pack.schema.json](../config/persona-pack.schema.json)
- [config/project.schema.json](../config/project.schema.json)
- `tests/persona-entitlements.test.mjs`
- `tests/persona-entitlement-package.test.mjs`
