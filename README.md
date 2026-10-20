# pi-messages

Discord and Slack webhook notifications for [Pi](https://pi.dev). One `send_message` tool and one shared service for other extensions. Pi supplies its SDK, TUI and schema library; transport uses Node's native `fetch`, with no extra transport dependencies.

## Install

Requires Node 22.19 or newer and Pi.

```sh
pi install git:github.com/OscarCookeAbbott/pi-messages
# Or try it for one session:
pi -e git:github.com/OscarCookeAbbott/pi-messages
```

For local development, run `pi -e ./pi-messages/src/index.ts` from the parent directory.

Export either or both webhook URLs before starting Pi:

```sh
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

Each webhook selects its destination channel. URLs are read when the extension loads; reload Pi after changing them. This package does not load `.env` files: export values yourself or use your existing environment loader. Treat webhook URLs as secrets; never commit them.

## Agent tool

Ask Pi to send a notification, or call `send_message` with:

```json
{ "platform": "both", "text": "Build completed successfully." }
```

`platform` is `discord`, `slack`, or `both`. Text must be nonblank. Messages use each service's native text formatting and size limits (Discord content is limited to 2,000 characters); oversized messages are not split or truncated. Sending publishes content outside the Pi process: do not include secrets or private session contents without authorisation.

The tool returns a compact acknowledgement plus `{ success: boolean, error?: string }` in `details`, with `isError: true` on failure. The TUI shows the destination, a five-visual-line message preview and a bold blue acknowledgement; expand for the full message. Tool results do not also emit duplicate UI toasts. Shared-API failures still notify the current UI on a best-effort basis; headless callers need no UI.

## Shared extension API

The package was renamed from `pi-messaging` to `pi-messages`; the `send_message` tool, `PI_MESSAGING_KEY` export and `pi.messaging` symbol remain unchanged for compatibility.

The service is published synchronously at `globalThis[Symbol.for("pi.messaging")]`. Resolve it when needed, rather than caching it across reloads. No package import is required:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface MessagingService {
  send(payload: {
    platform: "discord" | "slack" | "both";
    text: string;
  }, signal?: AbortSignal): Promise<{ success: boolean; error?: string }>;
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_settled", async (_event, ctx) => {
    const messaging = (globalThis as Record<symbol, unknown>)[
      Symbol.for("pi.messaging")
    ] as MessagingService | undefined;
    if (!messaging) {
      ctx.ui.notify("Messaging extension not loaded; skipping notification.", "warning");
      return;
    }
    const result = await messaging.send({
      platform: "both",
      text: `Pi completed tasks in directory: ${ctx.cwd}`,
    });
    if (!result.success) {
      // Implement a fallback if needed. pi-messages also notifies the current UI.
    }
  });
}
```

The symbol and TypeScript contracts are also exported from `src/index.ts` and `src/messaging.ts` for consumers that can resolve this package's source.

## Reliability

- Both targets are attempted concurrently; one failure does not prevent the other send.
- Each HTTP request has a five-second timeout. Tool cancellation and session shutdown abort pending requests.
- Missing configuration, HTTP errors (including rate limits), network errors, cancellation and invalid API inputs return structured failures rather than throwing.
- No automatic retries: a failed or timed-out request may already have delivered. With `both`, failure can mean partial success; retrying may duplicate messages.
- HTTP redirects are rejected. Errors include platform and HTTP status, never webhook URLs, raw network errors or response bodies.
- Shutdown removes only this instance's singleton. Stale references return failures instead of sending.

This is outbound-only webhook messaging: no bot tokens, inbound commands, sockets, background queues or heavy Slack/Discord SDKs.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

Tests mock webhook HTTP boundaries and load the package through Pi's resource loader. No live webhook credentials are needed.
