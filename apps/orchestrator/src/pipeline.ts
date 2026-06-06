/**
 * One conversational turn: transcript -> agent -> Destination + spoken reply.
 * Shared by the live server (index.ts) and the dev harness. The Destination is
 * emitted to sinks the instant it's resolved; the reply text streams to TTS.
 */
import { readFile } from "node:fs/promises";
import { composeReply, type Destination } from "@nera/contracts";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { skills } from "@nera/skills";
import { runAgent, makeOpenRouterClient, type AgentDeps, type AgentResult } from "./agent/agent.js";
import { buildSystemPrompt } from "./agent/tools.js";
import { Turn } from "./timing.js";
import type { BuildingData } from "./data.js";

export interface TurnResult {
  destination: Destination;
  replyText: string;
  turn: Turn;
  agent: AgentResult;
}

export interface Pipeline {
  data: BuildingData;
  runTurn(
    transcript: string,
    sessionId: string,
    opts?: { history?: ChatCompletionMessageParam[]; signal?: AbortSignal },
  ): Promise<TurnResult>;
}

export async function createPipeline(args: {
  data: BuildingData;
  openrouterApiKey: string;
  model: string;
  instructionsPath: string;
}): Promise<Pipeline> {
  const baseInstructions = await readFile(args.instructionsPath, "utf8");
  const systemPrompt = buildSystemPrompt(baseInstructions, args.data);
  const deps: AgentDeps = {
    client: makeOpenRouterClient(args.openrouterApiKey),
    model: args.model,
    skills,
    systemPrompt,
  };

  return {
    data: args.data,
    async runTurn(transcript, sessionId, opts = {}) {
      const turn = new Turn();
      turn.mark("speechCommitAt");
      const agent = await runAgent(deps, {
        transcript,
        data: args.data,
        meta: { sessionId, transcript },
        history: opts.history,
        signal: opts.signal,
        onResponse: () => turn.mark("agentFirstTokenAt"),
      });
      turn.mark("destinationEmittedAt");
      const replyText = composeReply(agent.destination, args.data);
      return { destination: agent.destination, replyText, turn, agent };
    },
  };
}
