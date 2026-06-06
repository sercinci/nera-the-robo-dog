/** Minimal leveled logger. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug: (...a: unknown[]) => void;
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

export function makeLogger(level: string = "info"): Logger {
  const min = ORDER[(level as Level)] ?? ORDER.info;
  const at = (l: Level) => (...a: unknown[]) => {
    if (ORDER[l] < min) return;
    const sink = l === "debug" ? console.log : console[l];
    sink(`[${l}]`, ...a);
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}
