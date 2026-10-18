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

test("registers a validated tool that returns Pi results and notifies on success", async (t) => {
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
  assert.deepEqual(result.content, [{ type: "text", text: "Message successfully sent to slack." }]);
  assert.deepEqual(h.notifications, [{ text: "Message sent to slack", level: "info" }]);
  h.emit("session_shutdown");
  h.emit("session_shutdown");
  assert.equal(globals[PI_MESSAGING_KEY], undefined);
});

test("tool and shared API errors are structured and notify without throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("secret URL"); });
  const h = harness(t);
  h.emit("session_start");
  const result = await h.call({ platform: "slack", text: "hello" });
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, { success: false, error: "Slack webhook request failed." });
  assert.deepEqual(await h.service.send({ platform: "slack", text: "hello" }), result.details);
  assert.deepEqual(h.notifications, Array(2).fill({ text: "Messaging error: Slack webhook request failed.", level: "error" }));
  t.mock.method(h.ctx.ui, "notify", () => { throw new Error("UI unavailable"); });
  assert.equal((await h.service.send({ platform: "slack", text: "hi" })).success, false);
});

test("shutdown cleanup is idempotent and cannot remove a newer singleton", (t) => {
  const first = harness(t);
  const replacement = { ...first.service };
  globals[PI_MESSAGING_KEY] = replacement;
  first.emit("session_shutdown");
  first.emit("session_shutdown");
  assert.equal(globals[PI_MESSAGING_KEY], replacement);
});
