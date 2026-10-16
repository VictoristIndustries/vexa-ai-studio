import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";

const VEXA_SYSTEM = "You are Vexa, a sharp, resourceful AI assistant. You help the user build, debug, and create. Be genuinely helpful, not performatively helpful: skip throat-clearing, do the work, and report results plainly.";
const SETTINGS_ID = 1;
const FAL_HOST = "queue.fal.run";
const FAL_MEDIA_HOST = "v3.fal.media";

type Provider = "anthropic" | "openai";
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeMessage(status: number, fallback: string): string {
  if (status === 401 || status === 403) return "That provider rejected the saved key. Update it in Settings and try again.";
  if (status === 429) return "The provider rate limit was reached. Wait a little before trying again.";
  if (status >= 500) return "The provider is temporarily unavailable. Try again later.";
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function maskTail(key: string | null): string | null {
  if (!key) return null;
  return `••••${key.slice(-4)}`;
}

function validFalModel(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/i.test(value) && !value.includes("..") && value.length <= 180;
}

function checkedFalUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === FAL_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

function checkedMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === FAL_MEDIA_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadSettings(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  const [row] = await db.select().from(schema.providerSettings).where(eq(schema.providerSettings.id, SETTINGS_ID)).limit(1);
  return row ?? null;
}

async function blobUrl(ctx: Ctx, key: string | null): Promise<string | null> {
  if (!key) return null;
  const head = await ctx.blobs.head(key);
  if (!head) return null;
  return ctx.blobs.getUrl(key, { expiresInSeconds: 3600 });
}

const settingsResponse = z.object({
  anthropic: z.object({ configured: z.boolean(), masked: z.string().nullable() }),
  openai: z.object({ configured: z.boolean(), masked: z.string().nullable() }),
  fal: z.object({ configured: z.boolean(), masked: z.string().nullable() }),
  defaults: z.object({
    provider: z.enum(["anthropic", "openai"]),
    anthropicModel: z.string(),
    openaiModel: z.string(),
    falModel: z.string(),
  }),
});

const messageSchema = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});

export const Actions = {
  getSettings: defineAction({
    request: z.object({}),
    response: settingsResponse,
    async handler(ctx): Promise<z.infer<typeof settingsResponse>> {
      const row = await loadSettings(ctx);
      return {
        anthropic: { configured: Boolean(row?.anthropicKey), masked: maskTail(row?.anthropicKey ?? null) },
        openai: { configured: Boolean(row?.openaiKey), masked: maskTail(row?.openaiKey ?? null) },
        fal: { configured: Boolean(row?.falKey), masked: maskTail(row?.falKey ?? null) },
        defaults: {
          provider: row?.defaultProvider ?? "anthropic",
          anthropicModel: row?.defaultAnthropicModel ?? "claude-sonnet-4-5",
          openaiModel: row?.defaultOpenaiModel ?? "gpt-5-mini",
          falModel: row?.defaultFalModel ?? "fal-ai/wan/v2.7/text-to-video",
        },
      };
    },
  }),

  saveSettings: defineAction({
    request: z.object({
      anthropicKey: z.string().trim().max(500).optional(),
      openaiKey: z.string().trim().max(500).optional(),
      falKey: z.string().trim().max(500).optional(),
      clearAnthropic: z.boolean().default(false),
      clearOpenai: z.boolean().default(false),
      clearFal: z.boolean().default(false),
      defaultProvider: z.enum(["anthropic", "openai"]),
      defaultAnthropicModel: z.string().trim().min(1).max(180),
      defaultOpenaiModel: z.string().trim().min(1).max(180),
      defaultFalModel: z.string().trim().min(1).max(180),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      if (!validFalModel(args.defaultFalModel)) throw new Error("The fal model ID format is not valid.");
      const db = ctx.db<typeof schema>();
      const current = await loadSettings(ctx);
      const values = {
        id: SETTINGS_ID,
        anthropicKey: args.clearAnthropic ? null : (args.anthropicKey || current?.anthropicKey || null),
        openaiKey: args.clearOpenai ? null : (args.openaiKey || current?.openaiKey || null),
        falKey: args.clearFal ? null : (args.falKey || current?.falKey || null),
        defaultProvider: args.defaultProvider,
        defaultAnthropicModel: args.defaultAnthropicModel,
        defaultOpenaiModel: args.defaultOpenaiModel,
        defaultFalModel: args.defaultFalModel,
        updatedAt: new Date(),
      };
      if (current) await db.update(schema.providerSettings).set(values).where(eq(schema.providerSettings.id, SETTINGS_ID));
      else await db.insert(schema.providerSettings).values(values);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listSessions: defineAction({
    request: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
    response: z.object({ sessions: z.array(z.object({ id: z.number(), title: z.string(), provider: z.enum(["anthropic", "openai"]), model: z.string(), updatedAt: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.chatSessions).orderBy(desc(schema.chatSessions.updatedAt)).limit(args.limit);
      return { sessions: rows.map((row) => ({ id: row.id, title: row.title, provider: row.provider, model: row.model, updatedAt: row.updatedAt.toISOString() })) };
    },
  }),

  getMessages: defineAction({
    request: z.object({ sessionId: z.number().int().positive() }),
    response: z.object({ messages: z.array(messageSchema) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.sessionId, args.sessionId)).orderBy(asc(schema.chatMessages.id)).limit(200);
      return { messages: rows.map((row) => ({ id: row.id, role: row.role, content: row.content, createdAt: row.createdAt.toISOString() })) };
    },
  }),

  sendChat: defineAction({
    request: z.object({
      sessionId: z.number().int().positive().optional(),
      content: z.string().trim().min(1).max(32000),
      provider: z.enum(["anthropic", "openai"]),
      model: z.string().trim().min(1).max(180),
    }),
    response: z.object({ ok: z.boolean(), sessionId: z.number().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const settings = await loadSettings(ctx);
      const key = args.provider === "anthropic" ? settings?.anthropicKey : settings?.openaiKey;
      if (!key) return { ok: false, error: `Add your ${args.provider === "anthropic" ? "Anthropic" : "OpenAI"} key in Settings to enable chat.` };

      let sessionId = args.sessionId;
      if (sessionId) {
        const [existing] = await db.select({ id: schema.chatSessions.id }).from(schema.chatSessions).where(eq(schema.chatSessions.id, sessionId)).limit(1);
        if (!existing) sessionId = undefined;
      }
      if (!sessionId) {
        const [created] = await db.insert(schema.chatSessions).values({ title: args.content.slice(0, 52), provider: args.provider, model: args.model }).returning({ id: schema.chatSessions.id });
        sessionId = created?.id;
      }
      if (!sessionId) return { ok: false, error: "The conversation could not be created." };

      await db.insert(schema.chatMessages).values({ sessionId, role: "user", content: args.content });
      const rows = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.sessionId, sessionId)).orderBy(asc(schema.chatMessages.id)).limit(80);

      try {
        let answer = "";
        if (args.provider === "anthropic") {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: args.model, max_tokens: 2048, system: VEXA_SYSTEM, messages: rows.map((row) => ({ role: row.role, content: row.content })) }),
          });
          const data = await readJson(response);
          if (!response.ok) return { ok: false, sessionId, error: safeMessage(response.status, "Anthropic could not complete that request.") };
          if (isObject(data) && Array.isArray(data.content)) {
            answer = data.content.filter(isObject).map((part) => part.type === "text" && typeof part.text === "string" ? part.text : "").join("\n").trim();
          }
        } else {
          const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: args.model, messages: [{ role: "system", content: VEXA_SYSTEM }, ...rows.map((row) => ({ role: row.role, content: row.content }))] }),
          });
          const data = await readJson(response);
          if (!response.ok) return { ok: false, sessionId, error: safeMessage(response.status, "OpenAI could not complete that request.") };
          if (isObject(data) && Array.isArray(data.choices)) {
            const first = data.choices[0];
            if (isObject(first) && isObject(first.message) && typeof first.message.content === "string") answer = first.message.content.trim();
          }
        }
        if (!answer) return { ok: false, sessionId, error: "The provider returned no text for that request." };
        await db.batch([
          db.insert(schema.chatMessages).values({ sessionId, role: "assistant", content: answer }),
          db.update(schema.chatSessions).set({ provider: args.provider, model: args.model, updatedAt: new Date() }).where(eq(schema.chatSessions.id, sessionId)),
        ]);
        ctx.invalidateQueries();
        return { ok: true, sessionId };
      } catch {
        return { ok: false, sessionId, error: "The provider could not be reached. Check your connection and try again." };
      }
    },
  }),

  listImages: defineAction({
    request: z.object({ limit: z.number().int().min(1).max(50).default(24) }),
    response: z.object({ images: z.array(z.object({ id: z.number(), prompt: z.string(), style: z.string(), size: z.string(), quality: z.string(), url: z.string().nullable(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.imageGenerations).orderBy(desc(schema.imageGenerations.id)).limit(args.limit);
      return { images: await Promise.all(rows.map(async (row) => ({ id: row.id, prompt: row.prompt, style: row.style, size: row.size, quality: row.quality, url: await blobUrl(ctx, row.blobKey), createdAt: row.createdAt.toISOString() }))) };
    },
  }),

  generateImage: defineAction({
    request: z.object({ prompt: z.string().trim().min(1).max(32000), style: z.enum(["natural", "graphic", "cinematic"]), size: z.enum(["1024x1024", "1536x1024", "1024x1536"]), quality: z.enum(["medium", "high"]) }),
    response: z.object({ ok: z.boolean(), id: z.number().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const settings = await loadSettings(ctx);
      if (!settings?.openaiKey) return { ok: false, error: "Add your OpenAI key in Settings to enable image generation." };
      const styleCue = args.style === "natural" ? "Natural, grounded visual treatment." : args.style === "graphic" ? "Strong graphic illustration treatment." : "Cinematic visual treatment.";
      try {
        const response = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${settings.openaiKey}` },
          body: JSON.stringify({ model: "gpt-image-1", prompt: `${args.prompt}\n\nStyle direction: ${styleCue}`, size: args.size, quality: args.quality, n: 1 }),
        });
        const data = await readJson(response);
        if (!response.ok) return { ok: false, error: safeMessage(response.status, "OpenAI could not generate that image.") };
        const first = isObject(data) && Array.isArray(data.data) ? data.data[0] : null;
        const encoded = isObject(first) && typeof first.b64_json === "string" ? first.b64_json : null;
        if (!encoded) return { ok: false, error: "OpenAI returned no image data." };
        const bytes = base64Bytes(encoded);
        if (bytes.byteLength < 16) return { ok: false, error: "OpenAI returned an incomplete image." };
        const key = `images/${Date.now()}-${ctx.invocationId}.png`;
        await ctx.blobs.put(key, bytes, { contentType: "image/png" });
        const db = ctx.db<typeof schema>();
        const [saved] = await db.insert(schema.imageGenerations).values({ prompt: args.prompt, style: args.style, size: args.size, quality: args.quality, blobKey: key }).returning({ id: schema.imageGenerations.id });
        ctx.invalidateQueries();
        return saved ? { ok: true, id: saved.id } : { ok: false, error: "The image was generated but could not be added to the gallery." };
      } catch {
        return { ok: false, error: "OpenAI could not be reached. Try again later." };
      }
    },
  }),

  listVideos: defineAction({
    request: z.object({ limit: z.number().int().min(1).max(50).default(24) }),
    response: z.object({ videos: z.array(z.object({ id: z.number(), prompt: z.string(), model: z.string(), duration: z.number(), aspectRatio: z.string(), status: z.enum(["queued", "processing", "done", "failed"]), error: z.string().nullable(), url: z.string().nullable(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.videoJobs).orderBy(desc(schema.videoJobs.id)).limit(args.limit);
      return { videos: await Promise.all(rows.map(async (row) => ({ id: row.id, prompt: row.prompt, model: row.model, duration: row.duration, aspectRatio: row.aspectRatio, status: row.status, error: row.error, url: await blobUrl(ctx, row.blobKey), createdAt: row.startedAt.toISOString() }))) };
    },
  }),

  startVideo: defineAction({
    request: z.object({ prompt: z.string().trim().min(1).max(8000), model: z.string().trim().min(1).max(180), duration: z.number().int().min(2).max(10), aspectRatio: z.enum(["16:9", "9:16", "1:1"]) }),
    response: z.object({ ok: z.boolean(), id: z.number().optional(), error: z.string().optional() }),
    async handler(ctx, args) {
      const settings = await loadSettings(ctx);
      if (!settings?.falKey) return { ok: false, error: "Add your fal.ai key in Settings to enable video generation." };
      if (!validFalModel(args.model)) return { ok: false, error: "Enter a fal model ID such as fal-ai/wan/v2.7/text-to-video." };
      try {
        const response = await fetch(`https://${FAL_HOST}/${args.model}`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Key ${settings.falKey}` },
          body: JSON.stringify({ prompt: args.prompt, duration: Math.max(2, Math.min(10, args.duration)), aspect_ratio: args.aspectRatio, resolution: "720p" }),
        });
        const data = await readJson(response);
        if (!response.ok) return { ok: false, error: safeMessage(response.status, "fal.ai could not start that video job. The selected model may use a different input schema.") };
        if (!isObject(data)) return { ok: false, error: "fal.ai returned an unexpected queue response." };
        const requestId = typeof data.request_id === "string" ? data.request_id : null;
        const statusUrl = checkedFalUrl(data.status_url);
        const responseUrl = checkedFalUrl(data.response_url);
        if (!requestId || !statusUrl || !responseUrl) return { ok: false, error: "fal.ai returned incomplete job tracking details." };
        const db = ctx.db<typeof schema>();
        const [saved] = await db.insert(schema.videoJobs).values({ prompt: args.prompt, model: args.model, duration: args.duration, aspectRatio: args.aspectRatio, requestId, statusUrl, responseUrl }).returning({ id: schema.videoJobs.id });
        ctx.invalidateQueries();
        return saved ? { ok: true, id: saved.id } : { ok: false, error: "The video job started but could not be saved." };
      } catch {
        return { ok: false, error: "fal.ai could not be reached. Try again later." };
      }
    },
  }),

  pollVideos: defineAction({
    request: z.object({ ids: z.array(z.number().int().positive()).max(20) }),
    response: z.object({ ok: z.literal(true), updated: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; updated: number }> {
      if (args.ids.length === 0) return { ok: true, updated: 0 };
      const settings = await loadSettings(ctx);
      if (!settings?.falKey) return { ok: true, updated: 0 };
      const db = ctx.db<typeof schema>();
      const jobs = await db.select().from(schema.videoJobs).where(and(inArray(schema.videoJobs.id, args.ids), inArray(schema.videoJobs.status, ["queued", "processing"]))).limit(20);
      let updated = 0;
      for (const job of jobs) {
        if (Date.now() - job.startedAt.getTime() > 10 * 60 * 1000) {
          await db.update(schema.videoJobs).set({ status: "failed", error: "This job exceeded the 10-minute wait limit. Check the provider before trying again.", updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
          updated += 1;
          continue;
        }
        try {
          const statusResponse = await fetch(job.statusUrl, { headers: { Authorization: `Key ${settings.falKey}` } });
          if (!statusResponse.ok) {
            if (statusResponse.status === 401 || statusResponse.status === 403 || statusResponse.status === 429) {
              await db.update(schema.videoJobs).set({ status: "failed", error: safeMessage(statusResponse.status, "fal.ai could not report this job."), updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
              updated += 1;
            }
            continue;
          }
          const statusData = await readJson(statusResponse);
          const rawStatus = isObject(statusData) && typeof statusData.status === "string" ? statusData.status.toUpperCase() : "";
          if (rawStatus === "FAILED") {
            await db.update(schema.videoJobs).set({ status: "failed", error: "fal.ai reported that this generation failed.", updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
            updated += 1;
          } else if (rawStatus === "COMPLETED") {
            const resultResponse = await fetch(job.responseUrl, { headers: { Authorization: `Key ${settings.falKey}` } });
            const resultData = await readJson(resultResponse);
            const rawVideo = isObject(resultData) && isObject(resultData.video) ? resultData.video.url : null;
            const mediaUrl = checkedMediaUrl(rawVideo);
            if (!resultResponse.ok || !mediaUrl) {
              await db.update(schema.videoJobs).set({ status: "failed", error: "The video completed, but its media file could not be validated.", updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
              updated += 1;
              continue;
            }
            const mediaResponse = await fetch(mediaUrl);
            const length = Number(mediaResponse.headers.get("content-length") ?? "0");
            if (!mediaResponse.ok || (length > 0 && length > 250 * 1024 * 1024)) {
              await db.update(schema.videoJobs).set({ status: "failed", error: "The generated video could not be copied into the studio.", updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
              updated += 1;
              continue;
            }
            const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
            if (bytes.byteLength === 0 || bytes.byteLength > 250 * 1024 * 1024) {
              await db.update(schema.videoJobs).set({ status: "failed", error: "The generated video file was empty or too large to store.", updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
              updated += 1;
              continue;
            }
            const key = `videos/${job.id}-${ctx.invocationId}.mp4`;
            await ctx.blobs.put(key, bytes, { contentType: "video/mp4" });
            await db.update(schema.videoJobs).set({ status: "done", blobKey: key, error: null, statusUrl: "stored", responseUrl: "stored", updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
            updated += 1;
          } else if (job.status !== "processing") {
            await db.update(schema.videoJobs).set({ status: "processing", updatedAt: new Date() }).where(eq(schema.videoJobs.id, job.id));
            updated += 1;
          }
        } catch {
          // A transient polling failure leaves the job active for the next client poll.
        }
      }
      if (updated > 0) ctx.invalidateQueries();
      return { ok: true, updated };
    },
  }),
} satisfies ActionsModule;
