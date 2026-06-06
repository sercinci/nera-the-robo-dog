/**
 * The agent: OpenRouter (OpenAI-compatible) tool-calling. One round — the model
 * picks a skill, we execute it and project a Destination. No tool call => no_match.
 *
 * Keep the model behind this seam: swap OpenRouter for a native provider (Groq /
 * OpenAI / Anthropic) by passing a different OpenAI-compatible client + model.
 *
 * NOTE: live-call module — verify with a real OPENROUTER_API_KEY (see dev/harness.ts).
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  toToolSpecs,
  resolveWithSkill,
  noMatchDestination,
  type DataCtx,
  type ResolveMeta,
} from "./tools.js";
import type { AnySkill, Destination } from "@nera/contracts";

export interface AgentDeps {
  client: OpenAI;
  model: string;
  skills: AnySkill[];
  systemPrompt: string;
  /** "required" forces the model to call a resolving skill every turn (default) —
   *  the agent's job is to resolve a destination, not to chat. */
  toolChoice?: "auto" | "required";
}

export interface AgentInput {
  transcript: string;
  data: DataCtx;
  meta: ResolveMeta;
  history?: ChatCompletionMessageParam[];
  signal?: AbortSignal;
  /** Called once the model has responded (for first-token timing). */
  onResponse?: () => void;
}

export interface AgentResult {
  destination: Destination;
  toolName?: string;
  assistantText?: string;
  messages: ChatCompletionMessageParam[];
}

/** OpenAI client pointed at OpenRouter. */
export function makeOpenRouterClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/sercinci/nera-the-robo-dog",
      "X-Title": "Nera the Robo Dog",
    },
  });
}

export async function runAgent(deps: AgentDeps, input: AgentInput): Promise<AgentResult> {
  const tools = toToolSpecs(deps.skills);
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: deps.systemPrompt },
    ...(input.history ?? []),
    { role: "user", content: input.transcript },
  ];

  const completion = await deps.client.chat.completions.create(
    { model: deps.model, messages, tools, tool_choice: deps.toolChoice ?? "required", temperature: 0.2 },
    { signal: input.signal },
  );
  input.onResponse?.();

  const msg = completion.choices[0]?.message;
  const updated: ChatCompletionMessageParam[] = msg
    ? [...messages, msg as ChatCompletionMessageParam]
    : messages;

  const toolCall = msg?.tool_calls?.find((t) => t.type === "function");
  if (toolCall && toolCall.type === "function") {
    let args: unknown = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      args = {};
    }
    const destination = await resolveWithSkill(
      deps.skills,
      toolCall.function.name,
      args,
      input.data,
      input.meta,
    );
    return {
      destination,
      toolName: toolCall.function.name,
      assistantText: msg?.content ?? undefined,
      messages: updated,
    };
  }

  return {
    destination: noMatchDestination(input.data, input.meta),
    assistantText: msg?.content ?? undefined,
    messages: updated,
  };
}
