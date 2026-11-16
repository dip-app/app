# Weekly theme catalog

Source of truth for the copy of every bundled weekly theme. Mirrors `apps/admin/src/lib/themes.ts` (portal picker and defaults), `APPROVED_THEME_URLS` in `gcp/functions/src/modules/challenges/domain/challengeDraft.ts` (server allow-list) and `DIPThemeCatalog` in `ui/Packages/DIPCore` (iOS). A theme is stored only as `coverImageURL = catalog://theme/<key>`; artwork, accent and copy live in each client. Adding a key means all three places plus the art (`apps/admin/public/img/themes/<key>.png`, iOS image set).

US spelling, friendly workplace voice, no medical claims. The title is shown in capitals (Fjalla One). The first goal unit is the default.

## Themes

| Key | Title | Challenge description | Goal units (default first) | Default goal | Default tag | Accent | iOS asset |
|---|---|---|---|---|---|---|---|
| `fitness` | Fitness | Get moving with coworkers this week: try a class, a walk or a workout together and log it. | workouts, classes, walks, minutes | 3 | Fitness | #FB72E4 (challengeAccent) | Mascot |
| `sleep` | Sleep | Rest up with coworkers this week: pick a wind-down routine, trade your best bedtime tips and log each night you stick to it. | nights, hours | 5 | Sleep | #1E212B | MascotSleep |
| `hydration` | Hydration | Sip up with coworkers this week: keep your bottle close, top it off through the day and log every refill. | refills, glasses, bottles | 10 | Hydration | #7B88FA | MascotHydration |
| `mindfulness` | Mindfulness | Take a breather with coworkers this week: step away for a few quiet minutes to stretch, breathe or go screen free, and log each pause. | breaks, minutes, sessions | 5 | Mindfulness | #FFCC3E | MascotMindfulness |
| `outdoors` | Outdoors | Get outside with coworkers this week: take a walk, eat lunch in the park or hold a meeting under the open sky, and log it. | outings, walks, minutes | 3 | Outdoors | #6BFF9B | MascotOutdoors |
| `kindness` | Kindness | Spread some good with coworkers this week: say thanks, lend a hand or leave a kind note, and log each act. | acts, notes, shout-outs | 5 | Kindness | #FF7C73 | MascotKindness |
| `learning` | Learning | Learn something new with coworkers this week: read a chapter, try a short lesson or teach a teammate a trick, and log it. | lessons, sessions, chapters, minutes | 3 | Learning | #66D9FF | MascotLearning |
| `creativity` | Creativity | Make something with coworkers this week: sketch, write, build or craft, then share what you created. | creations, sketches, projects | 3 | Creativity | #FB72E4 | MascotCreativity |
| `cooking` | Cooking | Cook up something with coworkers this week: try a new recipe, pack a homemade lunch or swap dishes, and log every meal. | meals, recipes, dishes | 3 | Cooking | #FFCC3E | MascotCooking |

## Submission prompts and picker blurbs

| Key | What a member posts | Why it's fun (admin picker) |
|---|---|---|
| `fitness` | Share a photo or a few words about your workout, class or walk. | The easiest team win: everyone moves a little, and a lunchtime walk counts. |
| `sleep` | Share your wind-down routine or a bedtime win from this week. | Swapping cozy evening habits gets people talking, and everyone shows up Monday with better stories. |
| `hydration` | Post your water bottle, your favorite refill spot or a fun flavor idea. | Low effort and very visible: desks fill up with bottle photos and friendly refill races. |
| `mindfulness` | Share where you took your pause or what helped you reset. | Short, calm breaks that fit between meetings and give the whole team a reason to slow down together. |
| `outdoors` | Share a photo of where you spent time outside. | Fresh air and new scenery, with great photo moments and easy plans for a team walk. |
| `kindness` | Tell us about a kind act you gave or received, and skip names if you prefer. | Small gestures add up fast, and seeing them posted makes the whole office feel warmer. |
| `learning` | Share one thing you learned or the lesson you tried. | Curiosity is contagious: people compare finds, recommend favorites and teach each other on the spot. |
| `creativity` | Post a photo of your creation, finished or not. | No skills required, just a playful reason to put down the keyboard and show off something handmade. |
| `cooking` | Share a photo of your dish and what you would change next time. | Everyone eats anyway, so recipe swaps and lunch photos turn into the week's best group chat. |

## Notes

- Accent hexes come from `apps/admin/public/img/themes/ACCENTS.md`; Fitness uses `challengeAccent`. Title text is white on sleep, hydration and Fitness, and ink on the lighter accents (including creativity, which reuses the Fitness pink).
- Tags: the portal's mock tag catalog includes all nine names. Production tags are managed by the trusted tag tooling (`tags/`); the seed script `scripts/seed-weekly-theme.mjs` aborts if no tag with the theme's name exists.
- Unknown keys resolve to a neutral gray title-only card on every client, so an older app never breaks on a newer theme.
