# Install and update EWAI

EWAI is installed through npm. Your project's code and SPECS stay in your workspace; premium personas are an optional, separately licensed download.

This guide covers the harness installation. For a persona licence, use [Set up and update premium personas](premium-personas-setup.md). For an existing codebase, follow [Existing-project onboarding](../existing-project-onboarding-guide.md) after installation.

## Before you start

You'll need Node.js 22.5 or newer, npm, Git for project version control, and a supported host: Codex, Claude Code or Google Antigravity's `agy` CLI. Technology packs can have further requirements.

EWAI includes its own parsers. Don't add Tree-sitter dependencies to your application just to use the harness.

## Install globally

This makes `ewai` available from your project folders:

```bash
npm install --global @thebackstoryis/engineering-with-ai
ewai install --host auto
ewai
```

The installation command makes the host skills and MCP connection available. You can choose one host explicitly with `--host codex`, `--host claude` or `--host antigravity`.

If npm returns `E404`, check the exact package name and configured registry first. That response alone doesn't tell you whether the package is unpublished, unavailable to your account or missing its requested version. If the intended package still isn't available, contact the publisher; don't install a similarly named package as a substitute.

An authentication/access failure is also separate from a persona licence. Check npm's own error before changing account settings. Never enter a persona key in an npm command.

### Keep the harness version with one project

For a project-local development dependency:

```bash
npm install --save-dev @thebackstoryis/engineering-with-ai
npx ewai install --project . --host auto
npx ewai
```

Review and commit the package and lockfile changes through your normal project process.

### Run without a global installation

```bash
npx --yes @thebackstoryis/engineering-with-ai@latest
```

This asks npm to obtain and run the package. It doesn't create a standing global installation.

## Try the beta channel

The beta channel is an opt-in prerelease. Version `0.3.1-beta.0` adds [concise answers and guided decisions](../context-management-and-token-efficiency.md#concise-answers-and-guided-decisions); production remains `0.3.0`.

For one project:

```bash
npm install --save-dev @thebackstoryis/engineering-with-ai@beta
npx ewai
```

To pin this specific beta instead of following the beta channel, replace `@beta` with `@0.3.1-beta.0`. For a global beta installation, use `npm install --global @thebackstoryis/engineering-with-ai@beta`, then start EWAI in your project folder.

Initialisation or normal check-in refreshes the EWAI-managed block in `AGENTS.md` and `CLAUDE.md`. Guidance outside that block is preserved. In an existing project, you can refresh explicitly with `npx ewai checkin --project . --json` for a project dependency, or `ewai checkin --project . --json` for a global installation. Start a fresh host conversation after refreshing so it reads the new instructions. Review changes to your project's package, lockfile and instruction files before committing them.

Beta check-in offers updates from the beta channel. To return to production deliberately, install `@latest` using the same project-local or global scope, then run that version's check-in and start a fresh conversation. Review the instruction changes and use [dashboard recovery](troubleshooting-and-recovery.md#dashboard-will-not-start) if an older runtime is still running. Returning to production does not undo work already performed in your application.

## Start your project

Open your project folder in the host and start EWAI. Agree where its SPECS folder should live before initialising it. For existing code, EWAI offers Archaeology to reconstruct missing project knowledge; you can accept or decline it.

For explicit terminal setup:

```bash
ewai init --project /path/to/project --name "Example Product" --codex
ewai doctor --project /path/to/project --json
```

Initialisation preserves existing files unless you deliberately supply `--force`. Don't use that option to clear a setup error without inspecting what it would replace.

A multi-repository workspace can keep SPECS separately:

```bash
ewai init \
  --project /path/to/workspace \
  --name "Example Product" \
  --specs project-knowledge/SPECS \
  --init-specs-repo
```

The locator in `.ewai-pipeline/project.json` records the chosen SPECS location.

After initialisation, check that `.ewai-pipeline/project.json` points to your chosen SPECS folder and that the folder exists. Open the host conversation to complete Discovery; those files alone don't mean onboarding is finished. Follow [your first session](../tutorials/first-session.md) for the observable steps.

## Update the harness

Use the npm update action offered by EWAI's check-in. For a global installation, an explicit update is:

```bash
npm install --global @thebackstoryis/engineering-with-ai@latest
ewai install --host auto
```

For a project dependency, update through its package manager and review the lockfile. Refresh the intended host installation afterwards.

Start a fresh session and check that it reports the expected version. If the dashboard is still running an older runtime, use the [dashboard recovery instructions](troubleshooting-and-recovery.md#dashboard-will-not-start).

A source checkout is for developing EWAI, not updating the installed harness. Pulling a repository doesn't update your npm installation.

## Check that it's ready

For a diagnostic report:

```bash
ewai checkin --project . --json
ewai doctor --project . --json
```

Check the result for an actionable problem: a dashboard that didn't start, inconsistent project state, a missing tool or an update that needs your decision. An unavailable network check means EWAI couldn't establish that fact; it doesn't by itself mean your project or licence is broken.

Check-in can start or reuse the dashboard, refresh derived state and check the persona licence. It doesn't automatically download persona updates. A confirmed expiry of the matching team licence can remove the unchanged managed pack; see [subscription expiry](premium-personas-setup.md#what-happens-when-annual-access-expires).

## Where host configuration lives

| Host | Project skills | Project MCP configuration |
| --- | --- | --- |
| Codex | `.agents/skills/` | `.codex/config.toml` |
| Claude Code | `.claude/skills/` | `.mcp.json` |
| Google Antigravity | `.agents/skills/` | `.agents/mcp_config.json` |
| Grok Build (development branch) | `.grok/skills/` | `.grok/config.toml` |

EWAI merges its entries with unrelated host configuration. Don't replace the entire file to update one entry. After an update, check that your other MCP servers are still present.

Grok support is in development and is not in the published `0.3.1-beta.0` package. On that development branch, `EWAI_HOST=grok ewai` opens the native Grok companion without a model override. Install and authenticate the CLI through the [official Grok Build instructions](https://docs.x.ai/build/overview). CLI installation alone does not prove account access or project trust.

For explicitly selected global skill installation, EWAI respects `GROK_HOME`; project installation uses `.grok/skills/`. Malformed, conflicting or unsafe TOML configuration stops MCP setup without rewriting that file. Resolve the reported configuration issue and retry; keep other MCP entries.

### Grok Build (development branch)

1. Install and authenticate Grok Build using its official instructions. For this branch's isolated unattended workers, the supported identity is `grok 1.0.44 (5b807183dd79) [stable]` on macOS. Other identities stop until their conformance contract is reviewed.
2. Enable Grok with `ewai validation set grok available --enabled --project .`. For a new project, `ewai init --grok` records the same explicit availability choice.
3. Choose providers in **Configuration → Coding providers**, or use `ewai providers set --primary grok --secondary codex --tertiary claude --pool grok,codex,claude --project .`. Enable and authenticate the selected reviewers too. Leave model fields blank for native selection.
4. Before unattended work, open **Configuration → Grok Build credentials** and use **Check and save key**, or run `ewai providers credentials grok configure` in an interactive terminal for hidden input. The key is saved for your account on this computer, outside the project, in an owner-only local file. `XAI_API_KEY` in the launching environment takes precedence. Interactive OAuth sessions can still use the native companion; isolated workers do not copy your personal authentication files. Never put keys in project YAML, command arguments, chat, commits or release notes.
5. Run the usual AFK preflight or preview and approve an autonomy grant. Full automatic selection stays inside the approved scope and preserves Build approval, required review and Manual QA checkpoints.

Grok coding, review and restricted proposal modes each verify the installed binary and their own offline confinement contract. The worker has a fresh private home and no inherited project instructions, hooks, skills, MCP servers or personal model configuration. EWAI supplies approved task context; Grok retains native model choice without a model override. Its bounded session-title metadata request is separate from the coding/proposal tools. Offline conformance makes no paid model requests and does not prove your account access or the quality of a real response.

Coding copies declared task files into a disposable workspace. The worker may edit only that copy; EWAI checks scope, unchanged source predecessors and current authority before accepting changes. Review is read-only. EWAI's conductor runs approved commands and owns commits and integration. Snapshots accept regular files only, up to 900 KB per file, 256 files and 16 MiB overall. Root-wide globs and copied CLI/credential configuration are unsupported: narrow the task's file sets instead.

For coding and review, the conductor includes the complete cited standards and recorded check outputs in mandatory task context. Review also receives the exact implementation commit diff. Git history and canonical SPECS remain outside the worker's filesystem. Evidence is bound to its task, source contents and revision, then checked again before dispatch and acceptance. Missing, changed or oversized evidence stops the run; restore the required evidence or narrow the approved task and prepare fresh context. Mandatory evidence is never silently truncated to fit a prompt.

If a version, isolation check, unsupported system configuration, credential or model restriction blocks the run, inspect the recorded reason. Recommended: use the supported CLI identity, configure the private key, or remove an unsupported permitted-model restriction for native selection, as applicable, then repeat preflight. If source files changed, prepare a fresh task snapshot. Preserve partial edits and uncertain execution for recovery; do not blindly retry. No model setting is a token or spending cap.

#### Private Grok key setup and recovery

```bash
ewai providers credentials grok configure
ewai providers credentials grok status --json
ewai providers credentials grok check
ewai providers credentials grok remove --yes
```

Configure requires a real interactive terminal; keys cannot be passed through flags or input files. The local dashboard password form is the alternative. Both routes share validation and recovery. Submitting a key authenticates against xAI's [model-list endpoint](https://docs.x.ai/developers/rest-api-reference/inference/models) without requesting generated output. Success proves that endpoint accepted the key, not available credit, permission to every model, or coding readiness. The check does not select a model or start a delivery.

On supported POSIX systems, explicit setup stores plaintext in `~/.ewai/credentials/grok.json` with owner-only file permissions (`0600`) in a private directory (`0700`). It is not encrypted or an OS keychain; processes running as your account can read it. The key applies across EWAI projects for that account. EWAI rejects insecure permissions, links, shared files and storage inside the project. On Windows, use a privately supplied launching environment; this file-storage route is unavailable.

Status shows only the credential source and whether a saved key exists. It never returns the key. Connection checks run only when explicitly requested. Failed or stale replacement keeps the previous saved key; refresh status, correct the problem and submit again. The dashboard clears the password after success, failure or cancellation and does not store it in browser storage. Removing a saved key does not revoke it at xAI, and does not clear an environment override. Remove `XAI_API_KEY` from the launching environment and restart EWAI if you want the saved key to become active. Use xAI's own account controls to revoke a key.

Saved keys are resolved at each isolated-worker invocation. The worker receives only the credential in its private environment; no personal authentication/configuration files are copied. Native model selection and conformance requirements remain unchanged.

## Premium personas

Enter your licence through **Configuration → Premium personas → Manage licence** in the dashboard, or use the hidden terminal prompt:

```bash
ewai persona premium configure --project .
```

Submitting a valid key verifies access, saves it privately and installs the pack immediately. Wait for the readiness confirmation before relying on it for analysis. Later updates need a separate decision; normal session checks don't download them.

Your own personal and project personas aren't part of the managed pack. See the [setup guide](premium-personas-setup.md) for failures, updates and the difference between individual and team expiry. The [provider reference](../persona-entitlement-provider-guide.md) covers archive validation and storage for implementers.

## Related guides

- [Choose dashboard views](dashboard-configuration.md)
- [Dashboard and delivery state](dashboard-and-delivery-state.md)
- [Troubleshooting and recovery](troubleshooting-and-recovery.md)
- [Working with personas](../working-with-personas.md)

## Implementation references

`src/install.mjs`, `src/project.mjs`, `src/checkin.mjs`, `src/persona-entitlements.mjs`, `src/runtime/mcp-config.mjs`, `tests/install.test.mjs` and `tests/checkin.test.mjs`.
