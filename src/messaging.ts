export const PI_MESSAGING_KEY = Symbol.for("pi.messaging");

export interface MessagePayload {
  platform: "discord" | "slack" | "both";
  text: string;
}

export interface MessagingResult {
  success: boolean;
  error?: string;
}

export interface MessagingService {
  send(payload: MessagePayload, signal?: AbortSignal): Promise<MessagingResult>;
}

export interface WebhookConfig {
  discord?: string;
  slack?: string;
}

export function createMessagingService(config: WebhookConfig, shutdownSignal?: AbortSignal): MessagingService {
  return {
    async send(payload, signal) {
      if (!payload || !["discord", "slack", "both"].includes(payload.platform)) {
        return { success: false, error: "Invalid messaging platform; use discord, slack, or both." };
      }
      if (typeof payload.text !== "string" || !payload.text.trim()) {
        return { success: false, error: "Message text must not be empty." };
      }
      const platforms = payload.platform === "both" ? ["discord", "slack"] as const : [payload.platform];
      const errors = await Promise.all(platforms.map(async (platform): Promise<string | undefined> => {
        const label = platform === "discord" ? "Discord" : "Slack";
        if (shutdownSignal?.aborted) return "Messaging service is shut down.";
        if (signal?.aborted) return `${label} request cancelled.`;
        const url = config[platform];
        if (!url) return `${platform.toUpperCase()}_WEBHOOK_URL is not configured`;
        const timeout = AbortSignal.timeout(5000);
        const requestSignal = AbortSignal.any([timeout, ...[signal, shutdownSignal].filter((value): value is AbortSignal => value !== undefined)]);
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(platform === "discord" ? { content: payload.text } : { text: payload.text }),
            signal: requestSignal,
            redirect: "error",
          });
          // Do not expose response bodies or fetch errors: webhook URLs contain credentials.
          await response.body?.cancel();
          if (!response.ok) return `${label} HTTP ${response.status}`;
        } catch {
          if (shutdownSignal?.aborted) return "Messaging service is shut down.";
          if (signal?.aborted) return `${label} request cancelled.`;
          return timeout.aborted ? `${label} request timed out after 5000ms.` : `${label} webhook request failed.`;
        }
        return undefined;
      }));
      const error = errors.filter(Boolean).join(" | ");
      return error ? { success: false, error } : { success: true };
    },
  };
}
