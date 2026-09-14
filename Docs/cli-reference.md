# Operational CLI reference

For installation, personas, delivery and the full command-family map, use the [CLI and configuration reference](reference/cli-and-configuration.md). This page covers the detailed error-report and Team Hub commands.

This quick reference covers local error reports and the optional self-operated Team Hub. No paid service or vendor connector is required for either capability. Use `--json` for machine-readable output and `--project PATH` when not running at the project root.

## Local lifecycle

```bash
ewai error-report status [--status draft|finalised|archived] --project . --json
ewai error-report create \
  --capability guided-discovery \
  --error-code EWAI-DISCOVERY-INVALID \
  --command "ewai discover" \
  --installation-source npm \
  --title "Discovery did not validate" \
  --expected "A valid project brief" \
  --actual "Validation stopped" \
  --step "Run guided discovery" \
  --project . --json
ewai error-report show REPORT --project . --json
ewai error-report update REPORT --title TEXT --expected TEXT --actual TEXT --step TEXT --project . --json
ewai error-report finalise REPORT --project . --json
```

EWAI supplies its version, Node version and operating-system class itself. The create command accepts only bounded safe fields; it does not accept raw logs, environment dumps, source or arbitrary attachments.

## Email handoff

```bash
ewai error-report prepare-email REPORT \
  --expected-digest sha256:... \
  [--recipient support@example.com] \
  [--launch] \
  --project . --json
```

`--launch` asks the operating system to reveal the ZIP and open the default email client. The returned state remains `prepared-not-sent`; attach the ZIP manually and send it yourself.

## Provider handoff

```bash
ewai error-report providers --project . --json
ewai error-report adapter-validate FOLDER --project . --json
ewai error-report adapter-register FOLDER --yes --project . --json
ewai error-report send REPORT --provider ID --expected-digest sha256:... --yes --project . --json
ewai error-report receipts REPORT --project . --json
```

Adapters are generic trusted local code. Registration does not execute them. `send` requires the exact finalised digest and explicit confirmation. Accepted receipts prove transport only.

## Settings and local retention

```bash
ewai error-report settings --project . --json
ewai error-report settings --automatic-local-drafts true --project . --json
ewai error-report settings --support-email support@example.com --project . --json
ewai error-report archive REPORT --yes --project . --json
ewai error-report delete REPORT --yes --project . --json
```

Automatic capture is local-only. Archive and delete affect local material only; they cannot recall email or provider data.

## Team Hub contributor lifecycle

```bash
ewai team status --project . --json
ewai team disclosure --project . --json
ewai team connect https://hub.example.org --project-id example --token-env EWAI_TEAM_HUB_TOKEN --acknowledge-disclosure --yes --project . --json
ewai team sync --yes --project . --json
ewai team resources --project . --json
ewai team resource inspect org.example.baseline 1.2.0 --project . --json
ewai team resource install org.example.baseline 1.2.0 --expected-digest sha256:<digest> --approved-by "Named owner" --yes --project . --json
ewai team resource receipts --project . --json
ewai team disconnect --yes --project . --json
```

Connection stores no token value and sends nothing. `sync` is the explicit publication boundary.

## Team Hub service lifecycle

```bash
ewai team-hub start --data /srv/ewai-team-hub --token-env EWAI_TEAM_HUB_TOKEN --publisher-token-env EWAI_TEAM_HUB_PUBLISHER_TOKEN --json
ewai team-hub status --data /srv/ewai-team-hub --json
ewai team-hub stop --data /srv/ewai-team-hub --json
ewai team-hub resource publish ./organisation-blueprint --data /srv/ewai-team-hub --publisher-token-env EWAI_TEAM_HUB_PUBLISHER_TOKEN --yes --json
```

A non-loopback bind also requires `--allow-network`. Shared deployment requires an organisation-managed TLS reverse proxy. The publisher credential is optional and must differ from the reader credential. See the [Team Hub guide](team-hub-guide.md) for disclosure, backup, recovery and authority boundaries, and the [Team Hub Resource Registry guide](team-hub-resource-registry-guide.md) for immutable resource publication and exact-digest installation.

## Completed delivery evidence

Preview a narrow amendment when a completed phase references evidence that was legitimately regenerated or corrected:

```bash
ewai delivery evidence-amendment <slug> --project . --json
```

Apply only the exact previewed substitutions with named human authority:

```bash
ewai delivery evidence-amendment <slug> --project . --yes \
  --approved-by "Name or role" \
  --reason "Reason for the correction" \
  --expected-state-digest <preview-stateSha256> \
  --json
```

This does not reopen the phase or approve Manual QA. It refuses a directly edited completed gate ledger and writes an immutable receipt. See [Completed-phase evidence amendments](completed-phase-evidence-amendments.md).

## Choose the correct evidence amendment

Use [Which amendment operation?](completed-phase-evidence-amendments.md#which-amendment-operation) to distinguish pre-Build `ratify-amendments` from `evidence-amendment` for stale nested evidence references. They aren't interchangeable, and neither supplies approval to implement or release.
