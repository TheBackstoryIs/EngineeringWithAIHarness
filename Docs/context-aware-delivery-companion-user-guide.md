# Context-Aware Delivery Companion user guide

The Companion helps you understand what needs attention across an EWAI project,
why it matters and who should act next. It gives you a ranked list of work so you
can choose what to tackle without reading every delivery record.

You do not need to use the command line or understand the technical delivery
stages to use the Companion.

> Companion and persona guidance is advisory. It cannot create delivery
> permission, user evidence, specialist assurance or human acceptance.

> Security validation is evidence, not certification or proof that this system is
> secure. Tools can miss vulnerabilities and produce false positives. A qualified
> human must review the scope, findings, limitations and residual risk before
> release.

## Open the Companion

Open your project’s EWAI dashboard and select **Companion** from the navigation.
Your EWAI check-in gives you the dashboard address when the project is ready.

The screen has two main areas:

- **Decision runway:** ranked cards showing the work that deserves attention.
- **Selected context:** an explanation of the selected card, its evidence, who can
  decide what happens next, the actively engaged personas and useful questions.

The first card is the strongest current recommendation. Ranking is based on the
project’s governed delivery state, not on an AI guess about what is urgent.

## Understand the four recommendation types

Every recommendation is labelled in words. Colour is supporting information only.

### Human decision

A named person must make or record a decision. This commonly appears when Build
approval or Manual QA is next.

Read who needs to decide and the questions in the context panel. The Companion
does not approve the decision for you and does not provide a shortcut around the
human gate.

### Continue

Work has already started and may be ready for its next step. EWAI still checks
the required evidence and approvals before continuing.

If a hand-off button is available, you can use it to select the work for your EWAI
conversation. The delivery process checks permission again before anything moves.

### Start

An intent is prepared to enter the governed delivery process.

A start hand-off selects it for your EWAI conversation. It does not start coding,
approve Build or change the delivery phase by itself.

### Blocked

The work cannot currently start or continue. The card explains the first evidenced
blockers and identifies the route for resolving them.

Do not treat a fluent AI explanation as permission to proceed. Resolve the named
blocker, refresh the Companion and confirm that the governed action has changed.

## Select work and use focus

Select a recommendation card to make it the active context. The Companion refreshes
the explanation, questions and personas for that item.

Use **Focus** when you want to examine a particular concern, for example:

- “Who owns Manual QA?”
- “What is blocking the supplier import?”
- “Which work affects the product onboarding journey?”
- “What needs a security review before release?”

Apply one clear concern at a time. Clear the focus to return to the project-wide
ranking.

Changing focus replaces the previous context. If a person or persona is no longer
relevant, it should disappear rather than remain as part of a permanent committee.

## Understand actively engaged personas

The context panel shows the actively engaged personas for the selected work. Each
entry explains:

- the persona’s name;
- its tier, such as project, core, personal or premium;
- the signals that made it relevant; and
- why its perspective is being applied now.

Personas help frame questions and expose blind spots. They are not real stakeholder
evidence, approval or acceptance.

The standard AI model and installed project/core personas provide the complete
baseline. If relevant premium or personal personas are already installed, they can
add specialist depth. Premium personas are optional: opening or focusing the
Companion never downloads, installs or synchronises them.

## Use a hand-off

Selecting work prepares a request for your AI host; it doesn't itself implement the feature or complete a phase. Once the host accepts that handoff, continue the conversation there. You can inspect the saved work in the dashboard while the host performs the permitted task.

A **Begin** or **Continue** hand-off appears only when the current project state
permits that route.

When you select it:

1. EWAI checks the current permission again.
2. The dashboard records which work you selected.
3. You return to the EWAI conversation.
4. The conversation identifies the hand-off and asks you to confirm proceeding.
5. The guarded delivery process handles the next valid stage.

If the project state changed after the card was displayed, the hand-off may be
refused. Refresh the Companion and review the new blocker or accountable route.

A hand-off does not approve Build, complete Manual QA, accept risk, dispose of a
security finding, deploy software or release it.

## Questions you still need to answer

The Companion can organise evidence and suggest questions, but people remain
responsible for decisions such as:

- whether the intended outcome is correct;
- whether the evidence is sufficient;
- whether affected users or teams have been consulted;
- whether a risk is acceptable and who owns it;
- whether Manual QA has genuinely passed; and
- whether the work is ready to deploy or release.

When the evidence is incomplete, the correct result is an explicit question or
blocker, not a confident recommendation.

## Common situations

### No recommendations are shown

The project may have no governed work available, or the current projection may be
unavailable. Refresh once. If the empty state remains, use the normal EWAI check-in
to inspect or capture work. Do not infer that an empty screen means everything is
complete.

### The recommendation looks out of date

Refresh the Companion. If the state still disagrees with the known project
evidence, stop and ask the delivery owner to reconcile the durable intent,
delivery state and project evidence.

### The personas do not fit the selected concern

Use a more specific focus and refresh. Personas are selected from what is actually
installed. A missing specialist perspective should be shown as a gap rather than
imitated.

### A hand-off disappeared or was refused

Permission changed between display and selection. Read the refreshed blockers and
follow the accountable route. The refusal protects the governed process.

### Premium personas are unavailable

Continue normally. Premium content is optional and its absence does not make the
Companion incomplete.

## Before acting on a recommendation

Check that you can answer yes to each relevant statement:

- I understand why this item is ranked here.
- I can distinguish observed evidence from advisory interpretation.
- I know who owns the next decision or action.
- The actively engaged personas fit this context.
- Any blocker is explicit rather than hidden in a positive summary.
- I am using only a currently advertised hand-off.
- I am not treating Companion output as approval, assurance or release authority.

For technical integration, configuration and acceptance details, use the
[Context-Aware Delivery Companion operating and implementation guide](context-aware-delivery-companion-guide.md).
