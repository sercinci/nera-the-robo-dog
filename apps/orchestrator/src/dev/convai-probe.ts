// Verifies the server-side ConvaiSession can connect to the public agent (no 403).
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ConvaiSession } from "../agent/convai-ws.js";
import { loadConfig } from "../config.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(repoRoot, ".env") });
const cfg = loadConfig();

const s = new ConvaiSession(
  { agentId: cfg.elevenLabsAgentId!, dynamicVariables: { directory: "Places:\n- Test Room" } },
  {
    onReady: (m) => {
      console.log("✅ agent session READY (connection OK, no 403)");
      console.log("   metadata:", JSON.stringify(m).slice(0, 140));
      s.close();
      process.exit(0);
    },
    onAgentResponse: (t) => console.log("   agent first_message:", t),
    onError: (e) => {
      console.log("❌ error:", e.message);
      s.close();
      process.exit(1);
    },
  },
);
setTimeout(() => {
  console.log("(timeout — no ready/error in 10s)");
  s.close();
  process.exit(2);
}, 10000);
