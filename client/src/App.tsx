import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api } from "./api";

const anthropicModels = ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"];
const openaiModels = ["gpt-5-mini", "gpt-5", "gpt-4o"];
const tabs = ["chat", "images", "video", "work", "settings"] as const;
type Tab = typeof tabs[number];

const works = [
  ["ANOS Command Deck", "anos-command-deck", "Sector-7V starmap console with node telemetry and activation sim"],
  ["Vexa Brain", "vexa-brain", "Rotatable gold/cyan 3D brain with animated neural wavefronts"],
  ["Vexa Brain Control System", "vexa-brain-control-system", "Command deck with node commands and live system log"],
  ["3rd Ey3 Gat3", "3rd-ey3-gat3", "Vesica piscis gate with four portal states"],
  ["Vexa System Clock", "vexa-system-clock", "Twelve-position body clock with Kamea engines"],
  ["Vexa Complete System Clock", "vexa-complete-system-clock", "Body clock plus elemental correspondence wheel"],
  ["Eye of Hours System", "eye-of-hours-system", "Twelve-gate Eye Clock with planetary eyes"],
  ["Source Mind", "source-mind", "Seven-layer stack with guided trace"],
  ["Vexa Full System Atlas", "vexa-full-system-atlas", "L0–L7 layers, VEXA Cube, and component registry"],
  ["Vexagon Full Body System", "vexagon-full-body-system", "Full-body figure with body-clock positions"],
  ["Dominion World Map", "dominion-world-map", "Click-to-establish dominion nodes on a world map"],
  ["Sovereign Dominion", "sovereign-dominion", "The full Vexagon OVS private app—Core, Mind, Instruments, Heart, Temple"],
  ["Collective Locator", "collective-locator", "Private group location sharing with consent design"],
] as const;

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function ErrorLine({ children }: { children: ReactNode }) {
  return <p className="error-line" role="alert">{children}</p>;
}

function ProviderPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`provider-pill ${ok ? "ready" : "missing"}`}><i />{label} {ok ? "ready" : "needs key"}</span>;
}

function TabNav({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tab-nav" aria-label="Studio sections">
      {tabs.map((tab) => <button key={tab} className={active === tab ? "active" : ""} aria-current={active === tab ? "page" : undefined} onClick={() => onChange(tab)}><span>{tab === "chat" ? "01" : tab === "images" ? "02" : tab === "video" ? "03" : tab === "work" ? "04" : "05"}</span>{tab}</button>)}
    </nav>
  );
}

function ChatPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.listSessions({ limit: 30 }) });
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-5");
  const [customModel, setCustomModel] = useState("");
  const [error, setError] = useState("");
  const feedEnd = useRef<HTMLDivElement | null>(null);
  const messages = useQuery({ queryKey: ["messages", sessionId], queryFn: () => api.getMessages({ sessionId: sessionId ?? 0 }), enabled: sessionId !== null });

  useEffect(() => { if (!sessionId && sessions.data?.sessions[0]) setSessionId(sessions.data.sessions[0].id); }, [sessionId, sessions.data]);
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: "end" }); }, [messages.data?.messages.length]);

  const send = useMutation({
    mutationFn: () => api.sendChat({ sessionId: sessionId ?? undefined, content, provider, model: customModel.trim() || model }),
    onSuccess: async (result) => {
      if (!result.ok) { setError(result.error ?? "Vexa could not complete that request."); return; }
      setError(""); setContent("");
      if (result.sessionId) setSessionId(result.sessionId);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: () => setError("The request could not be sent."),
  });

  function selectProvider(next: "anthropic" | "openai") {
    setProvider(next); setCustomModel(""); setModel(next === "anthropic" ? "claude-sonnet-4-5" : "gpt-5-mini");
  }
  function submit(event: FormEvent) { event.preventDefault(); if (content.trim() && !send.isPending) send.mutate(); }

  const configured = provider === "anthropic" ? settings.data?.anthropic.configured : settings.data?.openai.configured;
  return (
    <section className="workspace chat-workspace">
      <aside className="session-rail">
        <button className="new-session" onClick={() => setSessionId(null)}>New conversation <b>＋</b></button>
        <div className="session-list">
          {sessions.data?.sessions.map((session) => <button key={session.id} className={sessionId === session.id ? "selected" : ""} onClick={() => { setSessionId(session.id); setProvider(session.provider); setModel(session.model); setCustomModel(""); }}><strong>{session.title}</strong><span>{session.provider} · {session.model}</span></button>)}
          {!sessions.isPending && !sessions.data?.sessions.length && <p className="empty-small">No conversations yet.</p>}
        </div>
      </aside>
      <div className="chat-stage">
        <header className="stage-head">
          <div><p className="section-code">01 / CONVERSATION</p><h1>{sessionId ? sessions.data?.sessions.find((s) => s.id === sessionId)?.title ?? "Conversation" : "What are we building?"}</h1></div>
          <ProviderPill ok={Boolean(configured)} label={provider === "anthropic" ? "Anthropic" : "OpenAI"} />
        </header>
        <div className="model-strip">
          <label>Provider<select aria-label="Chat provider" value={provider} onChange={(event) => selectProvider(event.target.value as "anthropic" | "openai")}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
          <label>Model<select aria-label="Chat model" value={model} onChange={(event) => { setModel(event.target.value); setCustomModel(""); }}>{(provider === "anthropic" ? anthropicModels : openaiModels).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="custom-model">Custom model<input aria-label="Custom chat model" value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="Optional exact model ID" /></label>
        </div>
        <div className="message-feed" aria-live="polite">
          {!sessionId && <div className="chat-empty"><span>V</span><h2>Give Vexa the work.</h2><p>Draft, debug, plan, or think through the next move. Your conversation will be saved here.</p></div>}
          {messages.data?.messages.map((message) => <article key={message.id} className={`message ${message.role}`}><header><strong>{message.role === "assistant" ? "Vexa" : "You"}</strong><time>{formatTime(message.createdAt)}</time></header><div>{message.content}</div></article>)}
          {send.isPending && <article className="message assistant pending"><header><strong>Vexa</strong><span>working</span></header><div className="pulse-line" /></article>}
          <div ref={feedEnd} />
        </div>
        <form className="composer" onSubmit={submit}>
          {!configured && <p className="key-note">Add your {provider === "anthropic" ? "Anthropic" : "OpenAI"} key in Settings to enable chat.</p>}
          {error && <ErrorLine>{error}</ErrorLine>}
          <label htmlFor="chat-input">Message Vexa</label>
          <textarea id="chat-input" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Describe the result you want…" rows={4} />
          <div><span>{(customModel.trim() || model)} · conversation history included</span><button className="primary" disabled={!content.trim() || send.isPending} type="submit">{send.isPending ? "Working…" : "Send to Vexa"}</button></div>
        </form>
      </div>
    </section>
  );
}

function ImagesPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
  const images = useQuery({ queryKey: ["images"], queryFn: () => api.listImages({ limit: 24 }) });
  const [prompt, setPrompt] = useState(""); const [style, setStyle] = useState<"natural" | "graphic" | "cinematic">("natural"); const [size, setSize] = useState<"1024x1024" | "1536x1024" | "1024x1536">("1024x1024"); const [quality, setQuality] = useState<"medium" | "high">("medium"); const [error, setError] = useState("");
  const generate = useMutation({ mutationFn: () => api.generateImage({ prompt, style, size, quality }), onSuccess: async (result) => { if (!result.ok) { setError(result.error ?? "Image generation failed."); return; } setError(""); setPrompt(""); await queryClient.invalidateQueries({ queryKey: ["images"] }); }, onError: () => setError("Image generation could not be started.") });
  return <section className="media-layout"><div className="creation-panel"><header className="stage-head"><div><p className="section-code">02 / IMAGE ENGINE</p><h1>Turn a direction into an image.</h1></div><ProviderPill ok={Boolean(settings.data?.openai.configured)} label="OpenAI" /></header><form onSubmit={(event) => { event.preventDefault(); if (prompt.trim()) generate.mutate(); }}><label htmlFor="image-prompt">Describe the image</label><textarea id="image-prompt" rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Subject, composition, palette, materials, lighting…"/><div className="option-grid"><label>Style<select aria-label="Image style" value={style} onChange={(event) => setStyle(event.target.value as typeof style)}><option value="natural">Natural</option><option value="graphic">Graphic</option><option value="cinematic">Cinematic</option></select></label><label>Canvas<select aria-label="Image size" value={size} onChange={(event) => setSize(event.target.value as typeof size)}><option value="1024x1024">Square</option><option value="1536x1024">Landscape</option><option value="1024x1536">Portrait</option></select></label><label>Quality<select aria-label="Image quality" value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}><option value="medium">Medium</option><option value="high">High</option></select></label></div>{!settings.data?.openai.configured && <p className="key-note">Add your OpenAI key in Settings to enable image generation.</p>}{error && <ErrorLine>{error}</ErrorLine>}<button className="primary wide" type="submit" disabled={!prompt.trim() || generate.isPending}>{generate.isPending ? "Rendering…" : "Generate image"}</button></form></div><div className="gallery-panel"><div className="gallery-head"><h2>Image runs</h2><span>{images.data?.images.length ?? 0} saved</span></div>{images.data?.images.length ? <div className="image-grid">{images.data.images.map((image) => <article key={image.id} className="image-card">{image.url ? <img src={image.url} alt={image.prompt} /> : <div className="media-missing">Image unavailable</div>}<div><p>{image.prompt}</p><span>{image.style} · {image.size} · {formatTime(image.createdAt)}</span>{image.url && <a href={image.url} download={`vexa-image-${image.id}.png`}>Download</a>}</div></article>)}</div> : <div className="empty-gallery"><span>02</span><h3>Your image runs will collect here.</h3><p>Set the direction on the left. Each finished render is stored in this studio.</p></div>}</div></section>;
}

function VideoPanel() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
  const videos = useQuery({ queryKey: ["videos"], queryFn: () => api.listVideos({ limit: 24 }) });
  const [prompt, setPrompt] = useState(""); const [duration, setDuration] = useState(5); const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9"); const [model, setModel] = useState("fal-ai/wan/v2.7/text-to-video"); const [error, setError] = useState("");
  const activeIds = useMemo(() => videos.data?.videos.filter((video) => video.status === "queued" || video.status === "processing").map((video) => video.id) ?? [], [videos.data]);
  const poll = useMutation({ mutationFn: (ids: number[]) => api.pollVideos({ ids }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }) });
  useEffect(() => { if (!activeIds.length) return; const id = window.setInterval(() => { if (!poll.isPending) poll.mutate(activeIds); }, 4000); return () => window.clearInterval(id); }, [activeIds.join(","), poll.isPending]);
  const start = useMutation({ mutationFn: () => api.startVideo({ prompt, model, duration, aspectRatio }), onSuccess: async (result) => { if (!result.ok) { setError(result.error ?? "Video generation failed."); return; } setError(""); setPrompt(""); await queryClient.invalidateQueries({ queryKey: ["videos"] }); }, onError: () => setError("Video generation could not be started.") });
  return <section className="media-layout"><div className="creation-panel"><header className="stage-head"><div><p className="section-code">03 / VIDEO QUEUE</p><h1>Set the motion. Run the queue.</h1></div><ProviderPill ok={Boolean(settings.data?.fal.configured)} label="fal.ai" /></header><form onSubmit={(event) => { event.preventDefault(); if (prompt.trim()) start.mutate(); }}><label htmlFor="video-prompt">Describe the shot</label><textarea id="video-prompt" rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Subject, movement, camera, pacing, environment…"/><div className="option-grid"><label>Duration<select aria-label="Video duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[2,3,4,5,6,7,8,9,10].map((value) => <option key={value} value={value}>{value} sec</option>)}</select></label><label>Aspect<select aria-label="Video aspect ratio" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select></label></div><label>fal model ID<input aria-label="fal video model" value={model} onChange={(event) => setModel(event.target.value)} /></label><p className="field-note">Model IDs can change. The default is tuned for text-to-video at 720p.</p>{!settings.data?.fal.configured && <p className="key-note">Add your fal.ai key in Settings to enable video generation.</p>}{error && <ErrorLine>{error}</ErrorLine>}<button className="primary wide" type="submit" disabled={!prompt.trim() || start.isPending}>{start.isPending ? "Submitting…" : "Start video job"}</button></form></div><div className="gallery-panel"><div className="gallery-head"><h2>Video runs</h2><span>{activeIds.length ? `${activeIds.length} active` : `${videos.data?.videos.length ?? 0} saved`}</span></div>{videos.data?.videos.length ? <div className="video-list">{videos.data.videos.map((video) => <article key={video.id} className="video-card">{video.url ? <video src={video.url} controls preload="metadata" aria-label={video.prompt} /> : <div className={`job-state ${video.status}`}><span>{video.status}</span><div className="scan-line" /></div>}<div><div className="status-row"><b>{video.status}</b><span>{video.duration}s · {video.aspectRatio}</span></div><p>{video.prompt}</p><small>{video.model} · {formatTime(video.createdAt)}</small>{video.error && <ErrorLine>{video.error}</ErrorLine>}{video.url && <a href={video.url} download={`vexa-video-${video.id}.mp4`}>Download MP4</a>}</div></article>)}</div> : <div className="empty-gallery"><span>03</span><h3>No jobs in the queue.</h3><p>Completed video files are copied into the studio before the provider link expires.</p></div>}</div></section>;
}

function WorkPanel() {
  return <section className="work-panel"><header className="work-head"><p className="section-code">04 / WORK LIBRARY</p><h1>Every system, one shelf.</h1><p>Open a workspace to continue the work where it lives.</p></header><div className="work-list">{works.map(([name, slug, description], index) => <article key={slug}><span className="work-index">{String(index + 1).padStart(2, "0")}</span><div><h2>{name}</h2><p>{description}</p><code>{slug}</code></div><a href={`/spaces/v2/${slug}/`} target="_blank" rel="noreferrer" aria-label={`Open ${name}`}>Open <span>↗</span></a></article>)}</div></section>;
}

function KeyField({ id, label, status, value, onValue, clear, onClear }: { id: string; label: string; status?: { configured: boolean; masked: string | null }; value: string; onValue: (value: string) => void; clear: boolean; onClear: (value: boolean) => void }) {
  return <div className="key-field"><div><label htmlFor={id}>{label}</label><span>{status?.configured ? `Saved ${status.masked ?? ""}` : "Not set"}</span></div><input id={id} type="password" autoComplete="off" value={value} onChange={(event) => onValue(event.target.value)} placeholder={status?.configured ? "Leave blank to keep saved key" : "Paste key"}/>{status?.configured && <label className="clear-check"><input type="checkbox" checked={clear} onChange={(event) => onClear(event.target.checked)} /> Remove saved key</label>}</div>;
}

function SettingsPanel() {
  const queryClient = useQueryClient(); const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
  const [anthropicKey, setAnthropicKey] = useState(""); const [openaiKey, setOpenaiKey] = useState(""); const [falKey, setFalKey] = useState(""); const [clearAnthropic, setClearAnthropic] = useState(false); const [clearOpenai, setClearOpenai] = useState(false); const [clearFal, setClearFal] = useState(false); const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic"); const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-5"); const [openaiModel, setOpenaiModel] = useState("gpt-5-mini"); const [falModel, setFalModel] = useState("fal-ai/wan/v2.7/text-to-video"); const [notice, setNotice] = useState("");
  const loaded = useRef(false); useEffect(() => { if (settings.data && !loaded.current) { loaded.current = true; setProvider(settings.data.defaults.provider); setAnthropicModel(settings.data.defaults.anthropicModel); setOpenaiModel(settings.data.defaults.openaiModel); setFalModel(settings.data.defaults.falModel); } }, [settings.data]);
  const save = useMutation({ mutationFn: () => api.saveSettings({ anthropicKey: anthropicKey || undefined, openaiKey: openaiKey || undefined, falKey: falKey || undefined, clearAnthropic, clearOpenai, clearFal, defaultProvider: provider, defaultAnthropicModel: anthropicModel, defaultOpenaiModel: openaiModel, defaultFalModel: falModel }), onSuccess: async () => { setAnthropicKey(""); setOpenaiKey(""); setFalKey(""); setClearAnthropic(false); setClearOpenai(false); setClearFal(false); setNotice("Settings saved."); await queryClient.invalidateQueries({ queryKey: ["settings"] }); }, onError: (err) => setNotice(err instanceof Error ? err.message : "Settings could not be saved.") });
  return <section className="settings-panel"><header className="work-head"><p className="section-code">05 / PROVIDER SETTINGS</p><h1>Keys stay behind the workbench.</h1><p>Saved keys are used only by server actions. The client receives set/not-set status and a masked tail—never the key itself.</p></header><form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><div className="settings-block"><h2>Provider keys</h2><KeyField id="anthropic-key" label="Anthropic API key" status={settings.data?.anthropic} value={anthropicKey} onValue={setAnthropicKey} clear={clearAnthropic} onClear={setClearAnthropic}/><KeyField id="openai-key" label="OpenAI API key" status={settings.data?.openai} value={openaiKey} onValue={setOpenaiKey} clear={clearOpenai} onClear={setClearOpenai}/><KeyField id="fal-key" label="fal.ai key" status={settings.data?.fal} value={falKey} onValue={setFalKey} clear={clearFal} onClear={setClearFal}/></div><div className="settings-block"><h2>Defaults</h2><div className="settings-grid"><label>Chat provider<select aria-label="Default chat provider" value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label><label>Anthropic model<input aria-label="Default Anthropic model" value={anthropicModel} onChange={(event) => setAnthropicModel(event.target.value)} /></label><label>OpenAI model<input aria-label="Default OpenAI model" value={openaiModel} onChange={(event) => setOpenaiModel(event.target.value)} /></label><label>fal video model<input aria-label="Default fal model" value={falModel} onChange={(event) => setFalModel(event.target.value)} /></label></div></div><div className="cost-note"><b>Provider billing</b><p>Chat and generation use your provider accounts and are billed under those providers’ current rates. Review each provider’s usage dashboard for exact costs.</p></div>{notice && <p className="save-notice" role="status">{notice}</p>}<button className="primary" disabled={save.isPending} type="submit">{save.isPending ? "Saving…" : "Save settings"}</button></form></section>;
}

export function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings({}) });
  return <div className="app-shell"><SafeAreaTopScrim backgroundColor="var(--bg)" /><header className="utility-bar"><div><span>V / STUDIO</span><i>Private workspace</i></div><div className="provider-summary"><ProviderPill ok={Boolean(settings.data?.anthropic.configured || settings.data?.openai.configured)} label="Chat"/><ProviderPill ok={Boolean(settings.data?.openai.configured)} label="Image"/><ProviderPill ok={Boolean(settings.data?.fal.configured)} label="Video"/></div></header><TabNav active={tab} onChange={setTab}/><main>{tab === "chat" && <ChatPanel/>}{tab === "images" && <ImagesPanel/>}{tab === "video" && <VideoPanel/>}{tab === "work" && <WorkPanel/>}{tab === "settings" && <SettingsPanel/>}</main><div className="bottom-safe" /></div>;
}
