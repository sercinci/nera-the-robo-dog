/**
 * WebSocket broker. Two client roles (declared via a `hello` message):
 *   - "audio"   : the kiosk — sends mic PCM + control events, receives TTS + state.
 *   - "display" : screens (laptop kiosk, Pi→TV, Yodeck web page) — receive Destination.
 *
 * The orchestrator (index.ts) drives sessions off the emitted events. Display
 * clients get a tiny JSON event; media is pre-cached on the client.
 */
import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import type { Destination, SessionState } from "@nera/contracts";

type Role = "audio" | "display";
interface Client {
  ws: WebSocket;
  role: Role;
  id: string;
}

export class Broker extends EventEmitter {
  private wss: WebSocketServer;
  private clients = new Map<string, Client>();
  private seq = 0;

  constructor(server: HttpServer) {
    super();
    this.wss = new WebSocketServer({ server });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  private onConnection(ws: WebSocket): void {
    const id = `c${++this.seq}`;
    this.clients.set(id, { ws, role: "display", id }); // default until hello

    ws.on("message", (raw) => {
      let m: any;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (m.type) {
        case "hello": {
          const role: Role = m.role === "audio" ? "audio" : "display";
          this.clients.set(id, { ws, role, id });
          this.emit("hello", id, role);
          break;
        }
        case "ring":
          this.emit("ring", id);
          break;
        case "audio":
          if (typeof m.b64 === "string") this.emit("audio", id, Buffer.from(m.b64, "base64"));
          break;
        case "resolve":
          // ElevenLabs agent path: a show_destination tool call relayed by the kiosk.
          this.emit("resolve", id, String(m.query ?? ""), m.reqId);
          break;
        case "speech_end":
          this.emit("speechEnd", id);
          break;
        case "welcome_done":
          this.emit("welcomeDone", id);
          break;
        case "screen_rendered":
          this.emit("screenRendered", id, typeof m.at === "number" ? m.at : Date.now());
          break;
        case "audio_started":
          this.emit("audioStarted", id, typeof m.at === "number" ? m.at : Date.now());
          break;
      }
    });

    ws.on("close", () => {
      this.clients.delete(id);
      this.emit("disconnect", id);
    });
  }

  // ---- broadcasts (all clients: display screens + the kiosk) ----
  broadcastDestination(d: Destination): void {
    this.broadcastAll({ type: "destination", destination: d });
  }
  broadcastIdle(): void {
    this.broadcastAll({ type: "idle" }); // Nera's face
  }

  // ---- sends to a specific audio client ----
  playWelcome(clientId: string): void {
    this.send(clientId, { type: "play_welcome" });
  }
  ttsChunk(clientId: string, buf: Buffer): void {
    this.send(clientId, { type: "tts_chunk", b64: buf.toString("base64") });
  }
  ttsEnd(clientId: string): void {
    this.send(clientId, { type: "tts_end" });
  }
  state(clientId: string, phase: SessionState): void {
    this.send(clientId, { type: "state", phase });
  }
  /** Reply to a kiosk's resolve request (so the agent can speak the confirmation). */
  resolveResult(clientId: string, reqId: unknown, payload: Record<string, unknown>): void {
    this.send(clientId, { type: "resolve_result", reqId, ...payload });
  }

  private broadcastAll(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
    }
  }
  private send(clientId: string, msg: unknown): void {
    const c = this.clients.get(clientId);
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }
}
