# Generic error-report provider contract

Use this contract only for organisation-owned or commercial adapters that transport an already-finalised EWAI error-report ZIP. An adapter is trusted local code. EWAI ships no built-in vendor connector and no hosted reporting service.

## Package shape

The adapter folder must be a real, non-symbolic directory containing `error-report-provider.json`:

```json
{
  "schema": "ewai.error-report-provider/v1",
  "id": "example.support",
  "name": "Example support transport",
  "publisher": { "id": "example", "name": "Example Ltd" },
  "version": "1.0.0",
  "protocolVersion": "1",
  "entrypoint": "bin/send-report"
}
```

Only those fields are accepted. The entrypoint must be a relative, executable, regular file inside the adapter root. Symbolic links, path escape, oversized packages and unsafe identifiers are rejected.

Validation reads and digests the package but does not trust or execute it:

```bash
ewai error-report adapter-validate ./adapter --project . --json
```

Registration requires `--yes` because it trusts local code. Registration does not execute the adapter:

```bash
ewai error-report adapter-register ./adapter --project . --yes --json
```

EWAI rejects same-version package digest drift. Submission re-reads the current manifest and package and refuses execution when either digest differs from the registered record.

## Submission protocol

EWAI writes one JSON object to the adapter's stdin:

```json
{
  "schema": "ewai.error-report-submission/v1",
  "attemptId": "uuid",
  "reportId": "report_example",
  "revision": 1,
  "archiveDigest": "sha256:...",
  "packagePath": "/absolute/runtime/path/report_example-r1.zip",
  "packageSize": 1234
}
```

The path is supplied only to the explicitly trusted local process. The process receives a minimal environment and must treat the ZIP as immutable. It must emit exactly one bounded JSON acknowledgement to stdout:

```json
{
  "schema": "ewai.error-report-provider-ack/v1",
  "attemptId": "uuid",
  "archiveDigest": "sha256:...",
  "status": "accepted",
  "externalReference": "provider-ticket-123"
}
```

The `attemptId` and `archiveDigest` must exactly match the request. `status` may be `accepted` or `rejected`; EWAI records only an exact accepted acknowledgement as a receipt. Extra fields, malformed JSON, timeout, oversized output, non-zero exit, digest mismatch and rejection produce a retained failed attempt.

## Security and assurance boundary

- Use `shell: false` behaviour in the entrypoint and never reinterpret request fields as shell syntax.
- Do not read files other than the supplied finalised ZIP.
- Do not return credentials, response bodies or sensitive provider errors on stdout.
- Apply provider authentication inside the adapter's own secure configuration boundary; do not add secrets to the EWAI report or manifest.
- Treat the receipt as transport evidence, not resolution, certification, security acceptance, Manual QA or release approval.
- Version and review adapter code. Re-register every intentional code change under a new version.
