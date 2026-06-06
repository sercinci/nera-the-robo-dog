/**
 * Nera kiosk — ElevenLabs Agent path.
 *
 * The ElevenLabs SDK runs the whole voice loop (mic, STT, LLM, TTS, VAD, barge-in).
 * When the agent calls the `show_destination` client tool, we relay the query to our
 * orchestrator over a WS; it resolves against the directory, broadcasts the Destination
 * to all screens, and returns a confirmation string the agent speaks.
 */
import { Conversation } from "/vendor/elevenlabs-client.js"; // vendored, no CDN at runtime

const $ = (id) => document.getElementById(id);
const els = {
  face: $("face"), status: $("status"), card: $("card"),
  title: $("card-title"), subtitle: $("card-subtitle"), marker: $("card-marker"),
  kicker: $("card-kicker"), ring: $("ring"), phase: $("phase"),
  transcript: $("transcript"), latency: $("latency"), conn: $("conn"),
};

let ws;
let conv = null;
let agentId = null;
let directory = ""; // live snapshot of places/people, injected as a dynamic variable
const pending = new Map();
let reqSeq = 0;

// ---------- our orchestrator WS (screens + resolve) ----------
function connectWs() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => {
    els.conn.textContent = "connected"; els.conn.classList.add("up");
    ws.send(JSON.stringify({ type: "hello", role: "display" }));
  };
  ws.onclose = () => {
    els.conn.textContent = "reconnecting…"; els.conn.classList.remove("up");
    setTimeout(connectWs, 1000);
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "destination") showDestination(m.destination);
    else if (m.type === "idle") { if (!conv) showIdle(); }
    else if (m.type === "resolve_result") {
      const r = pending.get(m.reqId);
      if (r) { pending.delete(m.reqId); r(m); }
    }
    else if (m.type === "agent_audio") playPcm(m.b64); // door path: Nera's voice forwarded here
    else if (m.type === "door_state") onDoorState(m.state);
  };
}

// ---------- door path: play server-forwarded PCM (Nera's voice from the intercom) ----------
let pbCtx = null;
let pbTime = 0;
function ensurePlayback() {
  if (!pbCtx) pbCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  if (pbCtx.state === "suspended") pbCtx.resume();
}
function playPcm(b64) {
  ensurePlayback();
  const bytes = b64ToBytes(b64);
  const n = bytes.length >> 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const buf = pbCtx.createBuffer(1, n, 16000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
  const src = pbCtx.createBufferSource();
  src.buffer = buf;
  src.connect(pbCtx.destination);
  const now = pbCtx.currentTime;
  if (pbTime < now) pbTime = now;
  src.start(pbTime);
  pbTime += buf.duration;
}
function onDoorState(state) {
  if (state === "ringing") { els.phase.textContent = "DOOR"; els.status.textContent = "🔔 Door buzz — connecting…"; }
  else if (state === "active" || state === "listening") {
    els.phase.textContent = "DOOR"; els.face.classList.add("listening"); els.face.classList.remove("talking");
    els.status.textContent = "Listening at the door…";
  } else if (state === "speaking") {
    els.face.classList.add("talking"); els.face.classList.remove("listening");
    els.status.textContent = "Nera is speaking…";
  } else if (state === "idle") {
    showIdle();
  }
}

function resolveViaServer(query) {
  return new Promise((resolve) => {
    const reqId = "r" + ++reqSeq;
    pending.set(reqId, resolve);
    ws?.send(JSON.stringify({ type: "resolve", query, reqId }));
    setTimeout(() => {
      if (pending.has(reqId)) { pending.delete(reqId); resolve({ result: "Sorry, that timed out." }); }
    }, 6000);
  });
}

function unlockViaServer() {
  return new Promise((resolve) => {
    const reqId = "u" + ++reqSeq;
    pending.set(reqId, resolve);
    ws?.send(JSON.stringify({ type: "unlock", reqId }));
    setTimeout(() => {
      if (pending.has(reqId)) { pending.delete(reqId); resolve({ result: "Couldn't reach the door." }); }
    }, 6000);
  });
}

// ---------- screen rendering ----------
function showIdle() {
  els.card.classList.add("hidden");
  els.face.classList.remove("talking", "listening");
  els.status.textContent = "Tap the doorbell to begin";
  els.phase.textContent = "IDLE";
}
function showDestination(d) {
  if (d.status === "resolved" || d.status === "no_match") {
    els.kicker.textContent = d.status === "resolved" ? "Destination" : "Let's get you help";
    els.title.textContent = d.screen.title;
    els.subtitle.textContent = d.screen.subtitle ?? "";
    els.marker.textContent = d.screen.mapMarker ?? "";
    els.card.classList.remove("hidden");
  }
  els.transcript.textContent = d.transcript ? `“${d.transcript}”` : "";
}

// ---------- pre-warm for fast session start ----------
let warmMicStream = null;
async function prefetchConfig() {
  try {
    const cfg = await fetch("/config").then((r) => r.json());
    agentId = cfg.agentId;
    directory = cfg.directory ?? "";
  } catch { /* retried at ring */ }
}
async function warmMic() {
  // Pre-grant mic permission so it's not on the start critical path next time.
  if (warmMicStream) return;
  try {
    warmMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch { /* user will be prompted at start */ }
}

// ---------- ElevenLabs conversation ----------
const sessionCommon = () => ({
  agentId,
  dynamicVariables: { directory }, // live directory from your JSON, for disambiguation
  clientTools: {
    show_destination: async ({ query }) => {
      els.status.textContent = `Finding “${query}”…`;
      els.latency.textContent = "🔎 resolving…";
      const r = await resolveViaServer(query);
      els.latency.textContent = r.status ? `→ ${r.status}` : "";
      return r.result || "Done.";
    },
    open_door: async () => {
      els.status.textContent = "Opening the door…";
      const r = await unlockViaServer();
      return r.result || "Done.";
    },
  },
  onConnect: () => {
    els.phase.textContent = "LIVE";
    els.face.classList.add("listening");
    els.ring.textContent = "■ End";
    if (startedAt) els.latency.textContent = `⚡ connected in ${Math.round(performance.now() - startedAt)}ms`;
  },
  onDisconnect: () => { conv = null; els.ring.textContent = "🔔 Ring doorbell"; showIdle(); },
  onModeChange: (m) => {
    const speaking = m?.mode === "speaking";
    els.face.classList.toggle("talking", speaking);
    els.face.classList.toggle("listening", !speaking);
    els.status.textContent = speaking ? "Nera is speaking…" : "Listening…";
  },
  onMessage: (msg) => {
    const text = typeof msg === "string" ? msg : msg?.message;
    if (text) els.transcript.textContent = `“${text}”`;
  },
  onError: (e) => { console.error("EL error:", e); els.status.textContent = "Error: " + (e?.message ?? e); },
});

let startedAt = 0;
async function startConversation() {
  if (!agentId) await prefetchConfig();
  if (!agentId) { els.status.textContent = "No ELEVENLABS_AGENT_ID configured."; return; }

  els.status.textContent = "Connecting to Nera…";
  startedAt = performance.now();
  // Prefer WebRTC (lower latency, resilient to packet loss); fall back to WebSocket
  // if the network blocks UDP.
  try {
    conv = await Conversation.startSession({ ...sessionCommon(), connectionType: "webrtc" });
  } catch (e) {
    console.warn("WebRTC start failed, falling back to WebSocket:", e);
    try {
      conv = await Conversation.startSession({ ...sessionCommon(), connectionType: "websocket" });
    } catch (e2) {
      console.error(e2);
      els.status.textContent = "Couldn't start (mic permission / network?).";
      conv = null;
    }
  }
}

async function endConversation() {
  try { await conv?.endSession(); } catch {}
  conv = null;
  els.ring.textContent = "🔔 Ring doorbell";
  showIdle();
}

els.ring.onclick = () => (conv ? endConversation() : startConversation());

// Pre-warm so the first ring connects fast: SDK is already local, config is prefetched,
// and mic permission is granted on the first interaction (off the start path).
connectWs();
showIdle();
prefetchConfig();
window.addEventListener("pointerdown", () => { warmMic(); ensurePlayback(); }, { once: true });
