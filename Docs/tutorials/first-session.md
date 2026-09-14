# Your first EWAI session

Set up a small, disposable project and find out what EWAI saves for you. You don't need an existing application, a Blueprint or a premium-persona subscription.

You'll need [EWAI and its host skills installed](../operations/installation-updating-and-entitlements.md). This tutorial uses a fictional support-ticket tool. It won't create a production service or require customer data.

## 1. Open an empty project

Create an empty folder called `ewai-support-demo` somewhere you keep test projects. Open it in your supported AI host. Ask:

> “Start EWAI here. We're trying it with a small support-ticket tool.”

The first setup choice is where to keep SPECS, the project's readable knowledge folder. For this single-folder example, choose `SPECS` inside the project. Don't choose an unrelated existing knowledge folder.

After initialisation, you should be able to find `SPECS/` and `.ewai-pipeline/project.json`. The latter points EWAI to the chosen knowledge location. Creating those files isn't the same as agreeing the project's requirements.

If you prefer terminal setup, run this **inside the empty example folder**, then return to the host conversation:

```bash
ewai init --project . --name "Support demo" --codex
ewai doctor --project . --json
```

Use the host option appropriate to your installation. Doctor reports configuration problems; don't use `--force` as a shortcut around one.

## 2. Choose how much setup you need

For this exercise, the project is new: there is no existing code to investigate. In a real existing project, EWAI should offer **Archaeology**, which reconstructs missing documentation from evidence. You can decline it and continue through Discovery, recording what you haven't investigated.

Premium personas are optional. If you have a licence and want their perspectives in the analysis, [set it up privately](../operations/premium-personas-setup.md) and wait for the installation confirmation before continuing. Don't enter the key in this conversation. Without a licence, continue with the included personas.

You don't need Team Hub, Portfolio or an Organisation Blueprint for this exercise. Accepted project standards and approval gates still apply.

## 3. Describe the project

Tell EWAI:

> “Support colleagues need to record tickets, filter their queue and export the filtered list. For now we're exploring the export. We haven't chosen the application stack. No real customer data belongs in this demo.”

Answer questions about the people, outcome, scope and constraints. It's fine to say “we haven't decided” where that's true. Don't accept an invented requirement just to complete a field.

Ask EWAI to show you the drafted project purpose and requirements in SPECS. Check that they describe the support colleagues' needs, distinguish unresolved choices and don't claim an application already exists.

**Your observable result:** a local knowledge structure, draft project context and a clear next decision. The exact assistant wording will vary with your host; generated text isn't automatically approved project truth.

## 4. Open the dashboard

Ask EWAI to open the project dashboard. Use the loopback URL returned for this project; its port can vary.

The dashboard lets you inspect saved work and make supported choices. The host conversation performs the guided work. Opening the dashboard doesn't silently start a delivery.

The URL begins with `127.0.0.1` and works on the computer running EWAI. A colleague needs to work with you locally or through screen sharing; sending that URL alone won't give them access.

## 5. Check where you are, then stop

Ask:

> “Show us what's saved, which decisions are still open, and what we'd do next. Don't implement anything.”

You should be able to distinguish your draft from an approved intent and find the saved records. If the host can't find its skills, restart it after checking the [host installation](../operations/installation-updating-and-entitlements.md). If Doctor reports inconsistent state, use [recovery guidance](../operations/troubleshooting-and-recovery.md), not manual database edits.

You can close the session here. Later, open the same folder and ask EWAI to pick up the saved project. For a delivery exercise, continue with [your first feature](first-delivery.md).
