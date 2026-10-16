# Data Plan

## Context provenance
- `"now use this zip and build me a vexa AI that i can use to make images videos and all my work"` (current user request; defines the studio’s core Chat, Images, Video, and Work workflows)
- `You are Vexa, a sharp, resourceful AI assistant. You help the user build, debug, and create. Be genuinely helpful, not performatively helpful: skip throat-clearing, do the work, and report results plainly.` (verbatim persona supplied in the build request; used only as the Chat system prompt)
- `/home/hatch/workspace/research_notes/vexa-ai-studio/report.md` (finished deep-research report; establishes provider endpoints, request/response shapes, curated model defaults, fal queue behavior, the 10-minute job cap, and model-ID drift caveats)
- The exact 13 artifact names, slugs, and descriptions in the build request define the Work shelf; no additional project history is imported.
- The Aeonimus Codex text supplied in the 2026-10-16 edit request (core axioms, glyph lexicon, provenance seals PL-001–PL-006, Living Field cells/pulses/image tokens, canon registry CAN-001–CAN-010, VanessaScript doctrine, Permanent Seal) defines Vexa's character layer. It is presented as the author's symbolic system in the author's own terms, including the Codex's own note that its "force" values are a symbolic model, not factual authority. Five character modes derived from it (Core Vexa, Aeonimus Architect, Provenance Keeper, Flare Strategist, Image Executor) are selectable in the Character tab and in Chat; the active mode is stored server-side in `provider_settings.character_mode` and appended to the Chat system prompt by `sendChat` only — it does not alter image or video provider calls.

## Tested sources
### OpenAI image and chat APIs
**Used by**: `sendChat`, `generateImage`
**Test command**: `curl -sS -o /tmp/openai_probe.txt -w '%{http_code}\n' -X POST 'https://api.openai.com/v1/images/generations' -H 'content-type: application/json' --data '{"model":"gpt-image-1","prompt":"test","size":"1024x1024","quality":"medium","n":1}' && head -c 500 /tmp/openai_probe.txt`
**Sample output**: HTTP `401` with `Missing bearer ... authentication in header`, confirming the endpoint accepts the expected POST route and requires server-side bearer authentication.
**Processing**: Chat posts the Vexa system prompt and current session history to `https://api.openai.com/v1/chat/completions`. Images post one request to `https://api.openai.com/v1/images/generations`; the first `b64_json` is decoded, checked as an image payload, stored in `ctx.blobs`, and only the owned blob URL is returned to the client. No key is returned.

### Anthropic Messages API
**Used by**: `sendChat`
**Test command**: `curl -sS -o /tmp/anthropic_probe.txt -w '%{http_code}\n' -X POST 'https://api.anthropic.com/v1/messages' -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' --data '{"model":"claude-sonnet-4-5","max_tokens":1,"messages":[{"role":"user","content":"test"}]}' && head -c 500 /tmp/anthropic_probe.txt`
**Sample output**: HTTP `401` with `x-api-key header is required`, confirming the endpoint and required key header.
**Processing**: Server action sends only the selected session’s messages plus the fixed Vexa system prompt. The browser receives generated text and model metadata, never the key.

### fal.ai queue API
**Used by**: `startVideo`, `pollVideo`
**Test command**: `curl -sS -o /tmp/fal_probe.txt -w '%{http_code}\n' -X POST 'https://queue.fal.run/fal-ai/wan/v2.7/text-to-video' -H 'content-type: application/json' --data '{"prompt":"test","duration":2,"aspect_ratio":"16:9","resolution":"720p"}' && head -c 500 /tmp/fal_probe.txt`
**Sample output**: HTTP `401` with authentication required for the resolved application `fal-ai/wan-27-t2v`, confirming the supplied model route resolves and requires a fal key.
**Processing**: `startVideo` submits prompt, clamped 2–10 second duration, aspect ratio, and 720p resolution. It persists only job metadata and returned queue URLs after validating that they are HTTPS URLs on `queue.fal.run`. `pollVideo` checks the returned status URL, enforces a 10-minute cap, fetches the validated response URL on completion, then downloads the result only from `v3.fal.media`, stores owned MP4 bytes in `ctx.blobs`, and removes the expiring provider URL from user-facing state.

## Web-search sources
### fal generated-media delivery host
**Delivered by**: `pollVideo`
**Checked with**: `browser_search` query `fal.ai API generated video output URL fal.media CDN response video.url host`; returned examples show video results as `https://v3.fal.media/files/...` and note that generated media URLs expire, supporting immediate copy to owned blob storage. Exact result URL retained for provenance: `https://github.com/marmikcfc/pepper-railway/blob/HEAD/container/skills/fal-ai/SKILL.md`.

## Image slots
- Generated image gallery: real user-requested outputs from OpenAI’s image API, copied into artifact blob storage. No build-time hero or decorative image is used; the studio is an instrument-style utility and generated media itself is the only relevant imagery.
- Generated video gallery: real user-requested outputs from fal.ai, copied from `v3.fal.media` into artifact blob storage before display.

## Long-term data behavior
- **Refresh policy**: No background refresh. Chat/image history is queried on open; active video rows poll only while the Video tab is open and a job is queued or processing, approximately every four seconds.
- **Growth**: Chat sessions, messages, image generations, and video jobs append. Provider settings remain a single server-side row. Binary outputs live in blob storage, referenced by blob key.
- **Ordering**: Sessions and media galleries sort newest first; messages sort chronologically inside one session.
- **Time semantics**: Created/updated instants are stored as UTC timestamps and rendered in the viewer’s local time. Video timeout compares server instants and never invents a completion time.
- **Keys**: API keys are persisted only in the server-side database and are never selected into a client response. Settings returns only boolean configured states and a masked tail. Save actions replace a key only when a non-empty value is submitted; clear actions delete it.

## Rejected approaches
- **Tried**: Calling provider APIs from the browser.
  **Why rejected**: It would expose private provider keys and violate the server-only architecture.
- **Tried**: Rendering OpenAI base64 or fal CDN URLs directly.
  **Why rejected**: OpenAI returns base64 rather than a durable URL, while fal CDN files expire; both are copied into artifact-owned blob storage.
- **Tried**: Simulated provider responses or seeded gallery items.
  **Why rejected**: The request requires a genuine utility. Missing keys produce actionable empty states rather than fake outputs.
- **Tried**: A decorative hero image.
  **Why rejected**: The primary visual subject is the live creative work surface itself; decorative imagery would compete with the studio workflow.
