# Context-Aware Delivery Companion

This reference is for integration authors and engineers changing the Companion. For choosing and continuing work, start with the [Companion user guide](context-aware-delivery-companion-user-guide.md). The sections below describe the operating contract, ranking and implementation boundaries; they aren't additional setup steps for application teams.

The Context-Aware Delivery Companion answers four practical questions from the
current governed project state:

1. What deserves attention now?
2. Why does it deserve attention?
3. Who can decide what happens next?
4. Which installed personas are actively helping to examine this context?

It is a read-only advisory layer over EWAI's existing execution contract. It does
not create delivery permission, approve Build, complete Manual QA, accept risk,
dispose of security findings, deploy or release software.

> Companion and persona guidance is advisory. It cannot create delivery
> permission, user evidence, specialist assurance or human acceptance.

> Security validation is evidence, not certification or proof that this system is
> secure. Tools can miss vulnerabilities and produce false positives. A qualified
> human must review the scope, findings, limitations and residual risk before
> release.

## The shared contract

Check-in, CLI, MCP, HTTP and the dashboard use the same
`ewai.companion-guidance/v1` projection. The projection is bounded to eight
recommendations, four actively engaged personas and 500 focus characters.

It exposes only safe delivery identity, state, phase, progress, reason,
accountable route, evidence classes, bounded blockers and an optional guarded
handoff. It does not expose raw intent bodies, SPECS roots, credentials, security
findings, disposition records, test output, model prompts or persona definitions.

The four recommendation classes are:

| Class | Meaning | Who or what moves it |
| --- | --- | --- |
| `human-decision` | Manual QA or another explicit human authority gate is next. | The named accountable reviewer or project owner. |
| `continue` | The current governed harness can move forward. | The existing EWAI delivery harness after it rechecks permission. |
| `start` | A prepared intent can enter governed delivery. | The existing EWAI delivery harness after it rechecks permission. |
| `blocked` | No governed start or continue route is available. | The named delivery owner resolves the first evidenced blocker. |

The class is derived from `execution.actions`, not from a board lane on its own.
Human decisions outrank continuation, continuation outranks starts, and blocked
work remains visible without being presented as executable.

## Use the dashboard

Open the project-local dashboard and choose **Companion**. The decision runway
shows the current ranked recommendations. Select a card to replace the selected
context, active personas and review questions with a fresh server-owned snapshot.

The right-hand context panel shows:

- the observed phase and progress;
- why the item is ranked there;
- the accountable route;
- bounded blockers and evidence classes;
- whether a guarded begin or continue handoff exists;
- the personas actively engaged for this focus;
- questions for the accountable person.

At 960px the context panel moves below the runway. At 600px the card metadata and
facts stack. Recommendation class and permission remain visible in text, so colour
is never the only status signal.

### Apply focus

Focus is optional and can be an intent identity, decision or delivery concern. It
is deliberately submitted, limited to 500 characters and returned in the safe
contract. Applying or clearing focus replaces the active ensemble and questions;
the dashboard does not accumulate perspectives from previous selections.

Selecting a recommendation applies its safe identity as focus. This gives the
server another opportunity to rank the item and select relevant personas rather
than allowing the browser to pretend an old ensemble is still engaged.

### Use a handoff

A begin or continue button appears only when the current projection identifies the
corresponding governed handoff. Clicking it opens the existing dashboard handoff
dialog. Submission calls the established work-item handoff route, which rechecks
the current execution action before recording the selection.

The handoff does not begin code or change a phase. Return to the EWAI conversation
and use the canonical delivery skill to claim and process it. Human-decision and
blocked recommendations have no direct execution button.

## Use CLI, MCP and HTTP

Read the same projection from the CLI:

```bash
ewai companion status --project . --json
ewai companion status --focus "Manual QA ownership" --project . --json
```

Agent integrations use the read-only MCP tool:

```text
ewai_companion_status
```

Its optional `focus` argument has the same 500-character limit. The tool exposes no
companion write, approval, Build or release operation.

The project-local loopback dashboard reads:

```http
GET /api/companion
GET /api/companion?focus=Manual%20QA%20ownership
```

The server owns the project root. Unknown query parameters, oversized focus and
unsafe control characters are rejected. POST is not supported.

## Check-in spotlight

`ewai checkin --json` retains the mandatory numbered Companion opening and adds a
bounded `companion.spotlight`, `companion.activePersonas` and the invariant notices.
Render the status first, then the returned heading and every `[id] label`. When a
spotlight exists, identify it as advisory, name its accountable route and show the
active persona names and tiers. End with the exact returned closing prompt.

The spotlight is advisory context, not a replacement for the returned actions.
**[6] Continue a piece of work** appears when work exists. **[7] Read about premium
personas** and **[8] Set up premium personas** appear only when premium access
isn't active. **[9] Configure the dashboard** remains available. Configuration also
provides licence management when the setup prompts are hidden.

## Persona behaviour

The Standard host-model baseline plus installed project and core personas is a
complete operating baseline. Relevant installed personal and premium personas can
add specialist depth. Their installed tier, matched signals and engagement reason
are visible whenever they are actively selected.

Companion reads never install, update, synchronise or imitate premium content. If
no premium library is installed, the response says so and continues normally. Use
the separately consented premium sync process only when the user explicitly asks
for it.

Personas are lenses. They may frame questions, expose blind spots and improve the
quality of a discussion. They are not stakeholder research, validation evidence,
legal approval, security certification, user acceptance or accountable human
judgement.

## Implementation guide

Integrations should depend on the public projection rather than reclassifying work
items independently:

1. Resolve the project through the existing EWAI locator.
2. Load current work through the governed `listWorkItems` projection.
3. Derive recommendation classes from permitted execution actions.
4. Rank deterministically and apply bounded focus.
5. Select active personas from installed project, core, personal and premium
   metadata only.
6. Return only the `ewai.companion-guidance/v1` allowlist.
7. Delegate begin and continue to the existing guarded handoff route.
8. Keep approval, Manual QA, security disposition, deployment and release outside
   the Companion.

Do not add browser model calls or model credentials. The host model interprets the
bounded snapshot in conversation. The dashboard presents deterministic evidence,
persona provenance and review questions without becoming a chat client.

## Failure and recovery

- **Empty:** show that no governed work is available; do not invent a next action.
- **Projection failure:** show the contract error; do not infer a healthy state.
- **Malformed or altered notices:** fail visibly because the authority boundary is
  part of the public contract.
- **Handoff rejected:** refresh guidance because the current execution permission
  has changed.
- **No persona match:** retain the complete Standard host-model baseline and state
  that no specialist persona matched.
- **No premium library:** continue without premium content; do not sync it.

## Human acceptance checklist

Before accepting an implementation, manually confirm:

- ranking and class text match the current governed execution state;
- selecting a card replaces context, personas and questions;
- focus apply and clear work at desktop and 390px widths;
- active persona names, tiers, signals and reasons are visible;
- a handoff appears only for a currently permitted begin or continue route;
- human-decision and blocked contexts cannot directly execute work;
- both authority notices are always visible;
- keyboard focus and screen-reader labels are meaningful;
- no raw SPECS content, root, credential, finding or proprietary persona body is
  exposed.

Automated checks and this checklist prepare evidence. A named human still records
Manual QA through the governed EWAI delivery gate.
