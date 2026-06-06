/**
 * Server-side ElevenLabs Conversational AI (agent) over the WebSocket API.
 * Used for the DOOR path: the orchestrator hosts the agent (vs the browser SDK
 * for browser clicks), so it can bridge the Ring intercom's audio in/out.
 *
 * Protocol (extracted from @elevenlabs/client):
 *   URL   wss://api.elevenlabs.io/v1/convai/conversation?agent_id=...
 *   out   { type:"conversation_initiation_client_data", dynamic_variables }
 *         { user_audio_chunk: "<base64 pcm16k>" }
 *         { type:"pong", event_id }
 *         { type:"client_tool_result", tool_call_id, result, is_error }
 *   in    conversation_initiation_metadata | audio (audio_event.audio_base_64) |
 *         agent_response | user_transcript | ping (ping_event) | client_tool_call |
 *         interruption
 */
import WebSocket from "ws";

export interface ConvaiDeps {
  agentId: string;
  apiKey?: string; // public agent works without it; sent as xi-api-key if present
  dynamicVariables?: Record<string, string>;
}

export interface ConvaiHandlers {
  onReady?: (meta: unknown) => void;
  onAgentAudio?: (pcm: Buffer) => void; // decoded agent voice (PCM s16le)
  onAgentResponse?: (text: string) => void;
  onUserTranscript?: (text: string) => void;
  onInterruption?: () => void;
  onToolCall?: (
    name: string,
    params: Record<string, unknown>,
    respond: (result: string, isError?: boolean) => void,
  ) => void;
  onClose?: () => void;
  onError?: (err: Error) => void;
}

export class ConvaiSession {
  private ws: WebSocket;
  private open = false;
  private queue: string[] = [];

  constructor(deps: ConvaiDeps, handlers: ConvaiHandlers) {
    const params = new URLSearchParams({
      agent_id: deps.agentId,
      source: "nera-orchestrator",
      version: "1",
    });
    this.ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/convai/conversation?${params.toString()}`,
      deps.apiKey ? { headers: { "xi-api-key": deps.apiKey } } : undefined,
    );

    this.ws.on("open", () => {
      this.open = true;
      this.raw(
        JSON.stringify({
          type: "conversation_initiation_client_data",
          dynamic_variables: deps.dynamicVariables ?? {},
        }),
      );
      for (const m of this.queue) this.ws.send(m);
      this.queue = [];
    });

    this.ws.on("message", (data) => {
      let m: any;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (m.type) {
        case "conversation_initiation_metadata":
          handlers.onReady?.(m.conversation_initiation_metadata_event);
          break;
        case "audio": {
          const b64 = m.audio_event?.audio_base_64;
          if (b64) handlers.onAgentAudio?.(Buffer.from(b64, "base64"));
          break;
        }
        case "agent_response":
          handlers.onAgentResponse?.(m.agent_response_event?.agent_response ?? "");
          break;
        case "user_transcript":
          handlers.onUserTranscript?.(m.user_transcription_event?.user_transcript ?? "");
          break;
        case "interruption":
          handlers.onInterruption?.();
          break;
        case "ping":
          this.send({ type: "pong", event_id: m.ping_event?.event_id });
          break;
        case "client_tool_call": {
          const c = m.client_tool_call;
          if (c && handlers.onToolCall) {
            handlers.onToolCall(c.tool_name, c.parameters ?? {}, (result, isError = false) =>
              this.send({
                type: "client_tool_result",
                tool_call_id: c.tool_call_id,
                result,
                is_error: isError,
              }),
            );
          }
          break;
        }
      }
    });

    this.ws.on("error", (e) => handlers.onError?.(e as Error));
    this.ws.on("close", () => {
      this.open = false;
      handlers.onClose?.();
    });
  }

  private raw(s: string): void {
    if (this.open && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }
  private send(obj: unknown): void {
    this.raw(JSON.stringify(obj));
  }

  /** Feed a chunk of the visitor's audio (PCM s16le at the agent's input rate). */
  sendAudio(pcm: Buffer): void {
    this.raw(JSON.stringify({ user_audio_chunk: pcm.toString("base64") }));
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
