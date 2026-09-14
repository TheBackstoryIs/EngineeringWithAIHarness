---
name: ewai-dashboard-configuration
description: Inspect and change a project's optional EWAI dashboard views and sidebar preference through the shared validated configuration contract. Use when a user wants a simpler dashboard or needs specialist views.
---

# Configure your dashboard

Start with `ewai dashboard preferences --project PROJECT --json`. Explain only the options relevant to the user's work, using the returned titles and descriptions. All nine specialist views are off unless selected; the core work views and Configuration remain available.

Ask which changes they want when their request is unclear. Reading settings requires no save consent. For agreed changes use:

`ewai dashboard configure --enable VIEW --disable OTHER_VIEW --expected-digest DIGEST --yes --project PROJECT --json`

Repeat `--enable` or `--disable` for multiple views. Use `--collapse` or `--expand` for the sidebar. Omit options not being changed. Use the digest from the inspected settings; never invent one or silently retry a stale save. If the configuration changed, read it again, explain the difference and reconfirm the intended changes.

Confirm what was saved and that the dashboard will pick it up on refresh. Do not edit YAML directly, change global settings or install anything. View preferences do not disable required standards, checks, policies, approvals, hooks or licence checks. Enabling a view does not authorise running scanners, syncing a team service, applying a starter or downloading personas.

Premium learning and setup disappear from routine navigation only when access is available and the installed pack is verified. Licence management and recovery remain in Configuration. Use the existing private licence form if requested; never collect a licence key in chat.

For a failed read or save, show the safe error and the relevant next step. Do not overwrite malformed configuration, break a lock, broaden the project path or suppress an assurance failure to make the dashboard look simpler.
