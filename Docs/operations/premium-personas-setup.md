# Set up and update premium personas

If you have a persona licence, you can enter it in the dashboard and install the pack straight away. You don't need to clone a repository or download files by hand.

You can also keep using EWAI's core personas without a premium licence.

## Enter your key

Start EWAI in your project and open the dashboard link it gives you. If the project hasn't been set up yet, let EWAI create the agreed SPECS structure first.

1. Open **Configuration** in the dashboard's left sidebar.
2. Under **Premium personas**, choose **Manage licence**.
3. Enter the key from your Conversational Coding account or team invitation.
4. Submit the form. EWAI verifies the licence, saves it privately on your computer and downloads the pack.
5. Wait for **Premium personas are ready**. The result includes the installed version and persona count.

Submitting the key authorises that installation. You don't need a second download step after setup succeeds. The new personas can be used in the same session.

The licence is stored in private user-level EWAI configuration, outside your project. Don't paste it into a chat, command argument or SPECS document.

**Set up premium personas** may also appear in the sidebar when premium access isn't active. Once access is valid and the installed pack is verified, the learning and setup prompts disappear. **Configuration → Manage licence** remains available.

### Prefer a terminal?

In a genuine interactive terminal, run:

```bash
ewai persona premium configure --project .
```

Type the key into the hidden prompt. This also verifies and installs immediately. Don't add the key as a command-line argument or ask an AI assistant to collect it in chat.

## Before analysing an existing codebase

If you want premium perspectives included in Archaeology, finish setup before accepting that investigation. If setup fails, retry it or deliberately continue with core personas. Installing a pack later doesn't retroactively change an analysis that's already been completed.

Archaeology itself is optional. You can decline it and return to it later.

## Get later updates

Each new session checks access and the available pack version. That check doesn't automatically download a new release.

When EWAI offers an update, approve it if you want the new version. For an explicit terminal update:

```bash
ewai persona premium sync --project . --yes
```

EWAI checks the archive and its contents before replacing the installed pack. If the verified pack is already current, it doesn't download it again.

Keep your own personas in your personal or project library, not in the managed premium cache. Updates shouldn't overwrite work you've created yourself; local edits inside the managed cache can instead block an update.

## If setup doesn't finish

| What happened | What to do |
| --- | --- |
| The key couldn't be verified | Copy it again from your account or invitation. Check your connection and retry. An unavailable service isn't proof that your key is invalid. |
| The licence was saved, but the pack wasn't installed | Retry setup when the connection is available. The saved key and the installed pack are separate: saving the key alone doesn't mean the personas are ready. |
| Installation finished, but readiness couldn't be confirmed | Don't treat that as a successful setup. Retry verification or choose to continue with core personas. |
| The service reports the three-machine limit | Review the machines in My Account and deactivate one you no longer use before retrying. |
| EWAI reports local changes in the premium cache | Preserve and inspect those changes. Don't force an update over them or delete the cache as a first response. |
| The installed pack belongs to a different seat | Review which licence and pack you intend to use. Replacement needs an explicit decision; it isn't a routine update. |

For detailed storage, replacement and validation behaviour, use the [provider reference](../persona-entitlement-provider-guide.md). Its implementation detail is separate from this setup path.

## What happens when annual access expires?

**Individual subscription:** you can keep using the installed personas. You no longer receive updates or new downloads after access expires.

**Team subscription:** when the service confirms expiry for the matching team seat, EWAI stops using that managed pack and removes it if safe to do so. If the files have been modified or safe cleanup is blocked, it preserves them for investigation but excludes the expired pack from persona selection.

Your personal and project personas aren't part of that cleanup.

A failed connection or an unverified response isn't confirmed expiry and mustn't trigger deletion. However, a team expiry already confirmed earlier remains in effect during a later outage.

This matters even when you're only checking status: a licence check can enforce confirmed team expiry. It isn't an unconditional “read-only” operation.
