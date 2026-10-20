import { stripVTControlCharacters } from "node:util";
import { keyText, truncateToVisualLines, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createMessagingService, PI_MESSAGING_KEY, type MessagingService } from "./messaging.ts";

export { PI_MESSAGING_KEY } from "./messaging.ts";
export type { MessagePayload, MessagingResult, MessagingService } from "./messaging.ts";

const highlight = (text: string): string => `\x1b[1m\x1b[38;2;96;165;250m${text}\x1b[39m\x1b[22m`;
function platformLabel(platform: unknown): string {
  if (platform === "both") return "Discord + Slack";
  if (platform === "discord") return "Discord";
  return platform === "slack" ? "Slack" : "...";
}
const plainText = (text: string): string => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");

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
      const result = await transport.send(params, signal);
      const failureHint = params.platform === "both" ? " Other destinations may have received the message; do not retry both." : "";
      return {
        content: [{ type: "text", text: result.success ? `Sent to ${platformLabel(params.platform)}.` : `Failed to send message: ${result.error}${failureHint}` }],
        details: result,
        isError: !result.success,
      };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("send_message")) + theme.fg("accent", ` ${platformLabel(args.platform)}`), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const text = plainText(result.content.flatMap((item) => item.type === "text" ? [item.text] : []).join("\n"));
      const details = result.details as { success?: boolean } | undefined;
      if (context?.isError || details?.success !== true || isPartial) return new Text(theme.fg(context?.isError || details?.success === false ? "error" : "toolOutput", text), 0, 0);
      const component = new Container();
      const message = typeof context?.args?.text === "string" ? theme.fg("toolOutput", plainText(context.args.text)) : undefined;
      if (message) {
        if (expanded) component.addChild(new Text(message, 0, 0));
        else component.addChild({
          render(width) {
            if (width < 1) return [];
            const preview = truncateToVisualLines(message, 5, width, 0, "start");
            const key = keyText("app.tools.expand");
            const expandHint = key ? `${key} to expand` : "expand for full message";
            return [...preview.visualLines, ...(preview.skippedCount ? [truncateToWidth(theme.fg("muted", `… ${preview.skippedCount} more lines; ${expandHint}`), width)] : [])];
          },
          invalidate() {},
        });
      }
      component.addChild(new Text(highlight("Message sent."), 0, 0));
      return component;
    },
  });
}
