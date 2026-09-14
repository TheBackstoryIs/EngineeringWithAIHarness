# Archaeology model routing

Read this before delegating a security or trust review. Keep model selection bounded to that pass; the user may continue the main Archaeology conversation with their chosen model.

## Claude Code

For the security and trust pass, invoke the installed `ewai-security-reviewer` subagent. Its definition sets `model: opus`, read-only tools, and `permissionMode: plan`. When invoking it dynamically, keep the per-invocation model set to `opus`; do not use `inherit`. The `opus` alias intentionally resolves through Claude Code's current model configuration, so a future EWAI release can change this policy without pinning every project to a dated model identifier.

Use a defensive, read-only task description. State that the purpose is to document observable controls, gaps, risks, and test evidence in software the user is authorised to assess. Request no credential discovery, exploitation, persistence, evasion, destructive action, or access outside the agreed repository.

If Opus is unavailable or returns a provider policy refusal:

1. preserve its transcript and any completed evidence;
2. retry the bounded pass once with per-invocation model `sonnet` and the same defensive scope;
3. do not weaken safety wording, disguise the task, or repeatedly retry a refusal;
4. if Sonnet also refuses or is unavailable, mark the security-review coverage surface and manifest records `blocked`, name the project owner as the validation owner, record the provider responses, and set the next action to an authorised manual or alternative-provider defensive review.

Do not mark the security review complete based on a partial or refused pass. Continue unrelated Archaeology passes and preserve their completed results.

## Other providers

Use the strongest available model explicitly approved for defensive code review in that provider's project configuration. If no suitable model is configured, keep the security pass visible as blocked rather than silently substituting an unapproved external validator.

## Evidence

Record the provider, requested model alias or identifier, resolved model when visible, pass start and finish time, outcome, refusal or fallback reason, examined boundary, and evidence IDs. Model choice is operational evidence, not proof of review quality or security assurance.
