import { describe, it, expect, vi } from "vitest";
import {
  authHeader,
  takeoverBody,
  CLEAR_BODY,
  createYodeckSink,
  YODECK_BASE_URL,
} from "./yodeck.js";

/** A fetch stub that records calls and returns a JSON Response-like. */
function stubFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

const SCREEN = 740139;
const TOKEN = "yodeck:secret";

describe("yodeck pure builders", () => {
  it("authHeader uses the Token prefix with the label:value pair verbatim", () => {
    expect(authHeader("yodeck:secret")).toBe("Token yodeck:secret");
  });

  it("takeoverBody includes duration only when provided", () => {
    expect(takeoverBody(1125, 10)).toEqual({
      takeover_content: { source_id: 1125, source_type: "media", duration: 10 },
    });
    expect(takeoverBody(1125)).toEqual({
      takeover_content: { source_id: 1125, source_type: "media" },
    });
  });

  it("CLEAR_BODY nulls the takeover to end a session", () => {
    expect(CLEAR_BODY).toEqual({ takeover_content: null });
  });
});

describe("YodeckSink.takeoverKey", () => {
  it("resolves a curated key to a media id and PUTs a takeover", async () => {
    const fetchImpl = stubFetch(200, { status: "success" });
    const sink = createYodeckSink({
      token: TOKEN,
      screenId: SCREEN,
      images: { welcome: 1125 },
      fetchImpl,
    });

    await sink.takeoverKey("welcome", { durationMin: 10 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${YODECK_BASE_URL}/screens/${SCREEN}/takeover`);
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Token yodeck:secret");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(takeoverBody(1125, 10));
  });

  it("throws on an unknown key without hitting the network", async () => {
    const fetchImpl = stubFetch(200, {});
    const sink = createYodeckSink({ token: TOKEN, screenId: SCREEN, images: {}, fetchImpl });
    await expect(sink.takeoverKey("nope")).rejects.toThrow(/unknown image key/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a duration below the 5-minute minimum", async () => {
    const fetchImpl = stubFetch(200, {});
    const sink = createYodeckSink({ token: TOKEN, screenId: SCREEN, images: { a: 1 }, fetchImpl });
    await expect(sink.takeoverKey("a", { durationMin: 2 })).rejects.toThrow(/>= 5 minutes/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("YodeckSink.clear", () => {
  it("PUTs a null takeover_content", async () => {
    const fetchImpl = stubFetch(200, { status: "success" });
    const sink = createYodeckSink({ token: TOKEN, screenId: SCREEN, fetchImpl });
    await sink.clear();
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${YODECK_BASE_URL}/screens/${SCREEN}/takeover`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(CLEAR_BODY);
  });
});

describe("YodeckSink error handling", () => {
  it("throws with status and body on a non-2xx response", async () => {
    const fetchImpl = stubFetch(401, { detail: "bad token" });
    const sink = createYodeckSink({ token: TOKEN, screenId: SCREEN, images: { a: 1 }, fetchImpl });
    await expect(sink.takeoverKey("a")).rejects.toThrow(/401/);
  });
});

describe("YodeckSink.listImages", () => {
  it("maps the paginated media results to {id,name}", async () => {
    const fetchImpl = stubFetch(200, {
      results: [
        { id: 1, name: "welcome", media_origin: { type: "image" } },
        { id: 2, name: "closed", media_origin: { type: "image" } },
      ],
    });
    const sink = createYodeckSink({ token: TOKEN, screenId: SCREEN, fetchImpl });
    const imgs = await sink.listImages();
    expect(imgs).toEqual([
      { id: 1, name: "welcome" },
      { id: 2, name: "closed" },
    ]);
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/media");
    expect(url).toContain("media_type=image");
  });
});
