import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import extension, { PI_MESSAGING_KEY, type MessagingResult, type MessagingService } from "../src/index.ts";

const globals = globalThis as Record<symbol, unknown>;

function harness(t: TestContext) {
  const previous = globals[PI_MESSAGING_KEY];
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/private";
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  let tool!: ToolDefinition<TSchema, MessagingResult>;
  const notifications: Array<{ text: string; level: string }> = [];
  const ctx = { ui: { notify: (text: string, level: string) => notifications.push({ text, level }) } } as unknown as ExtensionContext;
  extension({
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => void) => handlers.set(name, handler),
    registerTool: (definition: typeof tool) => { tool = definition; },
  } as unknown as ExtensionAPI);
  const service = globals[PI_MESSAGING_KEY] as MessagingService;
  const emit = (name: string) => handlers.get(name)?.({}, ctx);
  t.after(() => {
    emit("session_shutdown");
    if (slackUrl === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = slackUrl;
    if (previous === undefined) delete globals[PI_MESSAGING_KEY];
    else globals[PI_MESSAGING_KEY] = previous;
  });
  return {
    tool, service, ctx, notifications, emit,
    async call(params: JsonObject) {
      const validated = validateToolArguments(tool, { type: "toolCall", id: "call", name: tool.name, arguments: params });
      return tool.execute("call", validated, undefined, undefined, ctx as never);
    },
  };
}

test("registers a validated tool with compact results and no duplicate success toast", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  const h = harness(t);
  assert.equal(h.tool.name, "send_message");
  assert.equal(PI_MESSAGING_KEY, Symbol.for("pi.messaging"));
  assert.equal(h.tool.annotations?.idempotentHint, false);
  await assert.rejects(h.call({ platform: "unknown", text: "hi" }), /validation/i);
  await assert.rejects(h.call({ platform: "slack", text: "" }), /validation/i);
  const result = await h.call({ platform: "slack", text: "hello" });
  assert.deepEqual(result.details, { success: true });
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [{ type: "text", text: "Sent to Slack." }]);
  assert.deepEqual(h.notifications, []);
  h.emit("session_shutdown");
  h.emit("session_shutdown");
  assert.equal(globals[PI_MESSAGING_KEY], undefined);
});

test("tool errors render once while shared API errors still notify without throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("secret URL"); });
  const h = harness(t);
  h.emit("session_start");
  const result = await h.call({ platform: "slack", text: "hello" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { success: false, error: "Slack webhook request failed." });
  assert.deepEqual(await h.service.send({ platform: "slack", text: "hello" }), result.details);
  assert.deepEqual(h.notifications, [{ text: "Messaging error: Slack webhook request failed.", level: "error" }]);
  t.mock.method(h.ctx.ui, "notify", () => { throw new Error("UI unavailable"); });
  assert.equal((await h.service.send({ platform: "slack", text: "hi" })).success, false);
});

test("message renderers separate bounded user previews from compact agent feedback", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  const h = harness(t);
  const text = "FIRST\n" + "middle\n".repeat(20) + "LAST";
  const result = await h.call({ platform: "slack", text });
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  assert.equal(typeof h.tool.renderCall, "function");
  assert.equal(typeof h.tool.renderResult, "function");
  const header = (h.tool.renderCall! as Function)({ platform: "slack", text }, theme, {}).render(80).join("\n");
  assert.match(header, /Slack/);
  assert.doesNotMatch(header, /FIRST|LAST/);
  const render = h.tool.renderResult! as Function;
  const context = { args: { platform: "slack", text } };
  const collapsed = render(result, { expanded: false }, theme, context).render(80).join("\n");
  assert.match(collapsed, /FIRST/);
  assert.match(collapsed, /expand/);
  assert.doesNotMatch(collapsed, /LAST/);
  assert.match(collapsed, /\x1b\[1m\x1b\[38;2;96;165;250mMessage sent\./);
  assert.match(render(result, { expanded: true }, theme, context).render(80).join("\n"), /LAST/);
  assert.deepEqual(result.content, [{ type: "text", text: "Sent to Slack." }]);
  assert.deepEqual(h.notifications, []);
  assert.match(render(result, { expanded: false }, theme, {}).render(80).join("\n"), /sent/i);
  const failure = { content: [{ type: "text", text: "Delivery failed." }], details: {} };
  assert.match(render(failure, { expanded: false }, theme, { isError: true }).render(80).join("\n"), /Delivery failed/);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 500 }));
  const failed = await h.call({ platform: "both", text: "hello" });
  assert.equal(failed.isError, true);
  const failedOutput = render(failed, { expanded: false }, theme, { isError: true }).render(200).join("\n");
  assert.match(failedOutput, /Other destinations may have received the message; do not retry both/);
  assert.doesNotMatch(failedOutput, /\x1b\[38;2;96;165;250m|Message sent\./);
  assert.deepEqual(h.notifications, []);
});

test("shutdown cleanup is idempotent and cannot remove a newer singleton", (t) => {
  const first = harness(t);
  const replacement = { ...first.service };
  globals[PI_MESSAGING_KEY] = replacement;
  first.emit("session_shutdown");
  first.emit("session_shutdown");
  assert.equal(globals[PI_MESSAGING_KEY], replacement);
});
