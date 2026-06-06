// © Gerald Pögl / Hunter-ID MemoryBlock BG FlexCo (FN 658892i)
//
// agent.ts — core LLM loop.
// Converts skills → Anthropic tools, runs the conversation, calls handlers,
// returns a Destination-ready MatchResult.

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AnySkill, MatchResult, SkillCtx } from "../../../contracts/skill.js";
import type { DirectoryEntry, Person } from "../../../contracts/contracts.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap for voice latency

// ── Skill → Anthropic Tool ────────────────────────────────────────────────────

function skillToTool(skill: AnySkill): Anthropic.Tool {
  const schema = zodToJsonSchema(skill.parameters, { target: "openApi3" });
  return {
    name: skill.name,
    description: skill.description,
    input_schema: schema as Anthropic.Tool["input_schema"],
  };
}

// ── Agent session ─────────────────────────────────────────────────────────────

export interface AgentInput {
  sessionId: string;
  transcript: string;            // committed STT text from the visitor
  skills: AnySkill[];
  directory: DirectoryEntry[];
  people: Person[];
  systemPrompt: string;
}

export interface AgentOutput {
  match: MatchResult;
  reply: string;                  // spoken response for TTS
  timings: Record<string, number>; // stage → epoch ms
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const { sessionId, transcript, skills, directory, people, systemPrompt } = input;
  const timings: Record<string, number> = {};
  timings.agentStartAt = Date.now();

  // Build SkillCtx — shared across all handler calls in this session
  const ctx: SkillCtx = {
    directory,
    people,
    session: { id: sessionId, transcript },
    log: (stage) => { timings[stage] = Date.now(); },
  };

  const tools = skills.map(skillToTool);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: transcript },
  ];

  let lastMatch: MatchResult = { destinationId: null, confidence: 0 };
  let reply = "Let me check on that for you.";

  // ── Agentic loop (max 5 turns to prevent runaway) ─────────────────────────
  for (let turn = 0; turn < 5; turn++) {
    timings[`llm_call_${turn}`] = Date.now();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      tools,
      messages,
    });

    timings[`llm_done_${turn}`] = Date.now();

    // Collect tool_use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );

    if (textBlocks.length > 0) {
      reply = textBlocks.map((b) => b.text).join(" ").trim();
    }

    // No tool calls → agent is done
    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      break;
    }

    // Push assistant message
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool call
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      const skill = skills.find((s) => s.name === block.name);
      if (!skill) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: `Unknown skill: ${block.name}` }),
          is_error: true,
        });
        continue;
      }

      try {
        timings[`skill_${block.name}_start`] = Date.now();
        const args = skill.parameters.parse(block.input);
        const result = await skill.handler(args, ctx) as MatchResult;
        timings[`skill_${block.name}_done`] = Date.now();

        // Track the most confident match
        if (result.confidence > lastMatch.confidence) {
          lastMatch = result;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: String(err) }),
          is_error: true,
        });
      }
    }

    // Push tool results for next turn
    messages.push({ role: "user", content: toolResults });
  }

  timings.agentDoneAt = Date.now();

  return { match: lastMatch, reply, timings };
}
