# Contributing to EWAI

This page is for engineers changing **the EWAI harness itself**. If you're using it in an application, start with [the installation guide](../operations/installation-updating-and-entitlements.md) instead.

## Work from a source checkout

Use Node.js 22.5 or newer. In your EWAI source checkout, install the locked dependencies and inspect the CLI:

```bash
npm ci
node bin/ewai --help
npm run check
```

Read the repository instructions and inspect your branch and uncommitted changes before editing. Keep test projects disposable and separate from active customer work. Don't install local changes over a global release as an incidental verification step.

## Development commands

```bash
npm run build
npm run check
npm test
npm run lint
npm run typecheck
```

`npm run build` validates the portable source. Tests cover project discovery, initialisation, non-overwrite behaviour, global and project skill installation, pack and persona discovery, persona-grounded intent creation, SQLite projection, dashboard lifecycle, HTTP serving, and MCP stdio integration.

## Repository layout

```text
bin/            EWAI CLI entry point
config/         Schemas and delivery configuration
packs/          Core, technology, stack, and persona packs
scripts/        Setup and deterministic build utilities
skills-src/     Portable agent skill sources
agents-src/     Host-specific specialist agent definitions
src/            CLI and runtime source
templates/      Project output templates
tests/          Automated tests
```

The harness's own `SPECS/` workspace is local and excluded from Git. It isn't included in a source checkout or the npm package. Public guides live in `Docs/`; reusable project-output files live in `templates/`. EWAI still creates and uses SPECS when you initialise a project.


## Verify the change

Follow [maintainer verification walkthroughs](verification-walkthroughs.md) for the relevant fixtures. A passing unit test, a successful package build and an observed user journey are different kinds of evidence. Record which you actually ran; don't infer a successful installation or human acceptance from a static check.

## Write documentation for the reader

Public operating guides address people using EWAI, including engineers who haven't seen this repository before. Instructions to the host AI belong in `skills-src/` or an explicitly labelled integration reference, not in a user walkthrough.

For a guided task, explain the ordinary conversation or dashboard route before optional commands and schemas. Make clear what the reader supplies or chooses, what EWAI prepares, what they review or approve, and where the result is saved. Include meaningful failure and recovery guidance. Don't require users to perform host duties such as displaying persona metadata or presenting findings “to the owner”.

Keep tutorials, task guides, explanation and technical reference distinct. Preserve exact commands, capabilities, consent and approval boundaries in the appropriate place; don't simplify by removing them. Use natural wording and contractions where they fit, without marketing claims.

Before accepting a documentation change, read the whole changed guide as its intended user and check related pages for conflicting advice. Run `node --test tests/documentation-reader-journeys.test.mjs` for examples, navigation and known audience-regression checks. Those checks supplement editorial review; they can't prove that every sentence is clear or that a real user completed the workflow.
