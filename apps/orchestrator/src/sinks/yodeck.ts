/**
 * YodeckSink — best-effort client for the Yodeck Digital Signage REST API.
 *
 * This is a MANUAL sink, off the per-visitor hot path. Per ARCHITECTURE §4.7 the
 * live screen is driven by the WS display page (a Yodeck Web Page player pointed at
 * our display URL); Yodeck's own content-push is too slow for per-visitor updates.
 * So this exists for on-demand, out-of-band use (CLI / dev / an explicit agent
 * action): take over a screen with a pre-created image and clear it again.
 *
 * Images are curated up front in Yodeck and referenced by a stable key -> media id
 * (see ./yodeck-images.ts). We never create or upload media on the hot path.
 *
 * API base: https://app.yodeck.com/api/v2
 * Auth:     header `Authorization: Token <label:value>`  (the token is "label:value").
 * Takeover: PUT /screens/{id}/takeover assigns content and displays it immediately
 *           for `duration` minutes (min 5; omit/null = indefinite). `null` content
 *           ends an active takeover. Verified against the live API.
 */
import type { Config } from "../config.js";
import type { ImageRegistry } from "./yodeck-images.js";

export const YODECK_BASE_URL = "https://app.yodeck.com/api/v2";
export const MIN_TAKEOVER_MIN = 5;

// ---- pure builders (no I/O — unit tested) ----

export function authHeader(token: string): string {
  return `Token ${token}`;
}

interface TakeoverContent {
  source_id: number;
  source_type: "media" | "playlist" | "layout";
  duration?: number;
}

/** Body for PUT /screens/{id}/takeover. `durationMin` omitted => indefinite. */
export function takeoverBody(mediaId: number, durationMin?: number): { takeover_content: TakeoverContent } {
  const content: TakeoverContent = { source_id: mediaId, source_type: "media" };
  if (durationMin != null) content.duration = durationMin;
  return { takeover_content: content };
}

/** Body that ends an active takeover. */
export const CLEAR_BODY = { takeover_content: null } as const;

// ---- sink ----

interface SinkLog {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

export interface YodeckSinkOptions {
  /** API token in "label:value" form (the value of YODECK_API_TOKEN). */
  token: string;
  /** Target screen (monitor) id. */
  screenId: number;
  /** Curated key -> media id map. Defaults to the empty registry. */
  images?: ImageRegistry;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  log?: SinkLog;
}

export interface YodeckSink {
  /** Take over the screen with the image curated under `key`. */
  takeoverKey(key: string, opts?: { durationMin?: number }): Promise<void>;
  /** Take over the screen with a raw media id (escape hatch / discovery). */
  takeoverMedia(mediaId: number, opts?: { durationMin?: number }): Promise<void>;
  /** End any active takeover (revert to the screen's normal content). */
  clear(): Promise<void>;
  /** List image media in the account — use to build the curated registry. */
  listImages(): Promise<Array<{ id: number; name: string }>>;
  /** List screens (monitors) in the account. */
  listScreens(): Promise<Array<{ id: number; name: string }>>;
}

export function createYodeckSink(opts: YodeckSinkOptions): YodeckSink {
  const base = opts.baseUrl ?? YODECK_BASE_URL;
  const images = opts.images ?? {};
  const doFetch = opts.fetchImpl ?? fetch;

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: authHeader(opts.token),
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Yodeck ${method} ${path} -> HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
    }
    return res.json().catch(() => ({}));
  }

  async function takeoverMedia(mediaId: number, o?: { durationMin?: number }): Promise<void> {
    const durationMin = o?.durationMin;
    if (durationMin != null && durationMin < MIN_TAKEOVER_MIN) {
      throw new Error(`Yodeck takeover duration must be >= ${MIN_TAKEOVER_MIN} minutes (got ${durationMin}).`);
    }
    await request("PUT", `/screens/${opts.screenId}/takeover`, takeoverBody(mediaId, durationMin));
    opts.log?.info(`[yodeck] takeover screen ${opts.screenId} -> media ${mediaId}${durationMin ? ` (${durationMin}m)` : " (indefinite)"}`);
  }

  return {
    takeoverMedia,

    async takeoverKey(key, o) {
      const mediaId = images[key];
      if (mediaId == null) {
        const known = Object.keys(images).join(", ") || "(none configured)";
        throw new Error(`Unknown image key "${key}". Known keys: ${known}.`);
      }
      await takeoverMedia(mediaId, o);
    },

    async clear() {
      await request("PUT", `/screens/${opts.screenId}/takeover`, CLEAR_BODY);
      opts.log?.info(`[yodeck] cleared takeover on screen ${opts.screenId}`);
    },

    async listImages() {
      const data = (await request("GET", `/media?media_type=image&limit=200`)) as {
        results?: Array<{ id: number; name: string }>;
      };
      return (data.results ?? []).map((r) => ({ id: r.id, name: r.name }));
    },

    async listScreens() {
      const data = (await request("GET", `/screens?limit=200`)) as {
        results?: Array<{ id: number; name: string }>;
      };
      return (data.results ?? []).map((r) => ({ id: r.id, name: r.name }));
    },
  };
}

/**
 * Build a sink from config, or null if the token/screen aren't configured.
 * Mirrors `doorIntercomFromEnv` — the caller stays a no-op without credentials.
 */
export function yodeckSinkFromEnv(
  cfg: Pick<Config, "yodeckApiToken" | "yodeckScreenId">,
  images: ImageRegistry,
  log?: SinkLog,
): YodeckSink | null {
  if (!cfg.yodeckApiToken || cfg.yodeckScreenId == null) return null;
  return createYodeckSink({ token: cfg.yodeckApiToken, screenId: cfg.yodeckScreenId, images, log });
}
