# Error Reporting provider guide

EWAI exposes a generic provider adapter boundary so an organisation can integrate its chosen commercial error tracker, ticketing tool or support service. The core product ships no connector, requires no paid service and provides no hosted reporting backend.

## Responsibility split

EWAI owns safe local drafting, review, deterministic ZIP finalisation, exact digests, explicit submission approval, bounded adapter invocation, and local attempt/receipt evidence.

The adapter owns provider authentication, network calls, provider-specific field mapping, rate limits and the external reference. It must not expand the report by collecting source, environment values, logs or other local material.

## Build an adapter

Create a self-contained folder with `error-report-provider.json` and one executable entrypoint. The manifest declares a stable provider ID, publisher, semantic version, protocol version `1` and relative entrypoint. Read the [complete versioned request and acknowledgement protocol](../skills-src/ewai-error-reporting/references/provider-contract.md). The [minimal non-sending adapter](examples/error-report-adapter.md) supplies a complete manifest and executable you can validate locally. It deliberately rejects sending; it isn't a built-in vendor integration.

The entrypoint reads one `ewai.error-report-submission/v1` JSON line from stdin. It transports only the supplied immutable ZIP, then writes one `ewai.error-report-provider-ack/v1` JSON object to stdout. The acknowledgement must repeat the exact attempt ID and archive digest and provide a bounded external reference.

Keep credentials in the adapter or provider's established secure configuration. Never put them in the manifest, report, command arguments, stdout or acknowledgement.

## Validate and register

```bash
ewai error-report adapter-validate ./my-adapter --project . --json
ewai error-report adapter-register ./my-adapter --project . --yes --json
```

Validation checks the bounded package shape, entrypoint and digests. Registration requires explicit confirmation because the adapter becomes trusted local code. It isn't OS-sandboxed and runs with your operating-system permissions. Registration does not execute the adapter. It records the reviewed package and manifest digests, and rejects same-version digest drift.

## Send and verify

```bash
ewai error-report providers --project . --json
ewai error-report send report_example \
  --provider example.support \
  --expected-digest sha256:... \
  --yes \
  --project . \
  --json
ewai error-report receipts report_example --project . --json
```

EWAI revalidates the registered package immediately before execution, supplies a minimal environment, disables shell interpretation, bounds time and output, and records every attempt. It creates a receipt only for an accepted acknowledgement with the exact digest.

A receipt is transport evidence, not issue resolution, security acceptance, Manual QA, certification, deployment permission or release approval. Provider dashboards remain authoritative for their own downstream workflow.

## Upgrade and recovery

Publish intentional adapter changes with a new semantic version and register that version explicitly. If execution fails, inspect the reason class and the provider's own safe logs; do not expose credentials or raw provider responses through EWAI. Retrying creates a new attempt and never rewrites history.

Deleting or archiving an EWAI report affects local material only. External provider content cannot be recalled through this interface.
