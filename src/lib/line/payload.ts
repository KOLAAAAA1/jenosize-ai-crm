import { z } from "zod";

const lineTextMessageEventSchema = z.object({
  type: z.literal("message"),
  webhookEventId: z.string().min(1),
  timestamp: z.number().optional(),
  replyToken: z.string().min(1).optional(), // present on user-message events; single-use, ~1min TTL
  source: z.object({
    type: z.string(),
    userId: z.string().min(1).optional(),
  }),
  message: z.object({
    type: z.literal("text"),
    id: z.string().min(1),
    text: z.string(),
  }),
  deliveryContext: z
    .object({
      isRedelivery: z.boolean().optional(),
    })
    .optional(),
});

// Friend-add / re-add. Carries a replyToken (used for the greeting reply /
// LIFF welcome) but no message.
const lineFollowEventSchema = z.object({
  type: z.literal("follow"),
  replyToken: z.string().min(1).optional(),
  source: z.object({
    type: z.string(),
    userId: z.string().min(1).optional(),
  }),
});

// Block / remove-friend. No replyToken (can't reply); drives consent opt-out.
const lineUnfollowEventSchema = z.object({
  type: z.literal("unfollow"),
  source: z.object({
    type: z.string(),
    userId: z.string().min(1).optional(),
  }),
});

export const lineWebhookPayloadSchema = z.object({
  destination: z.string().optional(),
  events: z.array(z.unknown()),
});

export type LineTextMessageEvent = z.infer<typeof lineTextMessageEventSchema>;
export type LineFollowEvent = z.infer<typeof lineFollowEventSchema>;
export type LineUnfollowEvent = z.infer<typeof lineUnfollowEventSchema>;
export type LineWebhookPayload = z.infer<typeof lineWebhookPayloadSchema>;

export function parseLineWebhookPayload(rawBody: string): { ok: true; payload: LineWebhookPayload } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawBody);
    const result = lineWebhookPayloadSchema.safeParse(parsed);
    if (!result.success) return { ok: false, error: "Invalid LINE webhook payload" };
    return { ok: true, payload: result.data };
  } catch {
    return { ok: false, error: "Invalid JSON payload" };
  }
}

export function parseTextMessageEvent(event: unknown): LineTextMessageEvent | null {
  const result = lineTextMessageEventSchema.safeParse(event);
  return result.success ? result.data : null;
}

export function parseFollowEvent(event: unknown): LineFollowEvent | null {
  const result = lineFollowEventSchema.safeParse(event);
  return result.success ? result.data : null;
}

export function parseUnfollowEvent(event: unknown): LineUnfollowEvent | null {
  const result = lineUnfollowEventSchema.safeParse(event);
  return result.success ? result.data : null;
}
