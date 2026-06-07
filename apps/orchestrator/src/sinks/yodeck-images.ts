/**
 * Curated image registry for the Yodeck sink: a stable key -> Yodeck media id.
 *
 * Images are created ONCE in Yodeck (upload via the Yodeck UI, or the dev CLI),
 * then referenced here by a friendly key. The sink never creates/uploads media on
 * the hot path — it only takes over the screen with one of these ids.
 *
 * Discover ids for real media with:
 *   pnpm --filter @nera/orchestrator exec tsx src/dev/yodeck-push.ts list
 */
export type ImageRegistry = Record<string, number>;

export const IMAGE_MEDIA_IDS: ImageRegistry = {
  // Fill in once the images exist in Yodeck, e.g.:
  // welcome: 1125,
  // closed:  1126,
};
