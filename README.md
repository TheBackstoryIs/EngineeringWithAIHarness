# Engineering With AI

Engineering With AI (EWAI) helps you plan, build and review software with an AI assistant. It gives the assistant a shared record of the project, a delivery workflow and checks against your engineering standards. You keep control of the decisions and approve implementation before it starts.

[![Intent Studio in the EWAI dashboard: describing a feature, agreeing its acceptance criteria and engaging specialist personas before any code is written](https://www.conversationalcoding.dev/wp-content/uploads/sites/5/2026/09/intent-studio-full-be7758ffd224-1536x704.webp)](https://www.conversationalcoding.dev/engineering-with-ai-harness/?utm_source=readme&utm_medium=referral&utm_campaign=ewai)

**Website, guides and books:** [conversationalcoding.dev](https://www.conversationalcoding.dev/engineering-with-ai-harness/?utm_source=readme&utm_medium=referral&utm_campaign=ewai) · [Online documentation](https://www.conversationalcoding.dev/engineering-with-ai-harness/docs/?utm_source=readme&utm_medium=referral&utm_campaign=ewai) · [Persona library](https://www.conversationalcoding.dev/personas/?utm_source=readme&utm_medium=referral&utm_campaign=ewai)

## What's new in this version

Version `0.3.4` adds optional **Jev and OpenAI Decisions** support to rank choices, compare AI recommendations, prioritise context and suggest personas or additional checks. Both start switched off. Configure them privately through the CLI or dashboard, compare advice in shadow mode or apply supported recommendations in active mode, and track usage, estimated cost and call limits.

**Concise answers and Grok Build.** EWAI puts the result or recommendation first, with clearer choices and less repetition. Grok Build is available as a coding companion, with dashboard and CLI controls for choosing your primary assistant and independent reviewers.

**Pick up the next ready piece of work.** Approve a list of work items and EWAI can select the next ready item using your recorded priorities. Set time and attempt limits, follow progress, and pause or recover a run. Build approval, required reviews, Manual QA and release decisions stay with you.

## Quick start

EWAI is free and works with Claude Code, Codex, Google Antigravity and Grok Build. You'll need Node.js 22.5 or newer and one of those assistants, installed and signed in.

```bash
npm install --global @thebackstoryis/engineering-with-ai
cd /path/to/your/project
ewai
```

`ewai` opens your assistant and walks you through setting up the project. See [Install and start](#install-and-start) for details.

To use EWAI in a project without replacing a global installation, run:

```bash
npm install --save-dev @thebackstoryis/engineering-with-ai
npx ewai
```

To install or update EWAI globally, run `npm install --global @thebackstoryis/engineering-with-ai`.

### Install and start

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

If npm returns `E404`, follow [installation troubleshooting](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/operations/installation-updating-and-entitlements.md). That's a package-acquisition failure, not a premium-persona licence error. Don't paste licence keys into npm commands or chat.

- [First session: set up a small project](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/tutorials/first-session.md)
- [First delivery: work through a CSV export](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/tutorials/first-delivery.md)
- [Already have a codebase?](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/existing-project-onboarding-guide.md) Archaeology can reconstruct missing documentation, but it's your choice whether to run it.
- [Installation, updates and host options](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/operations/installation-updating-and-entitlements.md)

## Start with a conversation

Once EWAI opens your AI tool, describe what you need. You don't need to memorise EWAI's commands:

> “Help us understand this codebase before we change it.”

> “We need an export of the filtered support-ticket list. Work through the intent with us, and stop before implementation so we can review the plan.”

> “Pick up the export feature and show us where we left it.”

The skills inspect the project's state, choose the relevant workflow and run the supporting commands. They'll ask for missing information and your decisions. **`ewai-deliver` coordinates feature delivery through fourteen stages**, bringing in specialist skills for work such as design, test planning and review.

The supporting CLI commands are available for direct control, troubleshooting and automation, but you don't need to work through them manually to use the guided workflow.

## What stays in your project?

**SPECS** means Scope, Purpose, Evidence, Constraints and Strategy. These readable project records hold the purpose, requirements, decisions and evidence the team has agreed. They remain useful outside an AI session.

The dashboard runs locally and lets you inspect work and make supported choices. Its loopback address isn't a shared team website. The AI host does the guided work; the runtime records progress and checks the conditions for moving on. [How these parts fit together](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/explanation/core-concepts.md).

Human judgement remains essential. A persona isn't a real stakeholder, green tests aren't human acceptance, and a delivery handoff isn't permission to deploy.

## Licence

The official EWAI npm package is free to use for personal, professional and
commercial work. You can use it to build commercial products, work for clients
and create independent integrations or extensions.

The source is published for transparency and review, but EWAI is not open
source. You may not modify, repackage, redistribute, rebrand or commercially
exploit the EWAI core without separate written permission from Backstory Group.
The licence does not restrict the project content or output you create by using
EWAI. Read the [Backstory Group Source-Available Licence](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/LICENSE) for the full
terms.

## Choose what you need

| When you want to… | Start here |
| --- | --- |
| Decide which work needs attention next | [Companion](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/context-aware-delivery-companion-user-guide.md) |
| Describe a feature and agree its boundaries | [Intent Studio](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/guided-intent-workspace-guide.md) |
| Understand how delivery moves through its stages | [The fourteen-stage workflow](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/explanation/delivery-workflow.md) |
| Investigate dependencies before a change | [Source Map](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/repository-source-map-guide.md) and [Blast Radius](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/blast-radius-and-impact-routing-guide.md) |
| Turn a meeting into reviewed project evidence | [Meeting evidence](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/meeting-evidence-user-guide.md) |
| Check an implemented feature with a person | [Manual QA](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/quality/manual-qa-and-acceptance.md) |
| Adapt the dashboard to your work | [Dashboard configuration](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/operations/dashboard-configuration.md) |
| Use shared organisational guidance | [Blueprints](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/designing-organisation-blueprint-packs.md) and [rollout](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/organisation-rollout-guide.md) |

Start with the parts your project needs. Portfolio, Team Hub and other advanced dashboard views are optional; hiding a view doesn't disable mandatory project checks.

## Personas

The included personas support the normal workflow. You can also create project-specific personas and use your own personal library.

Premium personas are optional specialist perspectives. If you have a subscription, [enter your key privately and install the pack](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/operations/premium-personas-setup.md) before the analysis you want it to support. Installing a persona doesn't give it authority to approve a requirement, bypass a check or speak for a real user.

## Go deeper

- [User guides and learning routes](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/README.md)
- [Complete guide catalogue](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/guide-catalogue.md)
- [Capabilities and project layout](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/reference/capabilities-and-project-layout.md)
- [Commands and configuration](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/reference/cli-and-configuration.md)
- [Troubleshooting and recovery](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/operations/troubleshooting-and-recovery.md)
- [EWAI on the web: harness overview, online docs and changelog](https://www.conversationalcoding.dev/engineering-with-ai-harness/?utm_source=readme&utm_medium=referral&utm_campaign=ewai)
- [Engineering With AI, the book behind the method](https://www.conversationalcoding.dev/books/?utm_source=readme&utm_medium=referral&utm_campaign=ewai)

## Contributing to EWAI

If you're changing the harness itself, use the [contributor guide](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/maintainers/contributing.md) and [verification walkthroughs](https://github.com/TheBackstoryIs/EngineeringWithAIHarness/blob/main/Docs/maintainers/verification-walkthroughs.md). Those source-checkout and regression-test instructions aren't part of setting up your own application.
