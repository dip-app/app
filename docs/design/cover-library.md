# Event cover library

A curated, licensed catalog of event cover images. Organizers choose from it in the admin portal, and Dipbot picks one for AI drafts. Status: seed catalog and tooling in place (14 covers); the licensed photo set (target 15 per theme, about 170 images) is acquired with the workflow below.

## Purpose

- Every event can have a good-looking cover without an organizer uploading anything.
- One source of truth: `apps/admin/public/img/covers/manifest.json`. The admin picker, the server index used by Dipbot, the email/share renditions and iOS all derive from it.
- Text-only metadata (label, tags, themes, mood) lets Dipbot choose by words alone, with no image tokens.

## URL schemes

| Scheme | Meaning |
| --- | --- |
| `catalog://default/<category>` | Legacy, unchanged. Category is fitness, outdoors, hiking, games or cooking. Still valid everywhere. |
| `catalog://cover/<key>` | New. Key matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters, and must exist in the manifest. |
| Weekly-theme art keys | Challenge art, unchanged and separate from this catalog. |

The five legacy seed entries keep their legacy URL as their canonical `url`. All other entries use `catalog://cover/<key>`.

Hosted files (copied to the site root by `scripts/build-site.sh`, which copies `apps/admin/public/img`):

- Full: `https://letsdip.work/img/covers/<key>.webp`, up to 1200 px wide, 16:10 (3:2 allowed), used by iOS and the admin preview.
- Thumb: `https://letsdip.work/img/covers/thumbs/<key>.webp`, 400 px wide, used by the admin grid.
- JPEG: `https://letsdip.work/img/covers/jpg/<key>.jpg`, 960 px wide, used only for emails (Outlook has no WebP) and the share page `og:image`.

## Manifest schema

`manifest.json` has `version` (1), `baseURL`, `themeDefaults` (theme to key, one per theme, the entry must list that theme) and `covers`. Each cover:

| Field | Rule |
| --- | --- |
| `key`, `url` | Key per the regex above; url is the legacy URL for the five legacy keys, otherwise `catalog://cover/<key>`. |
| `kind` | `photo` or `illustration`. |
| `file`, `thumb`, `jpeg` | `<key>.webp`, `thumbs/<key>.webp`, `jpg/<key>.jpg`. |
| `width`, `height`, `orientation` | Measured from the file; aspect 16:10 or 3:2 within 1 percent; `landscape`. |
| `themes` | 1 to 3 of outdoors, food, arts, games, music, learning, volunteering, wellness, fitness. |
| `tags` | 2 to 12 lowercase activity words; multiword allowed ("board games"). |
| `mood` | 0 to 3 of calm, energetic, social, cozy, festive, focused, playful. |
| `season` | 1 to 4 of spring, summer, autumn, winter, any. |
| `label` | Up to 40 characters; shown in the UI and given to Jev as the choice text. |
| `alt` | Required, up to 160 characters. |
| `autoPick` | Optional boolean, default true when missing. `false` means the cover is never offered to Dipbot automatic picks but stays selectable manually in the picker. Import accepts an optional `autoPick` column or field (`false`, `0` or `no`). The generated index carries `autoPick?: boolean`, emitted only when false. |
| `dominantColor` | `#RRGGBB`, computed from the full image. |
| `bytes`, `sha256` | Per-rendition byte sizes and the SHA-256 of the full WebP (dedupe key). |
| `license` | `type`, `source`, `sourceURL`, `creator`, `creatorURL`, `notes`. |

The server reads a generated, text-only index (`gcp/functions/src/modules/covers/domain/catalog.generated.ts`) and never reads image files at runtime.

## Size budget

| Rendition | Limit | Average target |
| --- | --- | --- |
| Full WebP | 150 KB | about 90 KB |
| Thumb WebP | 30 KB | about 18 KB |
| JPEG | 100 KB | about 70 KB |

That is roughly 180 KB per image, so 200 images is about 36 MB. The hard cap for the whole covers directory is 40 MB (`covers:validate` fails above it). The import script lowers WebP quality adaptively until each file fits and rejects sources that would need upscaling below 960 px wide.

## License rules

- Allowed sources: Pexels, Unsplash and Pixabay, fetched through their official APIs, with photographer, photographer URL and photo URL stored in `license`. These types require `sourceURL` and `creator`; validation fails without them.
- `dip-original`: art made in this repository (the nine illustrations).
- `prototype-unconfirmed`: the five legacy photos from the Figma prototype. Their rights are unconfirmed, so they are to be replaced once licensed photos are in; keep them until then so existing events keep working.
- No scraping, no image search engines, no AI-generated photo look-alikes presented as real, no images without a recorded source.
- Never commit API keys. `PEXELS_API_KEY` lives in the dip-app/secrets repo and is read from the environment only.

## Workflow to add images

1. Fetch candidates: `PEXELS_API_KEY=... npm run covers:fetch:pexels -- --theme food` (optionally `--shot <id>`, `--candidates 2`, `--dry-run`). It reads `scripts/covers/query-plan.json`, calls `https://api.pexels.com/v1/search` with an Authorization header, paces itself (one call per 20 s, at most 150 per run, stops when X-Ratelimit-Remaining is low), and stages landscape photos plus a `labels.json` in `.covers-staging/` (gitignored, outside `public/`). Progress is saved, so a rerun continues.
2. Review the staging folder by eye. Delete weak files and their `labels.json` rows; improve `label`, `alt` and `tags`; set `gravity` (attention, entropy, centre, north, south, east, west) for tricky crops. Avoid recognizable faces in close-up, visible brands and text.
3. Import: `npm run covers:import -- --src .covers-staging/images --labels .covers-staging/labels.json` (add `--dry-run` first). It crops to 16:10, writes the three renditions under `apps/admin/public/img/covers/`, skips duplicate keys and identical images, refuses rows without license or alt, and merges the manifest sorted by key. CSV labels also work (list columns separated by `;` or `|`).
4. Validate: `npm run covers:validate -- --min-per-theme 15` (default minimum is 1).
5. Regenerate the server index: `npm run covers:index` (`-- --check` in CI).
6. Open a PR with the new images, manifest and generated index together. Keep PRs large enough to be worth reviewing (see the contributor guidance), for example one theme per PR.

`npm run covers:seed` rebuilds the 14 seed entries (5 legacy photos and 9 theme illustrations on the accent from `apps/admin/public/img/themes/ACCENTS.md`). `npm run test:covers` runs the tooling tests in temporary directories.

## How Dipbot picks

1. Lexical shortlist: tokens from the title (double weight) and the first 600 characters of the description are stemmed and scored against tags, label and alt words, and the event theme; the top 20 (15 to 25 is configurable) go forward, always including the theme default. Keys already used in the same batch are penalized so drafts stop sharing one photo.
2. Jev Choice: one choice question over the text labels of the shortlist (label, tags, theme per key). No image tokens are sent.
3. Fallbacks, in order: OpenAI cheap model, the deterministic best lexical match, the theme default, and finally `catalog://default/outdoors`.

The server does not narrow eagerly. With fewer than about 60 eligible covers (config `maxCandidates`) all of them are sent to Jev as one-line text labels (`key: theme | tags | short alt`). Larger libraries keep a broad ranked set plus a generous tail and diverse picks, and split into at most two Jev Choice calls (theme group, then cover) when over the per-call option limit. The only hard exclusions are orientation and `autoPick: false`; fallbacks are unchanged.

Server details live with the covers module; this document only records the contract with the catalog.

## Deploy note

New image files only reach users after a hosting deploy of the site (`scripts/build-site.sh` output). The server index is compiled into the functions bundle, so a functions deploy is also needed before Dipbot or approval checks can use new keys. Deploy hosting first, then functions, so a key is never accepted before its files exist.

## Query plan

`scripts/covers/query-plan.json` is the machine-readable plan used by `fetch-pexels.ts`. It lists 171 shots with a target of one library image each; the fetch script stages two candidates per shot so a reviewer can choose. Target counts: outdoors 25, food 22, arts 18, games 18, music 16, learning 16, volunteering 16, wellness 18, fitness 22. Each row gives the subcategory, the label shown in the picker, the Pexels query string and the planned tags.

### Outdoors (25)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| hiking | Forest trail hike | friends hiking forest trail | hiking, trail, forest |
| hiking | Mountain summit views | hikers mountain summit view | hiking, summit, mountains |
| hiking | Group hike | group of friends hiking together | hiking, group walk, friends |
| hiking | Autumn woods walk | walking autumn forest path | hiking, autumn, woods, walking |
| hiking | Sunrise on the ridge | sunrise hike mountain ridge | hiking, sunrise, ridge |
| water | Kayaking on a lake | two people kayaking calm lake | kayaking, paddling, lake |
| water | Morning canoe trip | canoe river morning mist | canoeing, river, paddling |
| water | Paddleboarding at sunset | stand up paddle board sunset | paddleboarding, sup, sunset |
| water | Day out sailing | friends sailing boat sunny day | sailing, boat, sea |
| picnic | Picnic in the park | friends picnic blanket park | picnic, park, blanket |
| picnic | Picnic basket spread | picnic basket food on grass | picnic, basket, food |
| picnic | Lakeside picnic | picnic by the lake | picnic, lake, lunch |
| beach | Beach day with friends | friends relaxing on beach | beach, friends, sand |
| beach | Beach volleyball | beach volleyball game | beach volleyball, beach, sport |
| beach | Sunset beach walk | walking beach sunset | beach, sunset, walk |
| camping | Tent camping | tent camping forest | camping, tent, forest |
| camping | Campfire evening | friends around campfire night | campfire, camping, night |
| camping | Lakeside camp morning | camp by lake morning | camping, lake, morning |
| park | Park lawn games | friends playing frisbee park | frisbee, park, lawn games |
| park | Chat on a park bench | people talking park bench | park, bench, chat |
| park | City park stroll | walking city park trees | park, stroll, walking |
| gardening | Planting seedlings | planting seedlings garden | gardening, planting, seedlings |
| gardening | Garden harvest | harvesting vegetables garden | gardening, harvest, vegetables |
| cycling | Country road ride | cycling country road group | cycling, bike ride, road |
| cycling | City bike ride | friends riding bikes city | cycling, bikes, city |

### Food (22)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| cooking | Cooking class | cooking class kitchen group | cooking class, cooking, kitchen |
| cooking | Handmade pasta | making fresh pasta by hand | pasta, cooking, handmade |
| cooking | Chopping vegetables | chopping vegetables kitchen friends | cooking, vegetables, chopping |
| cooking | Stir fry night | stir fry wok cooking | stir fry, cooking, wok |
| cooking | Pizza making | making pizza dough toppings | pizza, cooking, dough |
| baking | Cookie baking | baking cookies kitchen | baking, cookies, dessert |
| baking | Bread baking | kneading bread dough | baking, bread, dough |
| baking | Cupcake decorating | decorating cupcakes | baking, cupcakes, decorating |
| potluck | Potluck table | potluck dinner table dishes | potluck, dinner, shared meal |
| potluck | Dinner with friends | friends dinner party table | dinner party, friends, dinner |
| potluck | Team lunch | team lunch together table | team lunch, lunch, colleagues |
| coffee | Coffee catch-up | friends coffee cafe | coffee, cafe, catch up |
| coffee | Latte art | barista latte art | coffee, latte art, barista |
| coffee | Tea time | afternoon tea table | tea, afternoon tea, cafe |
| brunch | Brunch spread | brunch table spread friends | brunch, breakfast, spread |
| brunch | Pancake breakfast | pancakes breakfast table | pancakes, breakfast, brunch |
| grill | Backyard barbecue | backyard barbecue grill friends | bbq, grill, barbecue |
| grill | Grilled skewers | grilling skewers outdoor | grilling, skewers, bbq |
| grill | Summer cookout | summer cookout party | cookout, bbq, party |
| drinks | Wine tasting | wine tasting glasses friends | wine tasting, wine, drinks |
| drinks | Craft beer flight | craft beer flight tasting | beer tasting, craft beer, drinks |
| drinks | Cocktail making | making cocktails bar | cocktails, mixology, drinks |

### Arts (18)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| painting | Painting at the easel | painting canvas easel studio | painting, canvas, easel |
| painting | Watercolor painting | watercolor painting brushes | watercolor, painting, art |
| painting | Group painting class | group painting class friends | painting class, painting, workshop |
| painting | Mural painting | painting wall mural | mural, painting, street art |
| pottery | Pottery wheel | pottery wheel hands clay | pottery, clay, wheel |
| pottery | Glazing ceramics | glazing ceramic bowls | ceramics, glazing, pottery |
| pottery | Ceramics studio | ceramic studio shelves handmade | ceramics, studio, handmade |
| crafts | Knitting circle | knitting yarn hands | knitting, yarn, crafts |
| crafts | Craft table | craft table supplies scissors paper | crafts, paper craft, diy |
| crafts | Sewing session | sewing machine fabric | sewing, fabric, crafts |
| drawing | Sketchbook drawing | sketching in sketchbook | drawing, sketching, sketchbook |
| drawing | Urban sketching | urban sketching outdoors | urban sketching, drawing, outdoors |
| drawing | Life drawing class | drawing class easels | life drawing, drawing, class |
| photography | Photo walk | photographer camera city walk | photography, photo walk, camera |
| photography | Landscape photography | photographer landscape tripod | photography, landscape, tripod |
| photography | Portrait fun | friends taking portraits camera | photography, portrait, camera |
| lettering | Calligraphy | calligraphy pen ink | calligraphy, lettering, ink |
| lettering | Printmaking | linocut printmaking studio | printmaking, linocut, print |

### Games (18)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| board-games | Board game night | friends playing board game table | board games, game night, friends |
| board-games | Strategy board game | strategy board game pieces | board games, strategy, pieces |
| board-games | Game library shelf | board game shelf collection | board games, game library, shelf |
| board-games | Chess match | chess game players | chess, board games, match |
| board-games | Board game cafe | board game cafe | board games, game cafe, cafe |
| cards | Card game night | friends playing cards table | card games, cards, game night |
| cards | Casual card game | colorful card game hands | card games, uno, cards |
| cards | Shuffling the deck | shuffling deck of cards | card games, shuffle, deck |
| trivia | Pub trivia night | pub quiz night team | trivia, pub quiz, quiz night |
| trivia | Team trivia | quiz team writing answers | trivia, quiz, team |
| trivia | Game show quiz | game show buzzers quiz | quiz, game show, buzzers |
| video-games | Couch video games | friends playing video games couch | video games, console, couch |
| video-games | LAN party | gaming lan party computers | gaming, lan party, pc games |
| video-games | Arcade night | arcade machines friends | arcade, video games, retro |
| puzzles | Jigsaw puzzle | jigsaw puzzle table pieces | puzzles, jigsaw, pieces |
| puzzles | Escape room | escape room puzzle clues team | escape room, puzzles, team |
| tabletop | Tabletop RPG night | dungeons and dragons dice miniatures | tabletop rpg, dice, dungeons and dragons |
| tabletop | Miniature painting | painting miniatures tabletop | miniatures, painting, tabletop |

### Music (16)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| live | Live band on stage | live band stage concert | live band, concert, stage |
| live | Gig crowd | concert crowd hands up | concert, crowd, gig |
| live | Open-air festival | outdoor music festival crowd | festival, open air, concert |
| live | Acoustic set | acoustic live performance small venue | acoustic, live music, performance |
| singing | Karaoke night | friends singing karaoke | karaoke, singing, night out |
| singing | Singing on stage | singer microphone stage | singing, microphone, vocals |
| singing | Open mic night | open mic night performer | open mic, performance, music |
| guitar | Guitar jam | friends jamming guitars | guitar, jam session, friends |
| guitar | Guitar lesson | guitar lesson hands strings | guitar, lesson, strings |
| guitar | Campfire guitar | guitar around campfire | guitar, campfire, singalong |
| choir | Choir rehearsal | choir singing together | choir, singing, rehearsal |
| choir | A cappella group | a cappella group singing | a cappella, choir, harmony |
| drums | Drum circle | drum circle people | drumming, drum circle, percussion |
| drums | Drum kit practice | drummer drum kit | drums, drum kit, practice |
| dance-floor | DJ party | dj booth party lights | dj, party, dance |
| dance-floor | Dance night | people dancing nightclub lights | dancing, dance floor, party |

### Learning (16)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| book-club | Book club | book club discussion friends | book club, books, discussion |
| book-club | Reading nook | reading book cozy armchair | reading, books, cozy |
| book-club | Library afternoon | library bookshelves reader | library, books, reading |
| workshop | Workshop session | workshop whiteboard team sticky notes | workshop, brainstorm, whiteboard |
| workshop | Hands-on workshop | hands on workshop participants table | workshop, hands-on, learning |
| workshop | Skill share | person teaching small group | skill share, teaching, class |
| language | Language exchange | language exchange conversation cafe | language exchange, conversation, languages |
| language | Language flashcards | language learning flashcards notebook | language learning, flashcards, study |
| language | Language class | language class classroom | language class, classroom, learning |
| coding | Coding together | developers coding laptops together | coding, programming, laptops |
| coding | Hackathon | hackathon team laptops | hackathon, coding, team |
| coding | Code on screen | code on laptop screen | coding, code, laptop |
| study | Study group | study group table notebooks | study group, studying, notebooks |
| study | Focused study | student desk notes coffee | studying, notes, desk |
| talks | Talk and lecture | speaker presenting audience | talk, lecture, presentation |
| talks | Lunch and learn | lunch and learn presentation office | lunch and learn, presentation, team |

### Volunteering (16)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| cleanup | Beach cleanup | volunteers beach cleanup | beach cleanup, volunteering, cleanup |
| cleanup | River cleanup | volunteers cleaning river bank trash | river cleanup, volunteering, litter |
| cleanup | Neighborhood litter pick | litter picking neighborhood volunteers | litter picking, cleanup, neighborhood |
| cleanup | Park cleanup | park cleanup volunteers bags | park cleanup, volunteering, community |
| community-garden | Community garden | community garden volunteers planting | community garden, gardening, volunteering |
| community-garden | Building raised beds | building raised garden beds volunteers | raised beds, garden, building |
| community-garden | Garden with kids | children gardening volunteers school | kids, garden, volunteering |
| food-bank | Food bank sorting | volunteers sorting food donations | food bank, donations, volunteering |
| food-bank | Serving community meals | volunteers serving meal community kitchen | community meal, serving, volunteering |
| food-bank | Food drive | food drive boxes volunteers | food drive, donations, community |
| trees | Tree planting | volunteers planting trees | tree planting, trees, volunteering |
| trees | Trail maintenance | volunteers trail maintenance forest | trail maintenance, volunteering, forest |
| animals | Shelter dog walk | volunteer walking shelter dog | animal shelter, dog walking, volunteering |
| animals | Shelter cuddles | volunteer with shelter cat | animal shelter, cats, volunteering |
| giving | Charity fundraiser | charity fundraiser event people | fundraiser, charity, community |
| giving | Charity run | charity run volunteers finish | charity run, fundraiser, running |

### Wellness (18)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| yoga | Yoga class | yoga class studio group | yoga, class, studio |
| yoga | Sunrise yoga | yoga outdoors sunrise | yoga, sunrise, outdoors |
| yoga | Yoga on the beach | yoga beach pose | yoga, beach, stretching |
| yoga | Yoga at home | yoga mat living room | yoga, home, mat |
| meditation | Group meditation | group meditation sitting circle | meditation, mindfulness, group |
| meditation | Meditating in nature | meditation in nature forest | meditation, nature, mindfulness |
| meditation | Quiet meditation | meditation cushion candle | meditation, candle, quiet |
| spa | Spa day | spa relaxation towels candles | spa, relaxing, self care |
| spa | Sauna | wooden sauna | sauna, relaxing, wellness |
| stretching | Stretching class | stretching class mats | stretching, mobility, class |
| stretching | Recovery session | foam roller recovery | recovery, foam rolling, mobility |
| mindful-walk | Mindful forest walk | mindful walk forest path | mindful walk, forest, walking |
| mindful-walk | Breathing break | breathing exercise outdoors | breathwork, breathing, mindfulness |
| mindful-walk | Lunchtime walk | lunchtime walk park colleagues | lunch walk, walking, wellness |
| slow-living | Tea ritual | tea ritual teapot cups | tea, ritual, slow living |
| slow-living | Herbal tea break | herbal tea cozy blanket | herbal tea, cozy, relaxing |
| journaling | Journaling | journaling notebook pen coffee | journaling, notebook, reflection |
| journaling | Gratitude journal | gratitude journal writing | gratitude, journaling, mindfulness |

### Fitness (22)

| Subcategory | Shot | Query | Tags |
| --- | --- | --- | --- |
| running | Group run | group of runners park | running, group run, park |
| running | Trail run | trail running forest | trail running, running, forest |
| running | Morning city run | runner city morning | running, morning, city |
| running | Race start | race start line runners | race, running, start line |
| gym | Weight training | gym weights training | weights, gym, strength |
| gym | Kettlebell workout | kettlebell workout | kettlebell, strength, workout |
| gym | Workout buddies | friends working out gym | workout buddies, gym, training |
| group-class | Group fitness class | group fitness class studio | group fitness, class, workout |
| group-class | HIIT circuit | hiit circuit training | hiit, circuit training, workout |
| group-class | Outdoor bootcamp | outdoor bootcamp fitness group | bootcamp, outdoors, fitness class |
| spin | Spin class | spin class cycling studio | spin class, cycling, indoor cycling |
| spin | Cycling training | cyclists training road | cycling, training, road bike |
| swimming | Swimming laps | swimmer pool laps | swimming, pool, laps |
| swimming | Open water swim | open water swimming lake | open water, swimming, lake |
| pilates | Pilates reformer | pilates reformer studio | pilates, reformer, core |
| pilates | Pilates mat class | pilates mat class group | pilates, mat, core |
| boxing | Boxing training | boxing bag training gloves | boxing, gloves, training |
| boxing | Kickboxing class | kickboxing class pads | kickboxing, martial arts, class |
| climbing | Climbing gym | indoor climbing wall | climbing, bouldering, climbing gym |
| climbing | Rock climbing | outdoor rock climbing | rock climbing, climbing, outdoors |
| team-sports | Pickup football | friends playing football pitch | football, soccer, pickup game |
| team-sports | Basketball game | basketball game court friends | basketball, court, team sport |
