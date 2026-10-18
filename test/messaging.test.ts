import assert from "node:assert/strict";
import { test } from "node:test";
import { createMessagingService, type MessagePayload } from "../src/messaging.ts";

const config = { discord: "https://discord.com/api/webhooks/private-token", slack: "https://hooks.slack.com/services/private-token" };

test("sends platform-specific JSON concurrently with bounded requests", async (t) => {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const finish: Array<() => void> = [];
  t.mock.method(globalThis, "fetch", (url: string, options: RequestInit) => {
    requests.push({ url, options });
    return new Promise<Response>((resolve) => finish.push(() => resolve(new Response(null, { status: 204 }))));
  });
  const result = createMessagingService(config).send({ platform: "both", text: "hello 👋" });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ url }) => url), [config.discord, config.slack]);
  assert.deepEqual(requests.map(({ options }) => JSON.parse(options.body as string)), [{ content: "hello 👋" }, { text: "hello 👋" }]);
  for (const { options } of requests) {
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, { "Content-Type": "application/json" });
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
  }
  finish.forEach((resolve) => resolve());
  assert.deepEqual(await result, { success: true });
});

test("reports missing configuration and still sends to configured targets", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("ok"));
  const service = createMessagingService({ slack: config.slack });
  assert.deepEqual(await service.send({ platform: "both", text: "hi" }), { success: false, error: "DISCORD_WEBHOOK_URL is not configured" });
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(await createMessagingService({}).send({ platform: "both", text: "hi" }), {
    success: false, error: "DISCORD_WEBHOOK_URL is not configured | SLACK_WEBHOOK_URL is not configured",
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("reports HTTP and network failures without leaking response bodies or secrets", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === config.discord) return new Response(`private body ${url}`, { status: 429 });
    throw new Error(`Failed fetching ${url}`);
  });
  assert.deepEqual(await createMessagingService(config).send({ platform: "both", text: "hi" }), {
    success: false, error: "Discord HTTP 429 | Slack webhook request failed.",
  });
  assert.equal(fetch.mock.callCount(), 2);
});

test("invalid API inputs fail without dispatching", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response());
  const service = createMessagingService(config);
  for (const payload of [null, { platform: "other", text: "hi" }, { platform: "slack", text: "  " }, { platform: "discord", text: 42 }]) {
    assert.equal((await service.send(payload as MessagePayload)).success, false);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("timeouts and caller cancellation abort pending requests with structured errors", async (t) => {
  const timeout = new AbortController();
  const timer = t.mock.method(AbortSignal, "timeout", (ms: number) => {
    assert.equal(ms, 5000);
    return timeout.signal;
  });
  const fetch = t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
  }));
  const service = createMessagingService(config);
  const pending = service.send({ platform: "slack", text: "hi" });
  timeout.abort();
  assert.deepEqual(await pending, { success: false, error: "Slack request timed out after 5000ms." });
  timer.mock.restore();
  const caller = new AbortController();
  const cancelled = service.send({ platform: "discord", text: "hi" }, caller.signal);
  caller.abort(new Error("secret cancellation reason"));
  assert.deepEqual(await cancelled, { success: false, error: "Discord request cancelled." });
  assert.deepEqual(await service.send({ platform: "discord", text: "hi" }, caller.signal), { success: false, error: "Discord request cancelled." });
  assert.equal(fetch.mock.callCount(), 2);
});

test("shutdown cancels in-flight sends and prevents stale consumers dispatching", async (t) => {
  const shutdown = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
  }));
  const service = createMessagingService(config, shutdown.signal);
  const pending = service.send({ platform: "slack", text: "hi" });
  shutdown.abort();
  assert.deepEqual(await pending, { success: false, error: "Messaging service is shut down." });
  assert.deepEqual(await service.send({ platform: "slack", text: "hi" }), { success: false, error: "Messaging service is shut down." });
  assert.equal(fetch.mock.callCount(), 1);
});
