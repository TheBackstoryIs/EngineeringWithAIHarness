# Choose which dashboard views you need

The dashboard starts with its everyday tools. Extra views are off by default, so you don't have to navigate portfolio management, policy controls or integration tools when your project doesn't need them.

## Coding provider settings (in development)

The development branch includes **Configuration → Coding providers**. This is not part of the published `0.3.1-beta.0` package. These settings govern host selection and AFK/autonomy dispatch; saving them does not start a delivery or approve execution.

Choose the primary coding provider, secondary and tertiary reviewers, and an eligible pool. **Existing behaviour** preserves normal host selection and checkpoint policy. **Choose automatically** creates a draft with automatic roles; it does not run anything or approve a grant. Required review capacity cannot be weakened, and reviewers must differ from the actual coding agent.

Leave optional model fields blank to let each CLI decide. A suggestion supplies advisory guidance without forcing a model. A permitted-model list is a strict boundary: unsupported enforcement stops invocation. The current adapters do not have verified permitted-list enforcement. Recommended: leave this list blank for native selection unless a verified adapter is available. This is not a token or spending cap, and no savings have been measured.

Use **Save provider settings** to apply the draft. **Cancel changes** restores the last saved policy in the form; **Restore existing behaviour** removes only the additive provider policy when saved. If another editor changes configuration, the draft is retained. Compare the latest settings, then explicitly keep the draft against those settings before saving again. That replaces the provider policy, while preserving other project configuration.

For automatic unattended work, save an eligible pool, then choose **Automatic from saved pool** in the autonomy controls. Preview and review the exact providers, intents, actions, expiry and limits before approving a grant. Selection uses only providers inside both the saved pool and approved grant that can perform the requested action and enforce any configured model restriction. Automatic roles skip ineligible providers; explicitly selected or inherited required providers stop instead of changing your choice. Changing settings invalidates the old grant: review a fresh one.

Installed CLI status does not prove authentication or unattended capability. Grok coding, review and proposal modes each run an offline conformance check before dispatch. See [Grok setup and limitations](installation-updating-and-entitlements.md#grok-build-development-branch). A failed check stops the run; inspect its reason before retrying.

## Grok Build credentials (in development)

Open **Configuration → Grok Build credentials** to enter an xAI API key in a password field, then choose **Check and save key**. This performs an authentication-only check and saves a key for your account on this computer, across EWAI projects. It does not start work or select a model. The owner-only local credential file is outside the project and is not encrypted.

The status distinguishes a saved key from `XAI_API_KEY` in the launching environment, which takes precedence. **Check connection** checks the active credential without generating output; it does not prove available credit or coding readiness. **Remove saved key** removes only EWAI's saved copy; it does not revoke the key or clear an environment override. **Cancel key entry** clears the input while retaining the previous saved key.

The password is cleared after every submission, including a failed check, and is never put in browser storage. Failed replacement retains the previous saved key. If a saved revision changed, refresh status before retrying. For storage, CLI alternatives and recovery, see [private Grok setup](installation-updating-and-entitlements.md#private-grok-key-setup-and-recovery).

## Show an extra view

1. Open your project's dashboard.
2. Choose **Configuration** near the bottom of the left sidebar.
3. Tick the views you need.
4. Choose **Save changes**.
5. Open the new item in the sidebar.

You can turn a view off again in Configuration. That hides it; it doesn't delete its records or remove required checks.

On a small screen, open the navigation drawer to reach Configuration. On a larger screen, **Collapse sidebar** gives the work area more room. That setting is saved for the project too.

## What the optional views are for

| View | Use it when you need to… | What you still need to set up |
| --- | --- | --- |
| **Portfolio** | Compare several local projects and their dependencies. | A project portfolio manifest. |
| **Team Hub** | Share approved project summaries and reusable resources with your team. | A separately operated Hub and an explicitly approved connection. |
| **Governed Rollout** | Review adoption and differences across configured projects or organisations. | The rollout's project and baseline configuration. |
| **Starters** | Review and add your team's approved starter files. | An accepted starter receipt, target mappings and a reviewed source adapter. |
| **Policy Gates** | Check proposed work against your organisation's configured design policies. | The applicable policy content and project configuration. |
| **Security Validation** | Review configured security checks, findings and decisions. | Security profiles and the relevant external tools or adapters. |
| **Hooks** | See whether a configured integration received an EWAI milestone. | A registered handler and an enabled event subscription. |
| **AI context diagnostics** | Inspect which evidence and personas EWAI selected for an AI task. | A relevant task or context request to inspect. |
| **Contributions** | Add business or technical context to work that's already in progress. | The relevant delivery and contribution context. |

Turning on a view only makes it visible. It doesn't run a scan, connect a service, execute an integration or install anything.

Similarly, hiding **Security Validation** or **Policy Gates** doesn't waive requirements already configured for the project.

## If you're looking for an older name

**Phase Studio** is now labelled **Contributions**.

**Context Inspector** is now labelled **AI context diagnostics**.

These are different tools. Contributions helps people add information to a delivery; AI context diagnostics helps you inspect what information is being supplied to an AI task.

## Manage your persona licence

In Configuration, find **Premium personas** and choose **Manage licence**. You can use this even when premium access is active and the setup prompts have disappeared from the sidebar.

See [Set up and update premium personas](premium-personas-setup.md).

## If settings won't save

If the project configuration changed while you were editing it, refresh the settings before saving again. EWAI refuses to overwrite a newer configuration using an older copy.

If the configuration can't be read, ask your technical owner to check the configured `pipeline.yaml`. Don't delete the file or replace its approval and standards sections to make the dashboard load.

## Configure views from the CLI

An AI assistant can help with the same settings through the dashboard-configuration flow. If you're scripting the change yourself, first read the current preferences:

```bash
ewai dashboard preferences --project . --json
```

Use the returned `digest` when saving. It identifies the configuration you inspected, so the command can reject a save if someone has changed it since.

For example, to show Portfolio:

```bash
ewai dashboard configure --enable portfolio --expected-digest DIGEST --yes --project .
```

Replace `DIGEST` with the value returned by the first command. To hide it, use `--disable portfolio`. To change sidebar width, use `--collapse` or `--expand`.

The technical view IDs are:

| Display name | CLI ID |
| --- | --- |
| Portfolio | `portfolio` |
| Team Hub | `team-hub` |
| Governed Rollout | `rollout` |
| Starters | `starters` |
| Policy Gates | `policies` |
| Security Validation | `security` |
| Hooks | `hooks` |
| AI context diagnostics | `context-inspector` |
| Contributions | `phase-studio` |

These preferences are stored in the project's configured `pipeline.yaml`. They aren't separate permissions, and they don't replace the setup instructions for the feature you've chosen.
