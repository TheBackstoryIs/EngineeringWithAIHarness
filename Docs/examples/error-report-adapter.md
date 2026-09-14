# A minimal, non-sending error-report adapter

This example lets you validate an adapter package without a vendor account or network access. It **always rejects transport**. It must never report a ticket as created when nothing was sent.

For a real integration, implement transport and return acceptance only after the provider accepts the immutable ZIP. Use the [versioned request and acknowledgement contract](../../skills-src/ewai-error-reporting/references/provider-contract.md).

## Create the package

Create `example-adapter/error-report-provider.json`:

<!-- example: error-adapter-manifest -->
```json
{
  "schema": "ewai.error-report-provider/v1",
  "id": "example.support",
  "name": "Example non-sending adapter",
  "publisher": {"id": "example", "name": "Example Organisation"},
  "version": "1.0.0",
  "protocolVersion": "1",
  "entrypoint": "bin/send-report"
}
```

Create `example-adapter/bin/send-report`:

<!-- example: error-adapter-script -->
```javascript
#!/usr/bin/env node
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 65536) process.exit(1);
}
try {
  const request = JSON.parse(input);
  if (request.schema !== 'ewai.error-report-submission/v1' ||
      typeof request.attemptId !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(request.archiveDigest)) {
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    schema: 'ewai.error-report-provider-ack/v1',
    attemptId: request.attemptId,
    archiveDigest: request.archiveDigest,
    status: 'rejected',
    externalReference: 'example-no-transport'
  }) + '\n');
} catch {
  process.exitCode = 1;
}
```

Make the entrypoint executable and validate the folder:

```bash
chmod +x ./example-adapter/bin/send-report
ewai error-report adapter-validate ./example-adapter --project . --json
```

Validation reads the package and returns its identity and digests. It doesn't execute or trust the adapter. You don't need to register or submit a real report to complete this example.

## Before building real transport

The adapter receives one JSON request through stdin. Only the supplied finalised ZIP may be sent; don't collect extra logs, source or environment values. Never expose provider credentials or raw error responses through stdout.

Registration explicitly trusts local code. The process has your operating-system permissions and **isn't OS-sandboxed**. Time/output limits and a minimal environment don't change that.

A real accepted acknowledgement must repeat the exact attempt ID and archive digest and contain a bounded provider reference. Rejection, mismatches or execution errors leave a failed attempt, not a transport receipt.

Use a new version and explicit registration when adapter code changes. See the [provider guide](../error-reporting-provider-guide.md) for registration, sending and receipt inspection.
