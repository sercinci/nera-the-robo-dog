// © Gerald Pögl / Hunter-ID MemoryBlock BG FlexCo (FN 658892i)
//
// server.ts — minimal HTTP server wrapping the agent loop.
//
// API
//   POST /session   { sessionId, transcript }
//   → 200           { match, reply, timings }
//   → 400/500       { error }
//
// The Spine-Team orchestrator calls this after STT commits a transcript.
// The response contains the MatchResult + the spoken reply for TTS.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { runAgent } from "./agent.js";
import { loadDirectory, loadPeople, loadSystemPrompt } from "./loader.js";

// ── Eagerly load static data at startup ───────────────────────────────────────
const directory = loadDirectory();
const people    = loadPeople();
const systemPrompt = loadSystemPrompt();
console.log(`[startup] directory: ${directory.length} entries, people: ${people.length}`);

// ── Lazy-import skills (they import contracts — keep module graph clean) ───────
const { skills } = await import("../../../skills/registry.js");

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

// ── Orchestrator POST (optional — fire-and-forget) ───────────────────────────

async function forwardToOrchestrator(body: unknown) {
  const url = process.env.ORCHESTRATOR_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn("[orchestrator] forward failed:", err);
  }
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, skills: skills.map((s) => s.name) });
  }

  if (req.method !== "POST" || req.url !== "/session") {
    return json(res, 404, { error: "Not found" });
  }

  let body: { sessionId?: string; transcript?: string };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  const transcript = body.transcript?.trim();
  if (!transcript) return json(res, 400, { error: "transcript is required" });

  const sessionId = body.sessionId ?? randomUUID();

  try {
    const t0 = Date.now();
    const result = await runAgent({ sessionId, transcript, skills, directory, people, systemPrompt });
    const totalMs = Date.now() - t0;

    console.log(`[session:${sessionId}] ${totalMs}ms | dest=${result.match.destinationId} conf=${result.match.confidence}`);

    // Fire-and-forget to orchestrator
    forwardToOrchestrator({ sessionId, ...result });

    return json(res, 200, { sessionId, ...result, totalMs });
  } catch (err) {
    console.error("[agent] error:", err);
    return json(res, 500, { error: String(err) });
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3100);
createServer(handle).listen(PORT, () => {
  console.log(`[agent-runner] listening on http://localhost:${PORT}`);
  console.log(`[agent-runner] skills: ${skills.map((s) => s.name).join(", ")}`);
});
