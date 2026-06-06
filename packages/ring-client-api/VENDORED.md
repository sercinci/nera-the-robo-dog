# Vendored `ring-client-api` (fork)

This is a **vendored fork** of [`dgreif/ring`](https://github.com/dgreif/ring)
`ring-client-api@14.3.0`, included directly so this repo has no external/local
dependency on a sibling clone. Only the built `lib/` is vendored (the same
output npm would install); the manifest is trimmed to runtime deps.

`@nera/door-intercom` depends on this via `workspace:*`.

## Why a fork

Stock `ring-client-api` supports live audio/video only on `RingCamera`. The
audio-only **Ring Intercom** (`intercom_handset_audio`) has no camera and no
on-demand live view, but a buzzer **ding** provisions a short-lived two-way
audio session. These patches expose that.

## Patches applied (vs upstream v14.3.0)

1. **`streaming/webrtc-connection.ts`**
   - Generalized the constructor's `camera: RingCamera` to a structural
     `StreamingDevice` interface (`{ id; name; isRingEdgeEnabled? }`) so the
     same WebRTC flow can drive an intercom.
   - Added `StreamingConnectionOptions.audioOnly`; when set, `live_view` /
     `stream_options` are sent with `video_enabled: false`.

2. **`streaming/streaming-session.ts`**
   - Same `RingCamera` → `StreamingDevice` generalization.
   - `transcodeReturnAudio` now accepts:
     - `inputStream?: NodeJS.ReadableStream` — piped to ffmpeg stdin (e.g. live
       TTS), so talk-back can stream rather than only play a file;
     - `endCallOnFinish?: boolean` (default `true` = upstream behaviour) — set
       `false` to keep the call open for multi-turn conversation;
     - `onFinished?: () => void` — fires when the utterance finishes playing.

3. **`ring-intercom.ts`**
   - Added `RingIntercom.startLiveCall()` (+ private `createStreamingConnection`)
     that requests a signalling ticket and opens an **audio-only** WebRTC
     session for the intercom's device id.

## Re-generating

The source-level fork lived at `/Users/federico.ercole/personal/ring` during
development. To update: re-apply the patches above to a fresh upstream checkout,
`npm run build` in `packages/ring-client-api`, and copy the resulting `lib/`
here. (Better long-term: upstream the patches or maintain the fork in its own
repo and publish it.)
