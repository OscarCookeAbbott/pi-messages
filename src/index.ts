import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createMessagingService, PI_MESSAGING_KEY, type MessagingService } from "./messaging.ts";

export { PI_MESSAGING_KEY } from "./messaging.ts";
export type { MessagePayload, MessagingResult, MessagingService } from "./messaging.ts";

export default function messagingExtension(pi: ExtensionAPI): void {
  const globals = globalThis as Record<symbol, unknown>;
  const shutdown = new AbortController();
  const transport = createMessagingService({
    discord: process.env.DISCORD_WEBHOOK_URL,
    slack: process.env.SLACK_WEBHOOK_URL,
  }, shutdown.signal);
  let context: ExtensionContext | undefined;

  function notify(text: string, level: "info" | "error"): void {
    try {
      context?.ui.notify(text, level);
    } catch {
      // UI availability must not change the delivery result.
    }
  }

  const service: MessagingService = {
    async send(payload, signal) {
      const result = await transport.send(payload, signal);
      if (!result.success) notify(`Messaging error: ${result.error}`, "error");
      return result;
    },
  };
  globals[PI_MESSAGING_KEY] = service;

  pi.on("session_start", (_event, ctx) => { context = ctx; });
  pi.on("session_shutdown", () => {
    shutdown.abort();
    context = undefined;
    if (globals[PI_MESSAGING_KEY] === service) delete globals[PI_MESSAGING_KEY];
  });

  pi.registerTool({
    name: "send_message",
    label: "Send Message",
    description: "Send a notification to the configured Discord or Slack webhook, or both. Both may partially succeed; retrying can duplicate messages. Sends text outside this process; do not include secrets.",
    parameters: Type.Object({
      platform: Type.Union([Type.Literal("discord"), Type.Literal("slack"), Type.Literal("both")]),
      text: Type.String({ minLength: 1, description: "The content of the message to broadcast." }),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      context = ctx;
      const result = await service.send(params, signal);
      if (result.success) notify(`Message sent to ${params.platform}`, "info");
      return {
        content: [{ type: "text", text: result.success ? `Message successfully sent to ${params.platform}.` : `Failed to send message: ${result.error}` }],
        details: result,
        isError: !result.success,
      };
    },
  });
}
