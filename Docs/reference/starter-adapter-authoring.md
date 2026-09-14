# Write a starter-source adapter

For engineers implementing an organisation-owned source adapter. If someone supplies an approved adapter, follow the [operating guide](../governed-starter-project-materialisation-guide.md#validate-and-register-an-adapter) instead.

## Implement a generic source adapter

An adapter is a small, organisation-owned package:

```text
starter-source-adapter/
├── starter-adapter.json
└── adapter.mjs
```

`starter-adapter.json`:

```json
{
  "schema": "ewai.starter-source-adapter/v1",
  "id": "northstar.approved-source",
  "name": "Northstar approved starter source",
  "publisher": { "id": "northstar", "name": "Northstar Digital" },
  "version": "1.0.0",
  "protocolVersion": "1",
  "sourceClasses": ["https", "git", "archive", "directory", "package", "opaque"],
  "entrypoint": "adapter.mjs"
}
```

The entrypoint must be an executable regular file inside the package. The complete package is bounded and digest-pinned at registration. A same-version content change is rejected.

At runtime EWAI starts the exact entrypoint directly, without a shell. It sends one `ewai.starter-source-request/v1` JSON object on standard input. The request contains:

- attempt and nonce identifiers;
- safe project name;
- the accepted receipt, including source, source class, targets, licence, compatibility, and digest;
- one bounded staging root;
- time, output, file, byte, path, and depth limits.

It does **not** contain the project root, repository roots, SPECS root, destination mappings, file plan, approver, credentials, environment secrets, or permission to write anywhere except staging.

The adapter must:

1. parse exactly one request;
2. resolve and obtain the receipt source using its own approved configuration and credential mechanism;
3. write only regular files beneath `stagingRoot` using the receipt target `sourcePath` values;
4. respect every supplied bound;
5. avoid executing the retrieved starter content;
6. return only this acknowledgement on standard output:

```json
{
  "schema": "ewai.starter-source-acknowledgement/v1",
  "attemptId": "the-request-attempt-id",
  "nonce": "the-request-nonce",
  "status": "prepared"
}
```

Do not return a file inventory or digest. EWAI deliberately ignores adapter claims about staged content and performs its own verification. Keep logs free of credentials and write diagnostic text to standard error within the output bound.

The authoritative schemas are:

- [starter-source-adapter.schema.json](../../config/starter-source-adapter.schema.json)
- [starter-source-request.schema.json](../../config/starter-source-request.schema.json)
- [starter-source-acknowledgement.schema.json](../../config/starter-source-acknowledgement.schema.json)



The adapter runs trusted local code with operating-system permissions; it isn't OS-sandboxed. Staging and digest checks protect EWAI's application process, but don't sandbox an arbitrary executable.

The [source adapter tests](../../tests/starter-materialisation.test.mjs) contain `writeAdapter`, a complete executable that writes one fixed `application/index.txt` fixture and echoes the request's attempt ID and nonce. Its paired `expectedStarterDigest` and `writeBlueprint` functions define the corresponding bytes and receipt. Read those together; copying only an acknowledgement won't prepare usable content. These are source-checkout fixtures, not a shipped downloader. Use the versioned schemas above as the contract; a provider-specific downloader still needs authentication, error handling and its own security review.

Return to [registering and using the adapter](../governed-starter-project-materialisation-guide.md#validate-and-register-an-adapter).
