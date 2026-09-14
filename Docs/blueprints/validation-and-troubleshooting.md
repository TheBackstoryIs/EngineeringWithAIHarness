# Blueprint validation and troubleshooting

Use this guide to diagnose an Organisation Blueprint Pack that is missing, rejected, incomplete, or unable to materialise during Discovery.

Start with the full [Blueprint design guide](../designing-organisation-blueprint-packs.md) if you have not yet authored a strict `ewai.pack/v1` manifest.

## Diagnose the failing layer

Work from discovery toward application:

1. **Discovery:** Is the pack stored under a supported local root?
2. **Manifest parsing:** Is the YAML valid and the root object complete?
3. **Strict schema:** Are all required fields present and all undeclared fields absent?
4. **Resolution:** Are identity, compatibility, dependencies, and selected modules valid?
5. **Content:** Are referenced Markdown files safe, bounded, and readable?
6. **Review:** Does the preview show the intended modules and outputs?
7. **Application:** Are there destination conflicts or a stale review revision?
8. **Drift:** Does the project pin still match the installed pack content?

Fix the earliest failing layer first. Later errors may be consequences rather than separate defects.

For a missing pack, correct its [installation root](#confirm-the-installation-root) and reopen selection. For a rejected pack, fix the specific manifest/content error in the candidate and resolve it again. For a stale preview, preserve any unsaved decisions, prepare a fresh preview and obtain a new approval. For destination conflicts, inspect the existing files rather than using overwrite flags.

Resolver checks in a disposable project validate your pack. Running EWAI's full regression suite is a separate harness-maintainer task, not a requirement for every pack consumer.

## Confirm the installation root

EWAI discovers local Organisation Blueprint Packs from:

1. the package `packs/` root;
2. the user's `~/.ewai/packs/` root;
3. the project's `.ewai-pipeline/packs/` root.

The project root is resolved from its locator; do not assume that the configured SPECS directory is `./SPECS`.

There is no dedicated public `blueprint validate` command in the current CLI. Validate through Guided Setup in a safe test project and, for maintained packs, add resolver-level tests using the repository's organisation-blueprint test patterns.

## Strict manifest failures

The organisation manifest is strict. Common failures include:

| Failure | Check |
| --- | --- |
| Unsupported schema | Root `schema` must be `ewai.pack/v1`. |
| Wrong pack type | Root `type` must be `organisation`. |
| Invalid identity | Use a publisher-scoped lowercase pack ID and matching `blueprint.publisher.id`. |
| Missing version | Provide a valid pack `version` and a compatibility range. |
| Unknown field | Remove fields not declared by the V1 schema; keep catalogue metadata outside the strict manifest. |
| Duplicate module ID | Give every module a stable unique ID. |
| Invalid Source Map profile | Use a registered analyser, safe patterns and supported data-only fields; don't include commands or executable paths. |
| Invalid source | Standard and persona entries must reference bounded relative Markdown paths. |

Empty content arrays are permitted in a module. As an authoring choice, give each required module a clear purpose; that recommendation isn't a schema requirement for a minimum number of standards or personas.

Do not “fix” strict validation by weakening the schema or adding an ignore flag. The strict surface protects portability and makes the digest meaningful.

## Identity and compatibility

Check these values together:

- pack `id`;
- pack `version`;
- `blueprint.publisher.id`;
- `blueprint.publisher.name`;
- `blueprint.compatibility.ewai`.

If the compatibility range excludes the current EWAI version, update the pack only after confirming the current runtime contract. Do not widen the range merely to suppress the error.

## Dependency failures

`requires` lists organisation pack IDs, not per-dependency version ranges. Each required pack must be installed and compatible with the running EWAI major version. The reviewed pack content and digests identify the actual inputs.

Check for:

- a missing dependency pack;
- a dependency whose `blueprint.compatibility.ewai` doesn't match the running EWAI major version;
- circular dependencies;
- two locally installed packs with confusing or colliding identities;
- content collisions after dependency modules are combined.

Optional module choice applies to the selected root pack. Dependency modules are requirements, not an opportunity for the consuming project to silently weaken the dependency contract.

## Path and content safety failures

All referenced content must remain inside its pack. Reject:

- absolute paths;
- `..` traversal outside the pack;
- symbolic links that escape the real pack directory;
- non-Markdown standard or persona sources;
- missing or unreadable files;
- oversized content.

Current bounds are:

- 256 KiB per manifest;
- 1 MiB per referenced content file;
- 5 MiB of referenced content per pack;
- eight directory levels when discovering manifests, not eight dependency levels.

Split genuinely separate concerns into modules instead of raising limits or hiding large reference material inside a standard.

## Digest surprises

The deterministic digest changes when resolved material changes, including relevant manifest data, selected content, dependencies, or modules.

If a digest changes unexpectedly:

1. compare the installed pack with the reviewed source revision;
2. check dependency versions and content;
3. confirm the selected optional modules;
4. inspect line-ending or content changes in referenced Markdown;
5. do not reuse an old approval against the new digest.

The digest identifies reviewed inputs; it is not a publisher signature or malware scan.

## Preview and application failures

Guided Setup separates preview from named approval. A preview can fail because required Discovery answers are incomplete. Application can then fail because:

- a newer draft revision exists;
- generated destinations already exist;
- a selected pack or module changed after Review;
- the approver name or confirmation is missing;
- a write failed and the transaction rolled back.

Do not delete destination files just to make the transaction pass. Compare them with the proposed output and decide whether to retain, migrate, or supersede the existing project truth.

## Drift after application

The project receipt and pipeline pin preserve the accepted pack ID, version, modules, digest, approver, and time. An upstream pack change does not automatically rewrite the project.

When drift is reported:

1. retain the existing project files;
2. locate the exact installed version and digest;
3. review the newer pack and release notes;
4. compare materialised standards and personas;
5. decide whether to adopt, defer, or reject the change;
6. record the new project decision.

## Minimal diagnostic record

Capture:

- pack root and manifest path;
- pack ID, version, publisher, and compatibility;
- selected modules and dependencies;
- error text and failing layer;
- current and expected digest where available;
- destination conflicts;
- recovery decision and owner.

Do not include proprietary content or secrets in a public issue report.

## Related guides

- [Designing Organisation Blueprint Packs](../designing-organisation-blueprint-packs.md)
- [Maintaining Organisation Blueprints](maintaining-organisation-blueprints.md)
- [Troubleshooting and recovery](../operations/troubleshooting-and-recovery.md)

## Current contract sources

- `src/organisation-blueprints.mjs`
- `src/discovery.mjs`
- `config/pack.schema.json`
- `tests/organisation-blueprints.test.mjs`
- `tests/discovery.test.mjs`
