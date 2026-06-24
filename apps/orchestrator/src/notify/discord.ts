/**
 * Discord webhook notifier — used for live human-escalation pings (human_fallback).
 *
 * A webhook is the simplest path: POST { content } to an incoming-webhook URL the
 * staff channel exposes. No bot, no OAuth. Set DISCORD_WEBHOOK_URL in .env; when
 * unset the call is a no-op so the rest of the flow is unaffected.
 */
import type { Logger } from "../log.js";

/** Post a plain message to a Discord channel via its incoming webhook. Best-effort:
 *  never throws into the caller — escalation must not break the conversation. */
export async function notifyDiscord(
  webhookUrl: string | undefined,
  content: string,
  log?: Logger,
): Promise<void> {
  if (!webhookUrl) return; // feature disabled — no URL configured
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900) }), // Discord hard-limits at 2000 chars
    });
    if (!res.ok) log?.warn(`[discord] webhook returned ${res.status}`);
    else log?.info("[discord] human-escalation ping sent");
  } catch (e) {
    log?.warn(`[discord] notify failed: ${(e as Error).message}`);
  }
}
