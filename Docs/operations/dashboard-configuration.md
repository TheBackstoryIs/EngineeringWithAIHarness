# Choose which dashboard views you need

The dashboard starts with its everyday tools. Extra views are off by default, so you don't have to navigate portfolio management, policy controls or integration tools when your project doesn't need them.

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
