---
name: ewai-persona-entitlement
description: Configure website-purchased EWAI persona licences, inspect entitlement and verified local pack state, explain annual individual/team expiry, and explicitly install or update premium personas.
---

# EWAI Persona Entitlement

Premium personas are optional advisory lenses, not approval authority. Keep remote access, local installation, verification and active persona selection separate.

## Check each session

When EWAI is configured, run `ewai checkin --project . --json` at the start of every session, unless the managed SessionStart hook has already supplied that launch's result. Dashboard launch checks entitlement too, including reuse of an existing server. A new session needs a fresh check; an old status is not current access evidence.

Report safe access, pack state, version/update offer and expiry message. Unknown is neither entitlement nor confirmed expiry. Core EWAI stays available. Never implicitly or automatically download or sync premium content during check-in, dashboard launch, delivery or persona selection.

## Set up a website licence privately

If no key is configured, ask: **“Do you have a premium persona licence, or shall we use the core personas?”** Respect a decline. Reading opens https://www.conversationalcoding.dev/personas/ without buying, activating or downloading. Do not ask this missing-key question for an expired, invalid or unavailable configured licence.

Only when setup is chosen, explain where to find the key: Conversational Coding My Account, after purchase or seat allocation. Use the guarded loopback dashboard password form by default. A hidden private terminal prompt is an alternative only when a genuine interactive terminal is available; don't ask a tool runner to emulate hidden input or make the user paste it in chat. Submission verifies and installs the pack immediately; this is consent for that download, not future updates:

```bash
ewai persona premium configure --project . --machine-name "Work laptop"
ewai persona premium status --project . --json
```

The configure command asks for the licence key without echoing it, verifies then downloads and installs using the core ZIP verifier. Report its safe ready/version/count result; if activation or installation fails, explain the failure without claiming readiness. Do not collect the key in chat, shell arguments/history, SPECS or screenshots. Dashboard entry is transient and goes only to the guarded loopback route; it never enters storage or responses. Invalid keys and the machine limit keep previous credentials on failed verification. Refresh the persona index after success. Before Archaeology settle chosen setup or explicitly continue core-only after decline/failure.

Credentials live in private user-level EWAI config, not project YAML. A random private installation secret is shared through the documented Conversational Coding installation contract; the machine name is only a readable label. Website licence delivery is the only premium persona route. Missing keys offer private setup or continuing with core/personal/project personas. Never acquire personas from source control or use it after a failed licence check.

## Download only with explicit consent

Keep setup replies brief: installed version/count on success, or a safe cause and next action on failure. A setup 404 means the dashboard endpoint is missing, not that the key is invalid: restart EWAI, open its current dashboard link and retry there. Connection failures may leave completion uncertain; check status before retrying. Don't echo raw server messages or claim an unverified download is ready.

Offer install, update or replacement, then obtain explicit human consent for that action:

```bash
ewai persona premium sync --project . --yes
```

A pack owned by another seat/provider additionally requires explained replacement and `--replace`. The flag is immediate command confirmation, not permission for future downloads. Do not override local changes.

The website provider obtains a short-lived grant and immutable archive. Core EWAI bounds and verifies archive bytes, rejects unsafe ZIP entries, independently validates pack.yaml and content, stages privately, atomically promotes, writes an external provenance receipt, and rolls back on failure. No provider may self-assert trust or bypass these checks.

## Annual expiry and safe cleanup

- An authenticated **expired team** status removes only the managed premium cache whose receipt matches that server, subscription, seat and team plan. This is the narrowly authorised automatic cleanup exception; it never downloads content.
- An **expired individual** subscription keeps installed personas and tells the user that updates have ended. Do not attempt a new download.
- Cancellation does not mean expiry: access remains until the paid term ends.
- Invalid activation, arbitrary 403, timeout, outage, malformed/older contract or unrelated seat is not deletion authority.
- User-created personal/project personas are outside the managed cache and must never be touched.
- Unsafe paths, local drift, mismatched ownership, concurrent mutation or failed cleanup need investigation; never describe blocked cleanup as successful.

Installed does not automatically engage personas, and verified local content does not prove current entitlement. Report unverified states honestly.

## Boundaries

Use only safe status: no licence key, installation secret, bearer token, download grant, email, absolute cache path, raw server error or premium body. This skill cannot approve Build or Manual QA, accept risk or licence terms, deploy, publish, release, certify persona quality, or grant human authority.

Read [the provider guide](../../Docs/persona-entitlement-provider-guide.md) when implementing or diagnosing trust, storage or expiry contracts. Live purchased-key acceptance is separate from synthetic tests.
