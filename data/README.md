# Concierge data — how to populate

Two files, both validated at startup against `contracts/contracts.ts` (Zod). If a file
fails validation the app refuses to start and prints the exact path — so keep them valid.

## `directory.json` — rooms, zones, events

One array of entries. Each entry:

| field          | required | notes                                                                 |
| -------------- | -------- | --------------------------------------------------------------------- |
| `id`           | yes      | stable kebab-case, e.g. `robotics-club`. Used as the FK target.       |
| `label`        | yes      | human name shown/spoken.                                              |
| `aliases`      | no       | **spoken variants** — the more the better for matching accuracy.      |
| `kind`         | yes      | `room` \| `zone` \| `event`.                                          |
| `floor`        | yes      | integer.                                                              |
| `zone`         | no       | free text, e.g. `east-wing`.                                          |
| `pose`         | no       | `{x,y,yaw}` on the Nav2 `map` frame, or `null`. **Leave null until mapped.** |
| `screen`       | yes      | what the display renders — see below.                                 |
| event extras   | no       | `startsAt`/`endsAt` (ISO 8601), `host` (person id) for `kind: event`. |

`screen`: `{ title, subtitle?, routeAssetId?, mapMarker?, accentColor?, mediaId? }`.
`routeAssetId` / `mediaId` reference assets **pre-loaded on the display client** — we send the
id, not the media. Coordinate these ids with the screen team.

## `people.json` — the person directory (arbitrary for the demo)

One array. Each person resolves to a destination via `locatedAt` (and optionally `event`).

| field        | required | notes                                            |
| ------------ | -------- | ------------------------------------------------ |
| `id`         | yes      | kebab-case.                                      |
| `name`       | yes      | full name.                                       |
| `aliases`    | no       | first names / nicknames the visitor might say.   |
| `role`       | no       | shown in the spoken reply / screen subtitle.     |
| `locatedAt`  | no       | FK -> `directory.json` id. `null` if unknown.    |
| `event`      | no       | FK -> `directory.json` id (a time-bound event).  |

## Matching tips (this is where the accuracy score lives)

- **Aliases are everything.** Add every plausible spoken form. The agent matches against
  `label` + `aliases`, so a missing alias = a miss.
- Keep `id`s stable once set — they are referenced by people, events, and screen assets.
- Hot-reload is on: save the file and the running app picks up changes (no restart).
