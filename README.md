# Engineering With AI

Engineering With AI (EWAI) helps you plan, build and review software with an AI assistant. It gives the assistant a shared record of the project, a delivery workflow and checks against your engineering standards. You keep control of the decisions and approve implementation before it starts.

## EWAI can now pick up the next ready piece of work

If you’ve prepared several work items, you can choose which ones EWAI is allowed to take on. EWAI checks what’s ready, uses the priorities you’ve recorded to pick the next item, and starts its delivery workflow. Once you’ve separately approved the Build, it can run the approved build tasks, their tests and a fresh review.

This `0.3.0-beta.0` release adds dashboard and command-line controls to preview the work, approve the exact list, set time and attempt limits, follow progress, and pause, cancel or recover a run. New work isn’t added to the list automatically. EWAI stops when it needs a decision from you.

The final whole-delivery test stage, Manual QA and release preparation still happen through the normal EWAI workflow. This beta doesn’t approve or complete those steps for you. Manual QA for this beta is still pending, so treat it as an evaluation build.

To try the beta in a disposable project without replacing a global stable installation, run:

```bash
npm install --save-dev @thebackstoryis/engineering-with-ai@beta
npx ewai
```

To use the beta as your global EWAI version instead, run `npm install --global @thebackstoryis/engineering-with-ai@beta`. This replaces any globally installed stable version.

## Install and start

You'll need Node.js 22.5 or newer, npm, and a supported AI command-line tool such as Codex or Claude Code, installed and signed in.

Install EWAI, go to your project folder, then run `ewai`:

```bash
npm install --global @thebackstoryis/engineering-with-ai
cd /path/to/your/project
ewai
```

Replace the project path with your own. **Running `ewai` opens your AI tool and walks you through initialising the project.** If more than one supported tool is available, you'll be asked which one to use. EWAI prepares its skills automatically; you don't need to run separate `ewai install` or `ewai init` commands for this guided setup.

It first asks where to keep your project's SPECS records, then helps you describe what you're building. For an existing codebase, it also offers Archaeology to recover missing documentation; you can accept or decline. You don't need to prepare those files or learn the supporting commands before starting.

To return to the project, run `ewai` in the same folder again. It picks up the saved project state rather than starting setup from scratch. Keep your normal Git workflow for your application's code; EWAI itself is installed and updated through npm.

If npm returns `E404`, follow [installation troubleshooting](Docs/operations/installation-updating-and-entitlements.md). That's a package-acquisition failure, not a premium-persona licence error. Don't paste licence keys into npm commands or chat.

- [First session: set up a small project](Docs/tutorials/first-session.md)
- [First delivery: work through a CSV export](Docs/tutorials/first-delivery.md)
- [Already have a codebase?](Docs/existing-project-onboarding-guide.md) Archaeology can reconstruct missing documentation, but it's your choice whether to run it.
- [Installation, updates and host options](Docs/operations/installation-updating-and-entitlements.md)

## Start with a conversation

Once EWAI opens your AI tool, describe what you need. You don't need to memorise EWAI's commands:

> “Help us understand this codebase before we change it.”

> “We need an export of the filtered support-ticket list. Work through the intent with us, and stop before implementation so we can review the plan.”

> “Pick up the export feature and show us where we left it.”

The skills inspect the project's state, choose the relevant workflow and run the supporting commands. They'll ask for missing information and your decisions. **`ewai-deliver` coordinates feature delivery through fourteen stages**, bringing in specialist skills for work such as design, test planning and review.

The supporting CLI commands are available for direct control, troubleshooting and automation, but you don't need to work through them manually to use the guided workflow.

## What stays in your project?

**SPECS** means Scope, Purpose, Evidence, Constraints and Strategy. These readable project records hold the purpose, requirements, decisions and evidence the team has agreed. They remain useful outside an AI session.

The dashboard runs locally and lets you inspect work and make supported choices. Its loopback address isn't a shared team website. The AI host does the guided work; the runtime records progress and checks the conditions for moving on. [How these parts fit together](Docs/explanation/core-concepts.md).

Human judgement remains essential. A persona isn't a real stakeholder, green tests aren't human acceptance, and a delivery handoff isn't permission to deploy.

## Licence

The official EWAI npm package is free to use for personal, professional and
commercial work. You can use it to build commercial products, work for clients
and create independent integrations or extensions.

The source is published for transparency and review, but EWAI is not open
source. You may not modify, repackage, redistribute, rebrand or commercially
exploit the EWAI core without separate written permission from Backstory Group.
The licence does not restrict the project content or output you create by using
EWAI. Read the [Backstory Group Source-Available Licence](LICENSE) for the full
terms.

## Choose what you need

| When you want to… | Start here |
| --- | --- |
| Decide which work needs attention next | [Companion](Docs/context-aware-delivery-companion-user-guide.md) |
| Describe a feature and agree its boundaries | [Intent Studio](Docs/guided-intent-workspace-guide.md) |
| Understand how delivery moves through its stages | [The fourteen-stage workflow](Docs/explanation/delivery-workflow.md) |
| Investigate dependencies before a change | [Source Map](Docs/repository-source-map-guide.md) and [Blast Radius](Docs/blast-radius-and-impact-routing-guide.md) |
| Turn a meeting into reviewed project evidence | [Meeting evidence](Docs/meeting-evidence-user-guide.md) |
| Check an implemented feature with a person | [Manual QA](Docs/quality/manual-qa-and-acceptance.md) |
| Adapt the dashboard to your work | [Dashboard configuration](Docs/operations/dashboard-configuration.md) |
| Use shared organisational guidance | [Blueprints](Docs/designing-organisation-blueprint-packs.md) and [rollout](Docs/organisation-rollout-guide.md) |

Start with the parts your project needs. Portfolio, Team Hub and other advanced dashboard views are optional; hiding a view doesn't disable mandatory project checks.

## Personas

The included personas support the normal workflow. You can also create project-specific personas and use your own personal library.

Premium personas are optional specialist perspectives. If you have a subscription, [enter your key privately and install the pack](Docs/operations/premium-personas-setup.md) before the analysis you want it to support. Installing a persona doesn't give it authority to approve a requirement, bypass a check or speak for a real user.

## Go deeper

- [User guides and learning routes](Docs/README.md)
- [Complete guide catalogue](Docs/guide-catalogue.md)
- [Capabilities and project layout](Docs/reference/capabilities-and-project-layout.md)
- [Commands and configuration](Docs/reference/cli-and-configuration.md)
- [Troubleshooting and recovery](Docs/operations/troubleshooting-and-recovery.md)

## Contributing to EWAI

If you're changing the harness itself, use the [contributor guide](Docs/maintainers/contributing.md) and [verification walkthroughs](Docs/maintainers/verification-walkthroughs.md). Those source-checkout and regression-test instructions aren't part of setting up your own application.
