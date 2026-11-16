# Weekly theme catalog

Source of truth for the copy of every bundled weekly theme. Mirrors `apps/admin/src/lib/themes.ts` (portal picker and defaults), `APPROVED_THEME_URLS` in `gcp/functions/src/modules/challenges/domain/challengeDraft.ts` (server allow-list) and `DIPThemeCatalog` in `ui/Packages/DIPCore` (iOS). A theme is stored only as `coverImageURL = catalog://theme/<key>`; artwork, accent and copy live in each client. Adding a key means all three places plus the art (`apps/admin/public/img/themes/<key>.png`, iOS image set `Mascot<Key>`).

Themes are broad on purpose: each one holds many different events and activities an organizer can attach, like Fitness holds classes, walks, runs and lifting. US spelling, friendly workplace voice, no medical claims. The title is shown in capitals (Fjalla One). The first goal unit is the default.

## Themes

| Key | Title | Challenge description | Goal units (default first) | Default goal | Default tag | Accent | iOS asset |
|---|---|---|---|---|---|---|---|
| `fitness` | Fitness | Get moving with coworkers this week: try a class, a walk or a workout together and log it. | workouts, classes, walks, minutes | 3 | Fitness | #FB72E4 | Mascot |
| `outdoors` | Outdoors | Get outside with coworkers this week: try a hike, a kayak trip or a picnic in the park, and log your outing. | outings, hours | 2 | Outdoors | #6BFF9B | MascotOutdoors |
| `food` | Food & Drink | Gather around good food with coworkers this week: cook together, host a potluck or hit a coffee or lunch spot, and log it. | gatherings, meals, tastings | 2 | Food & Drink | #FFCC3E | MascotFood |
| `arts` | Arts & Crafts | Make something with coworkers this week: paint, throw a pot, knit, take photos or craft, then share what you made. | creations, projects, sessions | 2 | Arts & Crafts | #FF7C73 | MascotArts |
| `games` | Games | Play together this week: board games at lunch, a trivia night, a video game round or an escape room, and log each game. | games, sessions, rounds | 3 | Games | #7B88FA | MascotGames |
| `music` | Music | Make some noise with coworkers this week: sing karaoke, jam together, catch a concert or build a shared playlist, and log it. | songs, events, sessions | 3 | Music | #FB72E4 | MascotMusic |
| `learning` | Learning | Learn something new with coworkers this week: join a workshop, read a chapter for book club, practice a language or host a lunch-and-learn, and log it. | lessons, sessions, chapters | 3 | Learning | #66D9FF | MascotLearning |
| `volunteering` | Volunteering | Give back with coworkers this week: join a cleanup, a food bank shift or a charity drive, or mentor someone, and log your time. | shifts, hours, events | 1 | Volunteering | #6BFF9B | MascotVolunteering |
| `wellness` | Wellness | Recharge with coworkers this week: try yoga, a guided meditation or a stretch break, and log each session. | sessions, minutes, breaks | 3 | Wellness | #66D9FF | MascotWellness |

## Submission prompts and picker blurbs

| Key | What a member posts | Why it's fun (admin picker) |
|---|---|---|
| `fitness` | Share a photo or a few words about your workout, class or walk. | Classes, walks, runs, lifting sessions or a lunchtime stretch: anything that gets people moving counts. |
| `outdoors` | Share a photo of where you went and who came along. | Hikes, kayak or paddleboard trips, picnics, park days and beach or lake afternoons all fit. |
| `food` | Share a photo of the table, the dish or the spot you tried. | Potlucks, cooking nights, baking swaps, tastings and coffee or lunch crawls are all fair game. |
| `arts` | Post a photo of your creation, finished or not. | Painting nights, pottery classes, knitting circles, photo walks and craft swaps give everyone a way in. |
| `games` | Share a photo or the score from your game. | Board game lunches, trivia nights, video game tournaments, puzzles and escape rooms are easy to host. |
| `music` | Share a song, a clip or a photo from your music moment. | Karaoke nights, jam sessions, concert outings and team playlists work for singers and listeners alike. |
| `learning` | Share one thing you learned and where you learned it. | Workshops, book clubs, language practice and lunch-and-learns let anyone teach or tag along. |
| `volunteering` | Share a photo or a few words about what you helped with. | Cleanups, food bank shifts, mentoring and charity drives turn a good deed into a team outing. |
| `wellness` | Share how you took your pause or a tip that helped you reset. | Yoga, meditation, stretch breaks, sleep tips and hydration challenges all count as a reset. |

## Notes

- Accent hexes for the seven new themes are placeholders until the art agent's `apps/admin/public/img/themes/ACCENTS.md` is updated for this set; Fitness uses `challengeAccent`. Title text is white on a dark or mid-tone accent and ink on a light one (luminance rule in `DIPHomeChallengeSection.swift`).
- Tags: the portal's mock tag catalog includes all nine names. Production tags are managed by the trusted tag tooling (`tags/`); the seed script `scripts/seed-weekly-theme.mjs` aborts if no tag with the theme's name exists.
- Unknown keys resolve to a neutral gray title-only card on every client, so an older app never breaks on a newer theme.
