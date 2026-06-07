# Handover — Nera the Robo Dog (Skills-Team)

**Erstellt:** 2026-06-07 (Neuanlage, da die vorherige Handover-Datei versehentlich
gelöscht wurde — Inhalt aus Working-Tree + Git-Historie rekonstruiert)
**Anlass:** Lead Developer ist heute aus privaten Gründen ausgestiegen — Gerald
übernimmt den Code direkt.

---

## 1. Wo wir stehen (Kurzfassung)

Branch `robo-dog-fix_Version_Gerald`, letzter Commit `73764b0` (fix(door): make
Ring intercom return-audio audible + multi-turn robust). Seitdem liegt
**ungecommiteter Working-Tree-Stand** vor — siehe Abschnitt 2. Beide Pakete
(`@nera/door-intercom`, `@nera/orchestrator`) typecheck aktuell sauber.

**Großes Thema der letzten Sessions:** Der Ring-Türlautsprecher war stumm. Das
ist gelöst (Speaker-Open + Multi-Turn + Serialisierung + Echo-Fix, alle live
verifiziert — siehe Git-Historie von `73764b0`).

**✅ ENTSCHIEDEN (2026-06-07, Punkt H aus Abschnitt 7):** Ein zwischenzeitlicher,
NICHT live verifizierter Umbau der Audio-Pipeline (durchgehender Stream statt
Pro-Turn-Stream + Silence-Padding + `TURN_GAP_MS` 700→2000ms) wurde **verworfen**
— Gerald hat bestätigt, dass die Konversation mit dem bewährten `73764b0`-Setup
bereits funktioniert, und ist meiner Empfehlung gefolgt, kein unnötiges Risiko
kurz vor der Demo einzugehen. `door-bridge.ts`/`door-intercom/index.ts` sind
jetzt wieder exakt auf `73764b0`-Stand (siehe Abschnitt 2a) — der einzige
verbleibende Working-Tree-Unterschied zu `73764b0` in diesen beiden Dateien ist
der neue, additive `human_fallback`-Branch (5 Zeilen).

---

## 2. Working-Tree-Stand (NICHTS committet — bitte vor weiterem Edit sichern/committen)

```
 M apps/kiosk/public/kiosk.js
 M apps/orchestrator/src/intercom/door-bridge.ts   (jetzt: 73764b0 + nur human_fallback-Branch)
 M skills/instructions.md
 M skills/registry.ts
?? skills/human-fallback.ts
?? assets/offene fixes.xlsx
 D HANDOVER_CLAUDE_CODE.md          (Stub-Datei, redirectete auf log/…)
 D log/HANDOVER_CLAUDE_CODE.md      (DIESE Datei — neu angelegt)
```

(`packages/door-intercom/index.ts` ist nach dem Revert wieder **byte-identisch**
zu `73764b0` — kein Diff mehr, daher nicht mehr in der Liste.)

### 2a. Audio-Pipeline-Umbau — ✅ VERWORFEN (Entscheidung 2026-06-07, Punkt H)

**Was es war:** Ein zwischenzeitlicher Umbau ersetzte die bewährte
Pro-Turn-Stream-Architektur (`73764b0`: pro Sprech-Turn ein neuer
`PassThrough`-WAV-Stream → `door.speak()` → seriell über `speakQueue`,
`activateSpeaker()` intern re-assertet) durch einen **einzigen durchgehenden
Stream über die gesamte Call-Dauer** plus eine "Audio-Uhr" (`logicalAudioMs`),
aktive Stille-Injektion (`pushSilence()`, `setInterval` alle 100ms), `public`
gemachtes `activateSpeaker()` mit direktem Bridge-Aufruf pro Turn, und
`TURN_GAP_MS` 700 → 2000ms.

**Warum verworfen:** Gerald hat bestätigt, dass die Konversation mit dem
**bewährten, live verifizierten** `73764b0`-Setup bereits funktioniert (siehe
Abschnitt 3). Der Umbau war damit eine unbelegte Komplexitätssteigerung kurz vor
der Demo — höheres Risiko (Timing-Drift, Knackser an Audio/Stille-Übergängen)
ohne nachgewiesenen Nutzen. Klare Empfehlung war daher: verwerfen statt live
verifizieren.

**Durchgeführt:**
- `apps/orchestrator/src/intercom/door-bridge.ts` → 1:1 auf `73764b0`-Stand
  zurückgesetzt (Pro-Turn-Stream, `TURN_GAP_MS = 700`, `DEBUG_WAV`/`pcmToWav`/
  `micSent` wieder aktiv — die "toten Code"-Funde aus der vorigen Session sind
  damit wieder lebendiger, bewährter Code, keine Archivierung nötig), danach
  der `human_fallback`-Branch erneut ergänzt (additiv, 5 Zeilen, siehe 2b).
- `packages/door-intercom/index.ts` → `activateSpeaker()` zurück auf `private`
  (1-Zeilen-Diff rückgängig gemacht — die `doSpeak()`-interne Re-Assertion aus
  `73764b0` übernimmt die Funktion wieder, kein externer Zugriff mehr nötig).
- Verifiziert: `git diff 73764b0 -- door-bridge.ts` zeigt nur noch den
  `human_fallback`-Branch (+5 Zeilen); `door-intercom/index.ts` hat **keinen**
  Diff mehr zu `73764b0`. Beide Pakete typecheck clean (`tsc --noEmit` exit 0).

**Resteffekt auf Abschnitt 9 (Dead-Code-Archiv-Plan, siehe unten):** Die
Einträge `DEBUG_WAV`/`pcmToWav` und `micSent` sind hinfällig — sie sind durch
den Revert wieder Teil des aktiven, bewährten Codes. Nur `this.speaking` in
`DoorIntercom` bleibt als eigenständiger, vom Umbau unabhängiger
Archiv-Kandidat übrig (siehe aktualisierte Tabelle in Abschnitt 9).

**🔲 Trotzdem offen:** Live-Verifikation steht weiterhin aus — aber jetzt nur
noch für den NEUEN Teil (`human_fallback`-Branch), nicht mehr für die gesamte
Audio-Pipeline. Das reduziert das Verifikations-Risiko erheblich.

### 2b. Neuer Skill: `human_fallback`

`skills/human-fallback.ts` (neu, additiv):
- Zod-Args: leeres Objekt (`{}`)
- `name: "human_fallback"`, gibt `MatchResult` mit `destinationId: null`,
  `confidence: 1.0`, `status: "resolved"` zurück
- in `skills/registry.ts` importiert und ans Ende des `skills`-Arrays gehängt

Verdrahtung an drei weiteren Stellen:
- **`door-bridge.ts`** `onToolCall`: neuer Branch `if (name === "human_fallback")`
  → setzt `broker.doorState("fallback")` und antwortet mit der Standardphrase
  *"Let me get someone from the team to help you — just one moment!"*
- **`apps/kiosk/public/kiosk.js`**: neuer Tool-Handler `human_fallback` im
  `sessionCommon().clientTools`-Objekt (für den Browser-/Kiosk-Pfad, analog zum
  Türpfad) — zeigt einen Snack "Calling a staff member…" und Status-Text
  "Calling human assistance…"
- **`skills/instructions.md`**: Formulierungen präzisiert — aus "→
  `human_fallback`" wurde an mehreren Stellen "→ trigger `human_fallback`" /
  "When you trigger the `human_fallback` tool (or if you are unable to trigger
  it), say exactly this phrase…" — macht den Skill-Aufruf für den Agenten
  expliziter (vorher klang es eher wie eine Beschreibung des Resultats, jetzt
  wie eine Handlungsanweisung).

**⚠️ Lücke gefunden (noch offen, nicht behoben):** `onDoorState()` in
`apps/kiosk/public/kiosk.js:90-109` hat KEINEN `else if (state === "fallback")`-
Zweig. D.h. wenn die Bridge `broker.doorState("fallback")` sendet, passiert auf
dem Display **visuell nichts** — der State wird zwar broadcastet, aber die UI
reagiert nicht darauf (kein Snack/Status-Update auf dem Kiosk-Screen für den
Türpfad-Fallback-Fall). Müsste ergänzt werden, falls das visuelle Feedback am
Screen gewünscht ist.

---

## 3. Was bereits FERTIG und live verifiziert ist (aus `73764b0` und davor)

Alle vier Tür-Audio-Probleme aus den Vortagen sind gelöst (Details siehe
`git show 73764b0:log/HANDOVER_CLAUDE_CODE.md` falls nötig — Volltext der alten
Session-Logs ist in der Git-Historie von Commit `73764b0` erhalten, auch wenn
die Datei seitdem gelöscht wurde):

1. **Lautsprecher öffnet sich** — `activateSpeaker()` sendet `camera_options
   {stealth_mode:false}` ungated (Root Cause: Fork-`activateCameraSpeaker()`
   ist auf nie-feuerndes `camera_connected`-Event gated)
2. **Multi-Turn hörbar** — Re-Assert pro Turn (Ring mutet nach jeder Äußerung neu)
3. **Back-to-Back-Drop behoben** — `speak()` serialisiert über `speakQueue`
4. **Echo/Selbst-Trigger behoben** — `speakingCount`-Zähler statt Boolean in
   der Bridge (Mikro bleibt stumm bis ALLE gequeueten Äußerungen fertig sind)

---

## 4. Offene Punkte (Priorität für sauberen Demo-Flow)

Diese drei waren bereits am Ende der letzten Session als TODO markiert und sind
**weiterhin offen** (nicht Teil des aktuellen Working-Tree-Umbaus):

**A) Konversations-Lifecycle / Call-Ende** — Hauptthema.
Nach `open_door` (Aufgabe erledigt) läuft der Call aktuell bis zum
`maxCallMs`-Hard-Cap (120s) weiter; Nera loopt mit "Are you still there?" auf
echte Stille. Geralds Entscheidung dazu (Session-Log `73764b0`,
06:35-Eintrag): **Call nach `open_door` beenden, ABER Destination auf dem
Yodeck-Screen halten** (nicht sofort idle). Konkret zu bauen in
`apps/orchestrator/src/intercom/door-bridge.ts`:
1. Im `open_door`-Tool-Handler nach erfolgreichem `unlock()`: kurze
   Verzögerung (Nera Abschiedszeile sprechen lassen), dann `door.endCall()`.
2. **Display-Idle vom Call-Ende entkoppeln:** `onCallEnd` ruft aktuell sofort
   `broker.broadcastIdle()` (Zeile 232) — das würde die gerade gezeigte
   Destination sofort wieder löschen. Stattdessen: letzte gezeigte Destination
   tracken und erst nach `DISPLAY_HOLD_MS` (Vorschlag ~60s) idlen.

**B) Agent-Prompt** (`skills/instructions.md`) — Nera soll nach erledigtem
Anliegen abschließen statt zu loopen ("Are you still there?").

**C) Taub-Fenster bei `visitor: "..."`** — unbestätigt, ob Ursache das
half-duplex-Mikro-Timing (`TURN_GAP_MS` + ffmpeg-Drain) oder ConvAI-VAD ist.
Mit `DOOR_DEBUG=1` messen: `captured`/`dropped`-Chunks pro Fenster.
**Achtung:** `TURN_GAP_MS` wurde im aktuellen Working-Tree-Stand von 700ms auf
2000ms erhöht — das verändert dieses Mess-Setup direkt. Vor der nächsten Messung
prüfen, ob das beabsichtigt war oder das Taub-Fenster-Problem eher verschärft.

**D) Yodeck-Ist-Stand** — noch nicht geprüft, ob der physische Screen als
Web-Page-Player auf die Live-Display-URL eingerichtet ist. Test-Optionen:
- Display-URL im Browser öffnen (welche Route, aus `apps/orchestrator/src/index.ts`
  + `apps/kiosk` ableiten) → Destination triggern → erscheint sie?
- Yodeck-REST via `tsx apps/orchestrator/src/dev/yodeck-push.ts screens` / `list`
- Einmaliges Dashboard-Setup (Screen → Web-Page-Player → Display-URL), dann
  visuell am echten TV prüfen (kein direkter Remote-Zugriff auf den TV möglich)

---

## 5. Run / Verify — Befehle

```powershell
# Voller Lauf (in apps/orchestrator)
$env:DEBUG="ring"; $env:DOOR_DEBUG="1"; corepack pnpm dev

# Typecheck
corepack pnpm -F @nera/door-intercom exec tsc --noEmit
corepack pnpm -F @nera/orchestrator exec tsc --noEmit

# Offline-Audio-Diagnose (ohne Hardware)
corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag.ts
corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag-rtp.ts
corepack pnpm -F @nera/orchestrator exec vitest run src/audio/wav.diag.test.ts

# Live-Probe (Hardware vor Ort, einmal klingeln)
$env:DEBUG="ring"; corepack pnpm -F @nera/orchestrator exec tsx src/dev/door-diag-live.ts

# Yodeck-CLI
corepack pnpm -F @nera/orchestrator exec tsx src/dev/yodeck-push.ts screens
corepack pnpm -F @nera/orchestrator exec tsx src/dev/yodeck-push.ts list
```

Hinweise: `pnpm` nur via `corepack` (nicht im PATH); Node v22 aktiv (Projekt
will `>=24`, läuft aber mit Warning). Ring-Refresh-Token wird automatisch nach
`.ring-token` persistiert (gitignored) und beim Start bevorzugt geladen.

### ⚠️ Logging fürs Debugging — für die neue Chat-Session wichtig

Drei unabhängig zuschaltbare Logging-Ebenen, alle env-gated (Standardlauf bleibt
unverändert, kein Risiko durch Aktivieren):

| Env-Var | Was es zeigt | Wo im Code |
|---|---|---|
| `$env:DEBUG="ring"` | Rohes `ring-client-api`-Protokoll-Logging (Sessions, WebRTC-Connection-State, `camera_options`, etc.) — **das einzige Fenster in die Ring-Lowlevel-Kommunikation** | kommt aus dem vendored Fork `packages/ring-client-api/`, kein eigener Code |
| `$env:DOOR_DEBUG="1"` | Pro Turn: `🎤 MUTE — captured N chunks during last listen window` / `🎤 OPEN — dropped N chunks while Nera spoke` (Mikro-Mute-Diagnose, `micSent`/`micDropped`-Zähler) | [door-bridge.ts:35](apps/orchestrator/src/intercom/door-bridge.ts:35), Logs bei [:101-103](apps/orchestrator/src/intercom/door-bridge.ts:101) und im `finally` von `doSpeak` |
| (immer an) `log.debug`/`log.info` | Turn-Events (`[door] 🔊 streaming…`, `[door] ✓ finished speaking…`, `[door] Nera: "…"`, `[door] visitor: "…"`), State-Wechsel (`doorState`), Tool-Calls | durchgehend in [door-bridge.ts](apps/orchestrator/src/intercom/door-bridge.ts) |

**Zusätzlich, für gezielte Audio-Verifikation ohne Hardware:**
- `DEBUG_WAV = "/tmp/nera-door-last.wav"` ([door-bridge.ts:22](apps/orchestrator/src/intercom/door-bridge.ts:22))
  — nach jedem Turn wird der an die Tür gestreamte (verstärkte) Audio-Ausschnitt
  als WAV gedumpt (`pcmToWav` in `endTurn()`). Direkt anhörbar zur Verifikation,
  *was die Tür tatsächlich empfängt* (inkl. Gain-Boost).
- Offline-Testsets (kein Buzz nötig): `door-diag.ts` (ffmpeg-Encode-Matrix),
  `door-diag-rtp.ts` (RTP-Mux-Probe), `wav.diag.test.ts` (WAV/Amplify-Unit-Test)
  — siehe Befehle oben.
- `door-diag-live.ts` für gezielte Live-A/B-Proben am Gerät (z. B. Ton vor/nach
  einem Signalling-Schritt, um Hypothesen zu bestätigen — siehe wie das Root
  Cause des Lautsprecher-Problems damit gefunden wurde, Git-Historie `73764b0`).

**Empfehlung für die neue Session:** beim Befehl aus der ersten Zeile oben
direkt mit beiden Flags starten:
```powershell
$env:DEBUG="ring"; $env:DOOR_DEBUG="1"; corepack pnpm dev
```
Das gibt von Anfang an die volle Sicht auf Ring-Protokoll + Mikro-Timing +
Turn-Events — deutlich effizienter, als nachträglich neu zu starten, wenn ein
Problem auftritt.

---

## 6. Wichtige Constraints (für jeden Coder an diesem Repo)

- **`contracts/` nicht ändern** — Spine-Team-Eigentum
- **Skills geben nur `MatchResult` zurück** — nie Screen-Content, nie Sprache
- **Nur `zod` + Node stdlib in Skills** — keine externen Deps
- **Kein Credentials-Commit** — `.env.example` für Secrets
- **Ring-Refresh-Token rotiert** — `onRefreshToken`-Callback ist verdrahtet, nicht anfassen
- **Tür-Pfad: public agent, kein xi-api-key** — sonst 403 von ElevenLabs
- **Half-Duplex** — Türmikrofon muss gemutet sein während Nera spricht
- **Vendored Fork** (`packages/ring-client-api/`) NICHT anfassen — `VENDORED.md` beachten

---

## 7. Action-Plan: Offene Fixes (Geralds Review aus `assets/offene fixes.xlsx`, Stand 2026-06-07)

Gerald hat die offenen Punkte aus Abschnitt 4 priorisiert/präzisiert und als Excel
zurückgegeben (`assets/offene fixes.xlsx`, Spalte „erwartete aktion"). Das ist
jetzt die verbindliche Zielbeschreibung. Reihenfolge unten = Abarbeitungsreihenfolge.
**Architektur-Frage zu `open_door` (instructions.md:51 vs. Tool-Wiring) wird
bewusst NICHT in diesem Durchgang behandelt — klären wir, nachdem A–H erledigt sind.**

### A) Call-Ende nach `open_door`
**Geralds Vorgabe:** Bevor die Tür geöffnet wird, soll Nera fragen, ob noch eine
Frage offen ist. Sagt der Besucher sinngemäß „nein, danke" → Tür öffnen UND
danach den Call beenden.

**Schritte:**
1. `skills/instructions.md` (Skills-Team-Bereich, aber hier dokumentiert): vor
   dem `open_door`-Tool-Call eine Abschluss-Frage einbauen, z. B. *"Before I let
   you in — is there anything else I can help you with?"* Erst bei Verneinung
   ruft Nera `open_door` auf.
2. `apps/orchestrator/src/intercom/door-bridge.ts` — `open_door`-Branch
   ([:147-158](apps/orchestrator/src/intercom/door-bridge.ts:147)): nach
   erfolgreichem `unlock()` + `respond(...)` eine kurze Verzögerung einbauen
   (Nera ihre Abschiedszeile sprechen lassen — z. B. via `setTimeout` nach dem
   `onAgentResponse`/`speakingCount`-Zyklus), dann `door.endCall()`.

**Status:** 🔲 offen — Schritt 1 ist Prompt-Arbeit (Skills-Team/Gerald), Schritt 2 Code (Bridge).

### B) Display-Hold beim Call-Ende
**Geralds Vorgabe:** Display soll nach Call-Ende noch **100 Sekunden** stehen
bleiben (nicht die von mir vorgeschlagenen ~60s), damit sich der Besucher
zurechtfindet.

**Schritte:**
1. `door-bridge.ts` — Konstante `DISPLAY_HOLD_MS = 100_000` einführen (analog zu
   `TURN_GAP_MS`/`DOOR_GAIN` am Dateikopf).
2. Letzte gezeigte Destination + ein „shownThisCall"-Flag auf Bridge-Ebene tracken
   (gesetzt im `show_destination`-Branch, [:159-171](apps/orchestrator/src/intercom/door-bridge.ts:159)).
3. `onCallEnd` ([:216-233](apps/orchestrator/src/intercom/door-bridge.ts:216)):
   `broker.broadcastIdle()` NICHT mehr sofort aufrufen, sondern — falls eine
   Destination gezeigt wurde — erst nach `DISPLAY_HOLD_MS` per `setTimeout`.
   `broker.doorState("idle")` kann sofort bleiben (betrifft nur den
   Gesprächsstatus, nicht den Screen-Inhalt).

**Status:** 🔲 offen, baut auf A auf (A definiert den Moment, ab dem der Hold-Timer startet).

### C) Agent-Prompt-Loop-Fix
**Geralds Vorgabe:** *„siehe #A"* — wird durch die Lösung von A miterledigt: die
Abschluss-Frage + das gezielte Call-Ende ersetzen das ungebremste
„Are you still there?"-Loopen für den „Aufgabe erledigt"-Fall.

**Status:** ✅ wird durch A gelöst — kein separater Schritt nötig.

### D) Inaktivitäts-/Taub-Fenster-Logik (ersetzt die reine `TURN_GAP_MS`-Frage)
**Geralds Vorgabe (sehr konkret, das ist jetzt die Spezifikation):**
- Es soll **ausschließlich natürliche Sprache** erkannt/angenommen werden.
- Pausen von **2–10 Sekunden** = normales Nachdenken → tolerieren, Hintergrundrauschen ignorieren, NICHT eingreifen.
- Pause **> 10 Sekunden** → Nera fragt einmal nach, ob der Besucher noch da ist.
  - kommt eine Antwort → Konversation normal fortsetzen.
  - kommt keine Antwort → *"Vielen Dank für Ihren Besuch, bis zum nächsten Mal"* sagen und die Konversation/den Call beenden.

**Wichtige Klarstellung — zwei verschiedene Zeitfenster nicht verwechseln:**
- `TURN_GAP_MS` (aktuell 2000ms, [door-bridge.ts:33](apps/orchestrator/src/intercom/door-bridge.ts:33))
  beschreibt, wie lange NACH Neras letztem Audio-Chunk gewartet wird, bis ihr Turn
  als beendet gilt und das Mikro wieder öffnet — das ist NICHT dasselbe wie die
  2–10s-Denkpause, die der Besucher NACH Mikro-Öffnung braucht, um zu antworten.
- Geralds Spezifikation betrifft die zweite Achse: Inaktivität auf Besucherseite,
  nachdem das Mikro offen ist.

**Schritte:**
1. Neue Konstante in `door-bridge.ts`, z. B. `INACTIVITY_PROMPT_MS = 10_000` —
   getrennt von `TURN_GAP_MS` (nicht wiederverwenden/überladen).
2. Inaktivitäts-Timer auf Bridge-Ebene: läuft, solange das Mikro offen ist
   (`speakingCount === 0`) und kein Visitor-Audio committed wird; bei Ablauf
   → einmaliger „Sind Sie noch da?"-Prompt auslösen (Cap analog `REPROMPT_CAP`
   im Kiosk-Pfad, [session.ts:13](apps/orchestrator/src/session.ts:13) — hier
   z. B. `STILL_THERE_CAP = 1`).
3. Bleibt die Antwort aus → Abschiedszeile + `door.endCall()` (gleicher
   Mechanismus wie in A, ggf. wiederverwendbar).
4. `skills/instructions.md` entsprechend ergänzen: die exakte Abschiedsformel
   *"Vielen Dank für Ihren Besuch, bis zum nächsten Mal"* (oder die EN-Variante
   dazu, je nach Sprache des Agenten) als verbindlichen Wortlaut hinterlegen —
   genau wie es bei `human_fallback` schon gemacht wurde ([instructions.md:42-44](skills/instructions.md:42)).
5. **`TURN_GAP_MS` separat behandeln:** unverändert lassen oder mit
   `DOOR_DEBUG=1`-Messdaten (captured/dropped chunks) evidenzbasiert justieren —
   NICHT im selben Zug wie die Inaktivitäts-Logik anfassen, sonst vermischen
   sich zwei unabhängige Variablen und Messergebnisse werden uninterpretierbar.

**Status:** 🔲 offen — eigenständiger Implementierungsblock, klar spezifiziert.

### E) Yodeck-Setup
**Geralds Vorgabe:** *„wird gerade aufgesetzt"* — läuft bereits bei Gerald/Team.

**Status:** ℹ️ kein Code-Task — nur beobachten, ob nach Abschluss ein
`YodeckSink`-Wiring (`apps/orchestrator/src/sinks/yodeck.ts`) nötig wird oder der
Web-Page-Player-Ansatz (Live-Display-URL) reicht.

### F) `notify_host`
**Geralds Vorgabe:** Erst prüfen, ob der Tool-Call überhaupt gebraucht wird und
wofür — vor jeder Implementierung Rücksprache halten und abklären.

**Schritte (kein Code — Klärungsbedarf dokumentieren):**
1. Frage ans Spine-/Skills-Team: Wird `notify_host` für die Demo gebraucht
   (z. B. für Use-Case 2 „Known + no appointment", siehe `CLAUDE.md` Tabelle
   „Visitor Types & Scenarios")? Wer baut's, wenn ja?
2. **Bis zur Klärung:** `instructions.md:30`/`:83` NICHT so stehen lassen, wie
   es ist — siehe Match-Analyse Punkt 2 unten (das Prompt verspricht aktuell
   eine Aktion, die ins Leere läuft).

**Status:** 🔲 offen — Entscheidung liegt nicht bei mir, nur Vorbereitung/Dokumentation.

### G) `human_fallback`-UI am Kiosk
**Geralds Vorgabe:** *„schlag einen Lösungsansatz vor"*

**Mein Vorschlag:** In `onDoorState()` ([kiosk.js:90-109](apps/kiosk/public/kiosk.js:90))
einen Zweig analog zu den bestehenden States ergänzen:

```js
else if (state === "fallback") {
  els.status.textContent = "Calling a staff member…";
  showSnack("🙋 Getting someone from the team…", { kind: "fallback" });
}
```

Davor kurz prüfen, ob `showSnack` den `kind`-Parameter generisch für Styling
nutzt (wie bei `kind: "ring"`, [kiosk.js:95](apps/kiosk/public/kiosk.js:95)) —
falls ja, optional einen passenden visuellen Stil (Farbe/Icon) dafür ergänzen,
sonst reicht der Text-Snack allein. Kleine, risikoarme Änderung — eine Zeile
Logik, kein Pipeline-Eingriff.

**Status:** 🔲 offen — Vorschlag steht, Umsetzung ist trivial (~5 Minuten).

### H) Audio-Pipeline-Umbau — ✅ ERLEDIGT (verworfen, 2026-06-07)
**Geralds Vorgabe:** *„mit dem aktuellen Setup funktioniert die Unterhaltung.
Überprüfen ob dieser Fix noch notwendig ist."* → *„folge deiner Empfehlung für H"*

**Entscheidung:** Gerald ist meiner Empfehlung gefolgt — **Umbau verworfen**,
nicht committet. Das committete Setup aus `73764b0` (Pro-Turn-Stream +
`activateSpeaker()` intern in `doSpeak()`) funktioniert bereits live; die
Begründung für den riskanteren Umbau entfällt damit.

**Durchgeführt** (Details in Abschnitt 2a):
- `door-bridge.ts` 1:1 auf `73764b0` zurückgesetzt + `human_fallback`-Branch
  erneut ergänzt (chirurgischer Revert, kein `git checkout` der ganzen Datei,
  damit die additive `human_fallback`-Änderung erhalten bleibt)
- `door-intercom/index.ts` → `activateSpeaker()` zurück auf `private`
  (die direkte Bridge-Aufruf-Variante war nur für den verworfenen Umbau nötig;
  `doSpeak()` re-assertet weiterhin intern, [door-intercom/index.ts:239](packages/door-intercom/index.ts:239))
- `git diff 73764b0` zeigt jetzt nur noch +5 Zeilen (`human_fallback`-Branch) in
  `door-bridge.ts` und **keinen** Diff mehr in `door-intercom/index.ts`
- Beide Pakete typecheck clean (`tsc --noEmit` exit 0 für `@nera/door-intercom`
  und `@nera/orchestrator`)

**Status:** ✅ erledigt — verworfen, Code wieder auf bewährter `73764b0`-Basis +
additivem `human_fallback`. Damit ist auch der Ausgangspunkt für A/D (beide
ändern `door-bridge.ts` weiter) jetzt der bewährte, nicht der experimentelle Stand.

---

## 8. Match-Analyse: „Unausgereift formulierte Stellen" vs. Geralds Fixes

Abgleich der vier zuvor identifizierten Prompt-/Doku-Schwächen gegen die
Fix-Vorgaben A–H:

**1. Widerspruch `open_door`-Guardrail (`instructions.md:51`) vs. Tool-Wiring**
→ ❌ **NICHT gelöst, bewusst zurückgestellt.** Gerald hat das explizit auf
„nach Erledigung dieser Punkte" verschoben — keine Aktion in diesem Durchgang.

**2. `notify_host`-Formulierung verspricht eine Aktion, die nicht existiert (`instructions.md:30`/`:83`)**
→ ❌ **NICHT gelöst — F) klärt nur den Entscheidungsprozess, nicht das Prompt-Risiko.**
Solange die Rücksprache (F) läuft, bleibt der Agent mit einer Anweisung
unterwegs, die ihn ein Versprechen machen lässt, das technisch ins Leere läuft
(„Unknown tool"-Antwort, [door-bridge.ts:177](apps/orchestrator/src/intercom/door-bridge.ts:177)).
**Mein Lösungsvorschlag (Übergangslösung bis F geklärt ist):** `instructions.md:30`
von *"say you will notify the host; trigger `notify_host`"* auf einen
tatsächlich existierenden Pfad umstellen — z. B. *"say you will let the front
desk know, and call `human_fallback`"* — oder ersatzlos auf eine reine
verbale Zusicherung ohne Tool-Trigger reduzieren, bis (und falls) `notify_host`
gebaut wird. Referenz in `:83` entsprechend mitziehen.

**3. `TURN_GAP_MS`-Begründung vage/unbelegt ("bridge pauses … ignore background noise")**
→ 🟡 **Teilweise adressiert — aber nicht direkt, sondern indirekt über D), und das
muss man sauber auseinanderhalten.** Geralds Spezifikation in D) liefert eine
klare, belastbare Verhaltensbeschreibung — aber für ein **anderes** Zeitfenster
(Besucher-Inaktivität nach Mikro-Öffnung), nicht für `TURN_GAP_MS` (Neras
Sprechpausen-Erkennung). Die ursprüngliche Vagheit rund um `TURN_GAP_MS = 2000`
bleibt damit bestehen. **Mein Vorschlag:** `TURN_GAP_MS` von der
Inaktivitäts-Logik strikt trennen (siehe Schritt D.5) und seinen Wert separat
mit `DOOR_DEBUG=1`-Messdaten belegen oder — pragmatisch für die Demo — auf den
zuletzt verifizierten Wert (700ms) zurücksetzen, sofern dafür kein dokumentierter
Grund für die Erhöhung auf 2000ms vorliegt.

**4. Inkonsistente `human_fallback`-Trigger-Sprache im Prompt ("→ X" vs. "→ trigger X")**
→ ❌ **NICHT durch A–H adressiert** — keiner der Punkte zielt auf diese Stelle.
**Mein Lösungsvorschlag:** kleiner, risikoarmer Cleanup-Pass über
`skills/instructions.md` — durchgehend "→ trigger `human_fallback`" verwenden
(Zeilen [53](skills/instructions.md:53), [72](skills/instructions.md:72),
[108](skills/instructions.md:108), [133](skills/instructions.md:133) angleichen).
Lässt sich am besten zusammen mit den D)-Prompt-Ergänzungen in einem Rutsch
erledigen, um nicht zweimal in dieselbe Datei zu müssen.

---

## 9. Toter Code → Archiv-Plan (aktualisiert nach H-Revert)

Durch den Revert von H (Abschnitt 2a) hat sich die Lage geändert: Zwei der drei
ursprünglich gefundenen toten Stellen sind jetzt **wieder aktiver, bewährter
Code** (Teil des `73764b0`-Standes) — keine Archivierung nötig. Übrig bleibt
**ein** echter, vom Umbau unabhängiger Archiv-Kandidat:

| Code | Fundort | Status nach Revert | Archiv-Notiz |
|---|---|---|---|
| `DEBUG_WAV`-Konstante + `pcmToWav`-Import | [door-bridge.ts:22](apps/orchestrator/src/intercom/door-bridge.ts:22), [:18](apps/orchestrator/src/intercom/door-bridge.ts:18) | ✅ wieder lebendig (Teil von `73764b0`) — **kein Archiv-Kandidat mehr** | — entfällt |
| `micSent`-Zähler | [door-bridge.ts:61](apps/orchestrator/src/intercom/door-bridge.ts:61) | ✅ wieder lebendig (Teil von `73764b0`) — **kein Archiv-Kandidat mehr** | — entfällt |
| `this.speaking`-Feld in `DoorIntercom` | [door-intercom/index.ts:66](packages/door-intercom/index.ts:66), Schreibstellen [:171](packages/door-intercom/index.ts:171), [:238](packages/door-intercom/index.ts:238), [:253](packages/door-intercom/index.ts:253), [:263](packages/door-intercom/index.ts:263) | ❌ weiterhin tot — **einziger verbleibender Kandidat** | War schon in `73764b0` tot (unabhängig vom verworfenen Umbau — wird nirgends gelesen, vermutlich Rest aus der Zeit vor `speakQueue`, früher wohl ein Guard wie `if (this.speaking) throw`). Reaktivierung: nur falls man zurück zu einem werfenden statt queuenden `speak()` möchte — dann als Bedingung in `speak()` vor dem Queue-Append wieder nutzen. |

**Vorschlag fürs Archiv (nur noch für `this.speaking` relevant):** ein
Markdown-Archiv unter `packages/door-intercom/_archive/` mit Snippet + Fundort +
Grund + Reaktivierungs-Hinweis — git-Historie bleibt ohnehin als Fallback
bestehen, das Archiv ist die schnell auffindbare Referenz für „was war das
nochmal und warum raus". Lohnt sich für ein einzelnes totes Feld eher als
schlanke Notiz denn als eigenes Verzeichnis — z. B. ein kurzer Kommentarblock
direkt im Archiv-File statt eigener Ordnerstruktur.

---

## 10. Empfohlene Abarbeitungsreihenfolge

1. ~~H zuerst entscheiden~~ → ✅ **erledigt** (verworfen, Abschnitt 2a/7 — Basis
   ist jetzt wieder der bewährte `73764b0`-Stand + `human_fallback`).
2. ~~Dead-Code-Archivierung~~ → auf **einen** Kandidaten geschrumpft
   (`this.speaking`, Abschnitt 9) — kann bei Gelegenheit erledigt werden, ist
   aber nicht mehr blockierend für irgendetwas anderes.
3. **G** (Kiosk-UI-Fix) — trivial, unabhängig, kann jederzeit zwischengeschoben werden.
4. **A + D zusammen umsetzen** — beide ändern `door-bridge.ts` substanziell
   (Call-Ende-Logik, Inaktivitäts-Timer, neue Prompt-Passagen) und hängen
   thematisch zusammen (beide enden in `door.endCall()` + Abschiedszeile).
   C löst sich dabei automatisch mit. **Ausgangsbasis ist jetzt der bewährte
   Code — geringeres Risiko als noch vor dem H-Revert.**
5. **B** (Display-Hold) — baut auf dem Call-Ende-Mechanismus aus A auf.
6. **Match-Analyse-Fixes** (Abschnitt 8, Punkte 2–4) — Prompt-Cleanup in
   `instructions.md`, am besten in einem Rutsch mit den D)-Prompt-Ergänzungen.
7. **F** — keine Code-Aktion, nur Rücksprache anstoßen (kann parallel zu allem
   anderen laufen).
8. **E** — nur beobachten, kein eigener Schritt.
9. **Architektur-Frage `open_door`** (Match-Analyse Punkt 1) — erst danach,
   wie von Gerald vorgegeben.

**Nächster sinnvoller Schritt für die neue Debugging-Session:** direkt mit **G**
(triviale UI-Ergänzung) oder **A+D** (Kernstück der Demo-Reife) starten — beide
Wege sind jetzt ohne den Umbau-Unsicherheitsfaktor begehbar.

---

## 11. Session-Log

### [2026-06-07 ~10:15] Handover neu erstellt (Datei war versehentlich gelöscht)
- Alte Handover-Datei (`log/HANDOVER_CLAUDE_CODE.md`) wurde von Gerald
  versehentlich gelöscht; Originaltext aus `git show 73764b0:log/HANDOVER_CLAUDE_CODE.md`
  rekonstruierbar (vollständige Session-Logs zur Tür-Audio-Diagnose bleiben dort
  in der Git-Historie erhalten).
- Diese Datei fasst den AKTUELLEN Working-Tree-Stand zusammen (uncommitted
  Audio-Pipeline-Umbau + neuer `human_fallback`-Skill), da der Lead Developer
  heute kurzfristig ausgestiegen ist und Gerald den Code direkt übernimmt.
- Beide Pakete typecheck clean (`@nera/door-intercom`, `@nera/orchestrator`).
- **Wichtigste Erkenntnis für Gerald:** Der aktuelle Working-Tree-Stand enthält
  einen NICHT verifizierten Architekturwechsel der Türlautsprecher-Pipeline
  (durchgehender Stream + Silence-Padding + `TURN_GAP_MS` 700→2000ms). Vor dem
  nächsten Live-Test einmal bewusst gegenhören, ob das eine Verbesserung oder
  eine Verschlechterung ist — ggf. mit `git diff` / `git stash` vergleichbar
  machen.
- Status: ✅ Handover aktuell · 🔲 Gerald: Working-Tree-Audio-Umbau live verifizieren, dann A/B/C/D (Abschnitt 4) angehen

### [2026-06-07 ~11:30] Action-Plan aus `assets/offene fixes.xlsx` eingearbeitet
- Gerald hat die offenen Punkte (vorige Session, Abschnitt 4) priorisiert/präzisiert
  als Excel zurückgegeben — jetzt verbindliche Zielbeschreibung, eingearbeitet in
  neue Abschnitte 7–10 (Action-Plan A–H, Match-Analyse gegen die vier
  Prompt-Schwächen, Dead-Code-Archiv-Plan, empfohlene Reihenfolge).
- **Wichtigste neue Erkenntnisse:**
  - **A**: Vor `open_door` soll Nera aktiv nachfragen ("sonst noch was?"), erst
    bei Verneinung Tür öffnen + Call beenden — das ist mehr als nur ein
    `endCall()`-Hinterherschieben, braucht eine Prompt-Ergänzung.
  - **D** ersetzt die reine `TURN_GAP_MS`-Frage durch eine präzise
    Inaktivitäts-Spezifikation (2–10s tolerieren, >10s nachfragen, danach
    Abschied + Ende) — **auf einer anderen Zeitachse** als `TURN_GAP_MS`
    (Besucher-Stille nach Mikro-Öffnung vs. Neras Sprechpausen-Erkennung).
    Beide nicht vermischen — sonst werden künftige `DOOR_DEBUG`-Messungen
    uninterpretierbar.
  - **H**: Gerald bestätigt, dass die Konversation mit dem AKTUELLEN (uncommitted)
    Setup bereits funktioniert — meine Empfehlung ist trotzdem, den riskanteren
    Umbau zu verwerfen und auf der bewährten `73764b0`-Basis weiterzuarbeiten,
    weil A/D ohnehin tiefe Eingriffe in dieselbe Datei brauchen.
- Match-Analyse-Ergebnis: von 4 identifizierten Prompt-Schwächen wird durch A–H
  **keine vollständig automatisch gelöst** — #1 ist bewusst zurückgestellt
  (Gerald), #2–#4 brauchen jeweils einen eigenen kleinen Cleanup-Schritt
  (Lösungsvorschläge in Abschnitt 8 exakt formuliert).
- Status: 🔲 Gerald: Reihenfolge aus Abschnitt 10 abarbeiten, beginnend mit der
  H-Entscheidung (Umbau verwerfen?) als Weichenstellung für alles Weitere

### [2026-06-07 ~12:00] H-Revert durchgeführt — Audio-Pipeline-Umbau verworfen
- Gerald ist meiner Empfehlung zu H gefolgt: der unkommittete
  Audio-Pipeline-Umbau (durchgehender Stream + Silence-Padding + `TURN_GAP_MS`
  700→2000ms) wurde **chirurgisch zurückgesetzt** — `door-bridge.ts` 1:1 auf
  `73764b0` zurück, dann der additive `human_fallback`-Branch (5 Zeilen) erneut
  ergänzt; `door-intercom/index.ts` → `activateSpeaker()` zurück auf `private`.
- Verifiziert: `git diff 73764b0 -- door-bridge.ts` zeigt nur noch +5 Zeilen
  (`human_fallback`); `door-intercom/index.ts` hat **keinen** Diff mehr zu
  `73764b0`. Beide Pakete typecheck clean (`tsc --noEmit` exit 0).
- Entscheidung + Durchführung in Abschnitt 2a, 7 (Punkt H) und 9 (Dead-Code-Plan,
  jetzt nur noch `this.speaking` als Kandidat) dokumentiert; Reihenfolge in
  Abschnitt 10 entsprechend aktualisiert.
- Neuer Abschnitt 5 „Logging fürs Debugging" ergänzt — Übersicht über
  `DEBUG=ring`, `DOOR_DEBUG=1`, `DEBUG_WAV`-Dump und die Offline-/Live-
  Diagnose-Skripte, als Startpunkt für die nächste Debugging-Session.
- Status: ✅ H erledigt (verworfen) · 🔲 Gerald: neue Chat-Session für
  Live-Debugging starten — Empfehlung: mit `$env:DEBUG="ring";
  $env:DOOR_DEBUG="1"; corepack pnpm dev` direkt mit voller Logging-Sicht
  beginnen, dann G oder A+D als nächste inhaltliche Schritte (Abschnitt 10)
