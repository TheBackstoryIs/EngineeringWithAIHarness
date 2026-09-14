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

EWAI merges its entries with unrelated host configuration. Don't replace the entire file to update one entry. After an update, check that your other MCP servers are still present.

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
