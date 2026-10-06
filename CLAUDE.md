## Public GitHub communication

This GitHub repository is public. Treat all commit messages and comments, PR titles and descriptions, review comments, issues, tags and release notes as externally visible, including on development branches.

Before committing, pushing or posting, keep the wording factual and suitable for external readers. Share only the product change, relevant rationale and verified checks. Exclude credentials, personal or customer information, private commercial details, internal conversations, local paths, private URLs and unsanitised prompts or diagnostics. Apply particular care to release notes and npm publication metadata.

<!-- EWAI-CHECKIN:START -->
## EWAI conversation check-in

### Concise, useful output

Prioritise correctness, fidelity and usefulness, then brevity. Resist verbosity: remove repetition, filler, restated requests and routine tool narration. Lead with the result or recommendation, using plain language and enough action detail to make it usable.

Preserve exact commands and identifiers, prerequisites, meaningful step order, failure evidence, uncertainty and human authority. Report only verification actually performed. Follow mandatory check-in, status, consent and phase protocols. Expand when a shorter answer would hide a consequential fact or when detail is requested; do not impose arbitrary word limits.

For a decision ask, include what needs deciding, relevant action details and consequences, supporting guidance, material options and tradeoffs, a recommendation with its reason, and a clear ask. Provide a suggested response when it helps the person act. If evidence is insufficient, recommend the next evidence-gathering step. Recommendations, defaults and suggested replies never constitute approval.

### Query refinement

Lead with the recommended interpretation or refined request, explaining consequential assumptions. Ask one focused question only when missing information materially changes the scope, outcome or next action; include supporting guidance and a recommended response with its reason. Keep uncertainty visible, preserve the user's intent and continue independent authorised work. After clarification, confirm the refined request briefly and act within its authority boundaries.

### Check-in and workflow

Keep the complete workflow, but present it cleanly: four routine status lines plus the returned menu at a decision point. Preserve warnings, blockers and unknown checks with short reasons; detailed diagnostics are on request. Progress is one sentence of at most 24 words per meaningful checkpoint. Do not narrate commands, file reads, JSON parsing or internal reasoning, and do not repeat the menu during a selected action. Never shorten briefing, purpose alignment, consent, standards or approval gates to meet an output limit. Use the guarded dashboard password form by default for licence setup; a private terminal prompt is an alternative only when a genuine interactive terminal is available. Never emulate hidden terminal entry through chat.

When `.ewai-pipeline/project.json` exists, perform one EWAI check-in at the start of each new agent conversation before substantive project work. That locator identifies the configured SPECS root; do not assume it is `./SPECS`. Claude may receive its check-in JSON from the managed SessionStart hook; interpret that result instead of running it twice. Otherwise run `ewai checkin --project . --json`. This starts or reuses the project-local pipeline dashboard and refreshes its SQLite projection. Always interpret and report the EWAI version/update status, premium entitlement and installed-library status, dashboard URL, state-integrity result, mandatory standards status, configured external validators, and any configured-versus-installed CLI mismatch. Show unknown checks with their reason rather than omitting them.

The harness is installed and updated only through npm. Offer only its returned npm update action; never inspect, fetch, or pull a source repository to update EWAI.

For returning sessions, or after onboarding is complete or explicitly deferred by the owner, read recent work and render the structured `companion` opening returned by EWAI. **This response format is mandatory at that decision point.** A narrative-only session opening is invalid. Report the check-in status first, then render the returned heading and every returned action in order as `[id] label`. Do not replace the numbered menu with prose, recommendations, or a generic question. End with the exact returned closing prompt: **What's on your mind?** Do not finish that session opening until both the status and menu are visible. During first-run onboarding, continue the known startup path instead: settle chosen persona setup, human briefing and optional context import, then offer Archaeology for existing code, followed by Discovery and Doctor. Archaeology is optional: always offer it for existing code, explain that it can reconstruct missing documentation, and wait for acceptance before running it. Review and curate its findings only if accepted; if declined, continue to Discovery without reconstruction and leave Archaeology available later. Show the dashboard link early, but do not interrupt onboarding with the session menu or call the project ready before the chosen steps finish. Only the owner can defer onboarding.

When intent or delivery work exists, the menu must include **[6] Continue a piece of work**. If the user chooses it, use `$ewai-deliver` and the guarded EWAI continue/resume operations. Do not use the host AI's generic plan mode as a substitute for EWAI Plan.

Include **[7] Read about premium personas** and **[8] Set up premium personas** only when returned by check-in. Both are absent when premium access is available and the installed pack is verified. Learning opens https://www.conversationalcoding.dev/personas/ without purchasing, activating or downloading content. When `companion.personaSetup` is present, ask its exact optional question after the menu and before the closing prompt. Offer dashboard setup, reading first, or continuing with core personas; respect a decline. Use `$ewai-persona-entitlement` only when setup is chosen, and never ask for a key in chat. Do not substitute this setup question for an expired, invalid or unavailable configured licence.

For chosen premium setup, use the guarded dashboard setup form by default, or a hidden private terminal only when a genuine interactive terminal is available. Explain that key submission verifies and immediately installs the pack; no second sync confirmation is needed for that submitted action. Confirm the installed version, refresh the persona index and resolve chosen setup before Archaeology. On failure offer retry or explicit core-only continuation; preserve briefing and purpose alignment. Normal check-in and learning never download. Licence management remains reachable in dashboard Configuration even when promotional actions are hidden.

Always render the returned **[9] Configure the dashboard** action. Use `$ewai-dashboard-configuration` to explain and save explicit project-local view choices. Optional views are off by default. Hiding a view never disables required checks, hooks, policies, standards or approvals.

Immediately after successful first initialisation, offer the returned `onboarding.personaLearning` question before deeper analysis or Archaeology, for both new and existing code. Respect a decline and preserve the human briefing and purpose-alignment checkpoints. Do not repeat first-run onboarding in subsequent sessions; follow the returned action list.

Any request to plan, build, implement, deliver, resume, or move an intent forward must use `$ewai-deliver`. Before substantive repository claims, check the EWAI Tree-sitter index and refresh it when missing or stale. Never mutate a raw phase/status: phase progress must go through the canonical gate ledger, deterministic checker, and guarded start/complete operations. Build requires the explicit durable human approval gate.

External validation must follow the resolved checkpoint policy captured under the configured SPECS root at `6.Build/<slug>/delivery-state.json`: never use the orchestrator as its own independent reviewer, never exceed the configured cycle limit, and preserve each review and fix cycle as recorded evidence. The standards sweep remains mandatory even when no independent external CLI is configured.

When delivering an intent, use the EWAI MCP active-work tools to register the start, material progress events, human questions, blockers, handoffs, decisions, and finish. Do not emit heartbeat events with no material change.

Never download or update premium personas during the check-in. If the result offers an install or update, ask the user first. Only after an explicit yes, run `ewai persona premium sync --project . --yes`. Every session must check persona entitlement/version, even when the dashboard is reused. Website-purchased keys use the guarded dashboard password form by default; `ewai persona premium configure --project .` is an alternative only when a genuine private interactive terminal is available; never ask for a key in chat or write it into project YAML/SPECS. A confirmed matching team expiry removes only its managed premium cache; individual expiry keeps installed personas and stops updates. Unknown/invalid responses never delete content.
<!-- EWAI-CHECKIN:END -->
