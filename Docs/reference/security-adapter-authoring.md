# Write a security adapter

This reference is for engineers supplying an organisation-owned wrapper or translating an external tool's output into EWAI's contract. EWAI doesn't ship a universal scanner wrapper. To use an existing reviewed adapter, follow [the operating guide](../security-validation-guide.md#registered-command-adapter).

Create a dedicated adapter folder containing an executable and `security-adapter.json`:

```json
{
  "schema": "ewai.security-adapter/v1",
  "id": "org.example.security",
  "name": "Example security adapter",
  "publisher": {
    "id": "org.example",
    "name": "Example Organisation"
  },
  "version": "1.0.0",
  "protocolVersion": "1",
  "capabilities": ["source-static", "secret-detection"],
  "entrypoint": "adapter.mjs"
}
```

The manifest is strict. The entrypoint must be a regular executable file inside the adapter folder. Validation reads and hashes it but does not execute it.

## Interface safety requirements

If you're building an organisation-specific interface, preserve EWAI's exact security assurance notice in security results and error states. Don't shorten, replace or make it dismissible; provider wording doesn't satisfy this requirement. The [operating guide](../security-validation-guide.md) includes the notice and explains its meaning.

Keep dashboard operations loopback-only, same-origin, JSON-only and explicitly confirmed. Resolve supported provider imports on the server. Don't add arbitrary command, path, host or provider-URL inputs to the browser interface.



## Minimal executable: report that no scan was performed

The following `adapter.mjs` is deliberately **incomplete**. It exercises the response shape without pretending to scan code or certify security. Pair it with the manifest above and make it executable before validation. A production adapter must run the approved tool, normalise its findings and report its actual coverage.

```javascript
#!/usr/bin/env node
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 65536) process.exit(1);
}
try {
  const request = JSON.parse(input);
  if (request.schema !== 'ewai.security-scan-request/v1' ||
      typeof request.runId !== 'string') process.exit(1);
  process.stdout.write(JSON.stringify({
    schema: 'ewai.security-scan-response/v1',
    runId: request.runId,
    status: 'incomplete',
    complete: false,
    capabilities: ['source-static'],
    findings: [],
    warnings: ['Example adapter: no scan was performed.']
  }) + '\n');
} catch {
  process.exitCode = 1;
}
```

The example supplies only `source-static`; change the manifest's capabilities to `["source-static"]` to match. It must not satisfy a required security check.

## Versioned contracts

- [Adapter package](../../config/security-adapter.schema.json)
- [Full request](../../config/security-scan-request.schema.json)
- [Full response](../../config/security-scan-response.schema.json)
- [Policy configuration](../../config/security-validation-policy.schema.json)

Echo the exact run ID from the supplied request. Return complete evidence only for work actually performed against the requested scope and revision. Do not relabel an old provider report as current, leak credentials or send raw provider responses as findings.

The [source-checkout adapter tests](../../tests/security-validation-runs.test.mjs) show `createAdapter`, complete/incomplete responses and refusal cases. Those fixtures aren't prebuilt production integrations and aren't part of application setup.

## Trust and upstream behaviour

A registered adapter is trusted local code with operating-system permissions; it **isn't OS-sandboxed**. EWAI bounds execution and validates returned evidence, but those checks don't make an arbitrary scanner safe.

Before use, review the upstream tool's data handling, network access, costs and whether it can change source or open pull requests. Preserve the [provider-specific cautions](../security-validation-guide.md#3-working-with-agentic-security); a skill handoff prepares work but doesn't execute that external scanner.

Security validation is evidence, not certification or proof that this system is secure. Tools can miss vulnerabilities and produce false positives. A qualified human must review the scope, findings, limitations and residual risk before release.
