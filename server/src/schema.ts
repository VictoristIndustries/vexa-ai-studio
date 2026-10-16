import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const providerSettings = sqliteTable("provider_settings", {
  id: integer("id").primaryKey(),
  anthropicKey: text("anthropic_key"),
  openaiKey: text("openai_key"),
  falKey: text("fal_key"),
  defaultProvider: text("default_provider", { enum: ["anthropic", "openai"] }).notNull().default("anthropic"),
  defaultAnthropicModel: text("default_anthropic_model").notNull().default("claude-sonnet-4-5"),
  defaultOpenaiModel: text("default_openai_model").notNull().default("gpt-5-mini"),
  defaultFalModel: text("default_fal_model").notNull().default("fal-ai/wan/v2.7/text-to-video"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const chatSessions = sqliteTable("chat_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  provider: text("provider", { enum: ["anthropic", "openai"] }).notNull(),
  model: text("model").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const imageGenerations = sqliteTable("image_generations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prompt: text("prompt").notNull(),
  style: text("style").notNull(),
  size: text("size").notNull(),
  quality: text("quality").notNull(),
  blobKey: text("blob_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const videoJobs = sqliteTable("video_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  duration: integer("duration").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  status: text("status", { enum: ["queued", "processing", "done", "failed"] }).notNull().default("queued"),
  requestId: text("request_id").notNull(),
  statusUrl: text("status_url").notNull(),
  responseUrl: text("response_url").notNull(),
  blobKey: text("blob_key"),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
