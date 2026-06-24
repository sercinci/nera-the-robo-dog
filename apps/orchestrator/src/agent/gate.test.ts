import { describe, it, expect, vi, afterEach } from "vitest";
import { checkGate } from "./gate.js";

const URL = "http://laika.test/api/v1/gate-check";

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkGate", () => {
  it("maps an authorized laika response", async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({ authorized: true, destination_id: "5f-acceleration", reasons: ["R003_in_window"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const d = await checkGate(URL, { visitorName: "Max Berger", host: "Alexander" });
    expect(d.authorized).toBe(true);
    expect(d.destinationId).toBe("5f-acceleration");
    expect(d.reasons).toContain("R003_in_window");
  });

  it("maps a denied laika response", async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({ authorized: false, destination_id: null, reasons: ["R001_no_appointment"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const d = await checkGate(URL, { visitorName: "Hans", host: "Alexander" });
    expect(d.authorized).toBe(false);
    expect(d.reasons).toContain("R001_no_appointment");
  });

  it("fails closed on a non-200 response", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    const d = await checkGate(URL, { visitorName: "Max", host: "Alexander" });
    expect(d.authorized).toBe(false);
    expect(d.reasons).toContain("gate_http_error");
  });

  it("fails closed when the gate is unreachable", async () => {
    mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const d = await checkGate(URL, { visitorName: "Max", host: "Alexander" });
    expect(d.authorized).toBe(false);
    expect(d.reasons).toContain("gate_unreachable");
  });

  it("sends visitor_name, host and a destination_query to laika", async () => {
    const spy = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ authorized: true, reasons: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", spy);
    await checkGate(URL, { visitorName: "Max Berger", host: "Alexander" });
    const init = spy.mock.calls[0]![1];
    const body = JSON.parse(init!.body as string);
    expect(body.visitor_name).toBe("Max Berger");
    expect(body.host).toBe("Alexander");
    expect(body.destination_query).toBe("Alexander"); // host is the thing to authorize
  });
});
