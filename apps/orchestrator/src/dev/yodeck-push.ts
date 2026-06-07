/**
 * Manual Yodeck sink CLI — out-of-band screen control (NOT the hot path).
 *
 *   pnpm --filter @nera/orchestrator exec tsx src/dev/yodeck-push.ts <cmd> [args]
 *
 * Commands:
 *   list                      List image media (id, name) — use to fill yodeck-images.ts
 *   screens                   List screens (id, name)
 *   push <key> [min]          Take over the screen with the curated image <key>
 *   push-id <mediaId> [min]   Take over with a raw media id
 *   clear                     End any active takeover
 *
 * Requires YODECK_API_TOKEN and YODECK_SCREEN_ID in .env.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { makeLogger } from "../log.js";
import { yodeckSinkFromEnv } from "../sinks/yodeck.js";
import { IMAGE_MEDIA_IDS } from "../sinks/yodeck-images.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

async function main() {
  dotenv.config({ path: resolve(repoRoot, ".env") });
  const cfg = loadConfig();
  const log = makeLogger(cfg.logLevel);

  const sink = yodeckSinkFromEnv(cfg, IMAGE_MEDIA_IDS, log);
  if (!sink) {
    log.error("Set YODECK_API_TOKEN and YODECK_SCREEN_ID in .env first.");
    process.exit(1);
  }

  const [cmd, arg, arg2] = process.argv.slice(2);
  const min = (v?: string) => (v != null ? Number(v) : undefined);

  switch (cmd) {
    case "list": {
      const imgs = await sink.listImages();
      log.info(`${imgs.length} image(s):`);
      for (const i of imgs) log.info(`  ${i.id}\t${i.name}`);
      break;
    }
    case "screens": {
      const screens = await sink.listScreens();
      for (const s of screens) log.info(`  ${s.id}\t${s.name}`);
      break;
    }
    case "push": {
      if (!arg) throw new Error("usage: push <key> [min]");
      await sink.takeoverKey(arg, { durationMin: min(arg2) });
      break;
    }
    case "push-id": {
      if (!arg) throw new Error("usage: push-id <mediaId> [min]");
      await sink.takeoverMedia(Number(arg), { durationMin: min(arg2) });
      break;
    }
    case "clear":
      await sink.clear();
      break;
    default:
      log.info("commands: list | screens | push <key> [min] | push-id <mediaId> [min] | clear");
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
