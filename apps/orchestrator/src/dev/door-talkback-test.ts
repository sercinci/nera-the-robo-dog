// Manual talk-back check + usage example for @nera/door-intercom.
// On the next buzz it plays a spoken clip back to the door so you can confirm
// (standing at the street panel) that two-way audio works.
//
// Run (token from the ring fork's .env):
//   RING_REFRESH_TOKEN=... tsx src/dev/door-talkback-test.ts
import { DoorIntercom } from "@nera/door-intercom";
import { createReadStream } from "node:fs";

const GREETING = "/tmp/nera-door-greeting.mp3";

const token = process.env.RING_REFRESH_TOKEN;
if (!token) {
  console.error("ERR: set RING_REFRESH_TOKEN");
  process.exit(1);
}

const door = new DoorIntercom(
  { refreshToken: token, maxCallMs: 90_000 },
  {
    onReady: (d) =>
      console.log(`✅ armed on "${d.name}". Buzz the panel and listen for Nera.`),
    onDing: () => console.log("🔔 buzz received — opening call..."),
    onCallStart: async () => {
      console.log("📞 call live — streaming greeting to the door speaker...");
      try {
        await door.speak(createReadStream(GREETING));
        console.log("▶️  greeting finished playing. Call stays open (multi-turn).");
        // Demonstrates the call survives speak(): end it explicitly.
        door.endCall();
      } catch (e) {
        console.error("❌ speak failed:", e);
      }
    },
    onAudioChunk: () => {}, // (visitor audio would go to STT here)
    onCallEnd: ({ inboundPackets }) =>
      console.log(`📞 call ended (${inboundPackets} inbound packets).`),
    onError: (e) => console.error("❌", e.message),
  },
);

door.start().catch((e) => {
  console.error("❌ start failed:", e.message);
  process.exit(1);
});
