DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE provider_settings (
  id INTEGER PRIMARY KEY,
  anthropic_key TEXT,
  openai_key TEXT,
  fal_key TEXT,
  default_provider TEXT NOT NULL DEFAULT 'anthropic',
  default_anthropic_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  default_openai_model TEXT NOT NULL DEFAULT 'gpt-5-mini',
  default_fal_model TEXT NOT NULL DEFAULT 'fal-ai/wan/v2.7/text-to-video',
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX chat_messages_session_idx ON chat_messages(session_id, id);
--> statement-breakpoint
CREATE TABLE image_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  style TEXT NOT NULL,
  size TEXT NOT NULL,
  quality TEXT NOT NULL,
  blob_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE video_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  duration INTEGER NOT NULL,
  aspect_ratio TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  request_id TEXT NOT NULL,
  status_url TEXT NOT NULL,
  response_url TEXT NOT NULL,
  blob_key TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX video_jobs_status_idx ON video_jobs(status, updated_at);
