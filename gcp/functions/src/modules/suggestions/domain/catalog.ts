import type { AiEventChoices, GeneratedEventDraft } from "../../../generated/models";
import type { CoverCategory } from "../../ai/domain/vocabulary";

export type AiGoal = AiEventChoices["goal"];
export type AiBudget = AiEventChoices["budget"];
export type AiDaypart = GeneratedEventDraft["suggestedDaypart"];
export type AiVenueType = GeneratedEventDraft["venueType"];

/** The nine weekly-theme keys (apps/admin/public/img/themes/ACCENTS.md). */
export const THEME_KEYS = ["fitness", "outdoors", "food", "arts", "games", "music", "learning", "volunteering", "wellness"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export const THEME_LABELS: Readonly<Record<ThemeKey, string>> = {
  fitness: "Fitness", outdoors: "Outdoors", food: "Food & Drink", arts: "Arts & Crafts", games: "Games",
  music: "Music", learning: "Learning", volunteering: "Volunteering", wellness: "Wellness",
};

/** The catalog tag that names each theme (the first tag of every idea in that theme). */
export const THEME_MAIN_TAG: Readonly<Record<ThemeKey, string>> = {
  fitness: "tag-fitness", outdoors: "tag-outdoors", food: "tag-food", arts: "tag-arts", games: "tag-games",
  music: "tag-music", learning: "tag-learning", volunteering: "tag-volunteering", wellness: "tag-wellness",
};

/** Tags that only hint at a theme; used when no theme tag is present. */
const SECONDARY_THEME: Readonly<Record<string, ThemeKey>> = {
  "tag-cooking": "food", "tag-chill": "wellness", "tag-energetic": "fitness", "tag-hype": "music",
};

/** The theme an event or idea belongs to: a direct theme tag first (in tag order), then a hinting tag, else null. */
export function themeForTags(tagIds: readonly string[]): ThemeKey | null {
  for (const id of tagIds) {
    const key = THEME_KEYS.find(k => THEME_MAIN_TAG[k] === id);
    if (key) return key;
  }
  for (const id of tagIds) {
    const key = SECONDARY_THEME[id];
    if (key) return key;
  }
  return null;
}

export interface IdeaTemplate {
  id: string;
  title: string;
  theme: ThemeKey;
  tagIds: string[];
  goal: AiGoal;
  pitch: string;
  description: string;
  durationMinutes: number;
  groupMin: number;
  groupMax: number;
  /** Typical cost per person in cents, 0..5000. */
  costCents: number;
  budget: AiBudget;
  dayparts: AiDaypart[];
  /** Best days, 1 = Monday to 7 = Sunday. */
  weekdays: number[];
  /** Seasonal fit, northern-hemisphere months 1..12. */
  months: number[];
  isOutdoor: boolean;
  venueType: AiVenueType;
  /** Generic search words, never a business name. */
  venueSearchHint: string;
  coverCategory: CoverCategory;
  /** Easy to run in a busy week. */
  lowKey: boolean;
}

const YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const WARM = [5, 6, 7, 8, 9];
const MILD = [4, 5, 6, 7, 8, 9, 10];
const NOT_WINTER = [3, 4, 5, 6, 7, 8, 9, 10, 11];
const COOL = [10, 11, 12, 1, 2, 3];
const MID_WEEK = [2, 3, 4];

function budgetFor(costCents: number): AiBudget {
  return costCents === 0 ? "free" : costCents < 1500 ? "under_15" : "from_15_to_50";
}

function mk(o: Omit<IdeaTemplate, "budget">): IdeaTemplate {
  return { ...o, budget: budgetFor(o.costCents) };
}

export const IDEA_CATALOG: readonly IdeaTemplate[] = [
  // Outdoors
  mk({
    id: "sunrise-hike", title: "Sunrise hike", theme: "outdoors", tagIds: ["tag-outdoors", "tag-fitness"], goal: "wellness",
    pitch: "Catch the first light together on an easy, scenic trail before the day begins.",
    description: "Meet early at an easy, well-marked trail and walk to a viewpoint as the sun comes up. The pace is relaxed and open to every fitness level. Bring a water bottle and a layer, and finish with a short photo break at the top.",
    durationMinutes: 120, groupMin: 4, groupMax: 20, costCents: 0, dayparts: ["weekend_daytime"], weekdays: [6, 7], months: MILD,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "nearby trailhead or nature preserve", coverCategory: "hiking", lowKey: false,
  }),
  mk({
    id: "kayak-outing", title: "Kayak outing", theme: "outdoors", tagIds: ["tag-outdoors", "tag-energetic"], goal: "team_bonding",
    pitch: "Paddle a calm stretch of water together and swap stories along the way.",
    description: "Rent kayaks or canoes for a relaxed paddle on a calm lake or river. A short safety briefing comes from the rental staff, and no experience is needed. Plan a snack stop partway so everyone can catch their breath and chat.",
    durationMinutes: 150, groupMin: 6, groupMax: 20, costCents: 3500, dayparts: ["weekend_daytime"], weekdays: [6, 7], months: WARM,
    isOutdoor: true, venueType: "activity_venue", venueSearchHint: "kayak rental on a calm lake or river", coverCategory: "outdoors", lowKey: false,
  }),
  mk({
    id: "park-picnic-games", title: "Park picnic and lawn games", theme: "outdoors", tagIds: ["tag-outdoors", "tag-games", "tag-social"], goal: "team_bonding",
    pitch: "A relaxed lunch on the grass with lawn games and plenty of shade.",
    description: "Spread out blankets in a nearby park and share lunch outside. Set up a few easy lawn games like cornhole, giant checkers or a frisbee toss. It is a low-effort way to get everyone away from their desks for an hour.",
    durationMinutes: 90, groupMin: 6, groupMax: 40, costCents: 1000, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: WARM,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "park with picnic tables and open lawn", coverCategory: "outdoors", lowKey: true,
  }),
  mk({
    id: "community-garden-day", title: "Community garden day", theme: "outdoors", tagIds: ["tag-outdoors", "tag-volunteering"], goal: "give_back",
    pitch: "Get your hands dirty helping a local garden grow, then share a snack.",
    description: "Join a community garden for a morning of planting, weeding and tidying beds. The garden coordinators show everyone what to do, so no experience is required. Wear clothes that can get dirty and bring sun protection.",
    durationMinutes: 150, groupMin: 4, groupMax: 20, costCents: 0, dayparts: ["weekend_daytime", "weekday_afternoon"], weekdays: [6, 3, 4], months: MILD,
    isOutdoor: true, venueType: "community_site", venueSearchHint: "community garden", coverCategory: "outdoors", lowKey: false,
  }),
  mk({
    id: "stargazing-night", title: "Stargazing night", theme: "outdoors", tagIds: ["tag-outdoors", "tag-chill", "tag-learning"], goal: "team_bonding",
    pitch: "Spread out blankets, look up and learn a few constellations together.",
    description: "Head to a dark spot away from city lights with blankets, hot drinks and a star map app. A volunteer guide or an amateur astronomer can point out planets and constellations. Check the sky forecast and pick a backup date in case of clouds.",
    durationMinutes: 120, groupMin: 4, groupMax: 25, costCents: 500, dayparts: ["after_work"], weekdays: [5, 6], months: MILD,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "dark sky park or open field outside town", coverCategory: "outdoors", lowKey: false,
  }),
  mk({
    id: "fall-foliage-walk", title: "Fall foliage walk", theme: "outdoors", tagIds: ["tag-outdoors", "tag-chill", "tag-wellness"], goal: "wellness",
    pitch: "A slow lunchtime stroll through the best autumn colors nearby.",
    description: "Take an easy loop through a park or tree-lined trail while the leaves are at their best. The route stays flat and short enough for a lunch break. Pair up or walk in small groups, and bring a camera for the best colors.",
    durationMinutes: 60, groupMin: 4, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: [9, 10, 11],
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "tree-lined park or arboretum", coverCategory: "hiking", lowKey: true,
  }),
  // Food and drink
  mk({
    id: "dumpling-workshop", title: "Dumpling-making workshop", theme: "food", tagIds: ["tag-food", "tag-cooking", "tag-social"], goal: "team_bonding",
    pitch: "Fold, pleat and steam your own dumplings, then eat the results together.",
    description: "A guided hands-on class where everyone makes dough, fills it and folds dumplings from scratch. Vegetarian fillings are included so everyone can join. The session ends with a shared meal of everything you made.",
    durationMinutes: 120, groupMin: 6, groupMax: 20, costCents: 2500, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "cooking studio", coverCategory: "cooking", lowKey: false,
  }),
  mk({
    id: "chili-cook-off", title: "Chili cook-off", theme: "food", tagIds: ["tag-food", "tag-cooking", "tag-social"], goal: "competition",
    pitch: "Bring your best pot of chili and let the team vote on a winner.",
    description: "Volunteers bring a slow cooker of their favorite chili, including at least one vegetarian option. Everyone gets a small tasting cup and a ballot, and the winner earns bragging rights. Label ingredients clearly for allergies.",
    durationMinutes: 75, groupMin: 8, groupMax: 40, costCents: 500, dayparts: ["weekday_lunch"], weekdays: [3, 4, 5], months: COOL,
    isOutdoor: false, venueType: "office", venueSearchHint: "shared kitchen or large meeting room", coverCategory: "cooking", lowKey: false,
  }),
  mk({
    id: "global-potluck", title: "Global potluck lunch", theme: "food", tagIds: ["tag-food", "tag-social"], goal: "celebrate",
    pitch: "Everyone brings a dish that tells a story about where they come from.",
    description: "Each person shares a dish from their family, culture or a favorite trip, with a small card telling its story. It is an easy way to learn about each other over lunch. Ask people to label ingredients so everyone can eat safely.",
    durationMinutes: 75, groupMin: 6, groupMax: 60, costCents: 0, dayparts: ["weekday_lunch"], weekdays: [3, 4, 5], months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "shared kitchen or large meeting room", coverCategory: "cooking", lowKey: true,
  }),
  mk({
    id: "coffee-tasting", title: "Coffee tasting hour", theme: "food", tagIds: ["tag-food", "tag-chill", "tag-learning"], goal: "learning",
    pitch: "Sip a flight of single-origin coffees and learn what makes each one different.",
    description: "A local roaster or barista leads a relaxed tasting of several coffees, explaining origin, roast and flavor notes. Decaf and tea options are available for anyone who prefers them. It makes a calm afternoon break that is easy to join.",
    durationMinutes: 60, groupMin: 4, groupMax: 20, costCents: 1200, dayparts: ["weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "restaurant_or_cafe", venueSearchHint: "specialty coffee roaster", coverCategory: "cooking", lowKey: true,
  }),
  mk({
    id: "pasta-making-class", title: "Pasta-making class", theme: "food", tagIds: ["tag-food", "tag-cooking"], goal: "team_bonding",
    pitch: "Roll, cut and cook fresh pasta side by side with a friendly instructor.",
    description: "An instructor teaches the basics of making fresh pasta dough and shaping it by hand. Teams pair up at stations and then sit down to eat what they made with a simple sauce. Vegetarian and dairy-free options are available.",
    durationMinutes: 120, groupMin: 6, groupMax: 20, costCents: 3500, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "cooking studio", coverCategory: "cooking", lowKey: false,
  }),
  mk({
    id: "ice-cream-social", title: "Ice cream social", theme: "food", tagIds: ["tag-food", "tag-social"], goal: "celebrate",
    pitch: "A sunny afternoon treat with a build-your-own sundae bar.",
    description: "Set up a sundae bar with a few flavors, toppings and dairy-free options. Invite everyone to take a break, grab a bowl and catch up. It takes little preparation and is a nice way to mark a good week.",
    durationMinutes: 45, groupMin: 6, groupMax: 80, costCents: 800, dayparts: ["weekday_afternoon"], weekdays: [4, 5], months: WARM,
    isOutdoor: false, venueType: "office", venueSearchHint: "office kitchen or outdoor patio", coverCategory: "cooking", lowKey: true,
  }),
  // Arts and crafts
  mk({
    id: "pottery-night", title: "Pottery night", theme: "arts", tagIds: ["tag-arts", "tag-chill"], goal: "team_bonding",
    pitch: "Shape a small bowl or mug on the wheel and take your creation home.",
    description: "A studio instructor guides beginners through hand-building or throwing on the wheel. Each person makes a piece that is glazed and fired afterward for pickup. The pace is calm and no one needs any experience.",
    durationMinutes: 120, groupMin: 4, groupMax: 14, costCents: 4500, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "pottery studio", coverCategory: "cooking", lowKey: false,
  }),
  mk({
    id: "mural-painting", title: "Team mural painting", theme: "arts", tagIds: ["tag-arts", "tag-social"], goal: "team_bonding",
    pitch: "Paint one big mural together and leave something colorful behind.",
    description: "Sketch a simple design with the team, then everyone paints a section of a large canvas or a wall you have permission to use. A volunteer artist can help with layout and color choices. The finished piece can hang in the office or a community space.",
    durationMinutes: 150, groupMin: 6, groupMax: 25, costCents: 1500, dayparts: ["weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "community_site", venueSearchHint: "community arts center or large open room", coverCategory: "cooking", lowKey: false,
  }),
  mk({
    id: "photo-walk", title: "Photo walk", theme: "arts", tagIds: ["tag-arts", "tag-outdoors", "tag-chill"], goal: "wellness",
    pitch: "Stroll the neighborhood with your phone and hunt for great shots.",
    description: "Walk a loop with a few playful prompts like colors, textures or reflections, and snap photos on your phone. Meet at the end to share your favorites. No camera skills are needed, only curiosity.",
    durationMinutes: 60, groupMin: 4, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: NOT_WINTER,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "scenic neighborhood or waterfront walk", coverCategory: "outdoors", lowKey: true,
  }),
  mk({
    id: "watercolor-lunch", title: "Watercolor lunch break", theme: "arts", tagIds: ["tag-arts", "tag-chill"], goal: "wellness",
    pitch: "Paint something small and calm while you eat, no talent required.",
    description: "Provide simple watercolor sets and one easy subject to paint, such as a sky wash or a leaf. A short video or a teammate can show a few basic strokes. People go home with their own tiny painting.",
    durationMinutes: 60, groupMin: 4, groupMax: 25, costCents: 1200, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "meeting room with large tables", coverCategory: "cooking", lowKey: true,
  }),
  mk({
    id: "improv-workshop", title: "Improv workshop", theme: "arts", tagIds: ["tag-arts", "tag-social", "tag-energetic"], goal: "team_bonding",
    pitch: "Play simple improv games that get everyone laughing and listening.",
    description: "A professional improv coach leads warm-ups and short, friendly scene games built on saying yes and supporting each other. Nobody is put on the spot, and participation is always optional. Expect a lot of laughter and better teamwork.",
    durationMinutes: 90, groupMin: 6, groupMax: 24, costCents: 2500, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "improv theater or comedy school", coverCategory: "games", lowKey: false,
  }),
  // Games
  mk({
    id: "trivia-night", title: "Trivia night", theme: "games", tagIds: ["tag-games", "tag-social"], goal: "competition",
    pitch: "Split into teams, test your general knowledge and chase the top spot.",
    description: "Teams of four or five answer rounds of trivia on mixed topics, from movies to geography. A volunteer host reads questions and keeps score. Offer snacks and nonalcoholic drinks so everyone feels welcome.",
    durationMinutes: 90, groupMin: 8, groupMax: 40, costCents: 500, dayparts: ["after_work"], weekdays: [3, 4], months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "large meeting room or cafe with a private area", coverCategory: "games", lowKey: true,
  }),
  mk({
    id: "escape-room", title: "Escape room challenge", theme: "games", tagIds: ["tag-games", "tag-energetic"], goal: "team_bonding",
    pitch: "Solve puzzles together against the clock and find the way out.",
    description: "Small teams work through clues and puzzles inside a themed room, with a game master on hand for hints. It rewards communication and shows who loves a good riddle. Book a few rooms at the same time so everyone plays together.",
    durationMinutes: 75, groupMin: 4, groupMax: 16, costCents: 3000, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "escape room", coverCategory: "games", lowKey: false,
  }),
  mk({
    id: "board-game-lunch", title: "Board game lunch", theme: "games", tagIds: ["tag-games", "tag-chill", "tag-social"], goal: "team_bonding",
    pitch: "Pull out a few easy-to-learn games and play through lunch.",
    description: "Set up several tables with simple games like cooperative puzzles or card games, and let people drift between them. A few volunteers can teach the rules in a minute. It is easy to run and easy to join in the middle.",
    durationMinutes: 60, groupMin: 4, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "meeting room or break room", coverCategory: "games", lowKey: true,
  }),
  mk({
    id: "bowling-night", title: "Bowling night", theme: "games", tagIds: ["tag-games", "tag-social"], goal: "competition",
    pitch: "A casual bowling league night with team scores and silly team names.",
    description: "Form teams, pick a team name and bowl a couple of friendly games. Scores are for fun, and shoes and lanes are booked in advance. Offer food and nonalcoholic drinks for everyone.",
    durationMinutes: 120, groupMin: 6, groupMax: 30, costCents: 2000, dayparts: ["after_work"], weekdays: [3, 4], months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "bowling alley", coverCategory: "games", lowKey: false,
  }),
  mk({
    id: "mini-golf", title: "Mini golf outing", theme: "games", tagIds: ["tag-games", "tag-outdoors", "tag-social"], goal: "celebrate",
    pitch: "Play a relaxed round of mini golf in the evening light.",
    description: "Groups of three or four play a round of mini golf at their own pace, with a lighthearted prize for the best score and the most creative shot. It is easy for beginners and accessible to most people. Add an ice cream stop afterward.",
    durationMinutes: 90, groupMin: 4, groupMax: 24, costCents: 1500, dayparts: ["after_work", "weekend_daytime"], weekdays: [4, 5, 6], months: MILD,
    isOutdoor: true, venueType: "activity_venue", venueSearchHint: "mini golf course", coverCategory: "games", lowKey: false,
  }),
  // Music
  mk({
    id: "open-mic-lunch", title: "Open-mic lunch", theme: "music", tagIds: ["tag-music", "tag-social", "tag-chill"], goal: "team_bonding",
    pitch: "Hidden talents take the stage for a few songs over lunch.",
    description: "Set up a small stage area with a microphone and invite people to perform a song, a poem or a short joke. Keep slots to a few minutes and make clear that listening is just as welcome. Some of the best moments come from surprises.",
    durationMinutes: 60, groupMin: 6, groupMax: 50, costCents: 0, dayparts: ["weekday_lunch"], weekdays: [3, 4, 5], months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "large meeting room or cafeteria", coverCategory: "games", lowKey: true,
  }),
  mk({
    id: "drum-circle", title: "Drum circle", theme: "music", tagIds: ["tag-music", "tag-energetic", "tag-wellness"], goal: "wellness",
    pitch: "Pick up a drum and build one big rhythm together, no experience needed.",
    description: "A facilitator provides drums and percussion and guides the group in simple rhythms that build on each other. Everyone plays at their own comfort level. It is a lively, shared experience that needs no musical training.",
    durationMinutes: 60, groupMin: 6, groupMax: 30, costCents: 1500, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "drum circle facilitator or community music space", coverCategory: "games", lowKey: false,
  }),
  mk({
    id: "karaoke-night", title: "Karaoke night", theme: "music", tagIds: ["tag-music", "tag-hype", "tag-social"], goal: "celebrate",
    pitch: "Sing your heart out, or cheer loudly from the sofa, in a private room.",
    description: "Reserve a private karaoke room so people can sing or just cheer on their teammates. Group songs make it easy for shy singers to join in. Offer snacks and nonalcoholic drinks.",
    durationMinutes: 120, groupMin: 6, groupMax: 20, costCents: 1500, dayparts: ["after_work"], weekdays: [4, 5], months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "private karaoke room", coverCategory: "games", lowKey: false,
  }),
  mk({
    id: "concert-in-the-park", title: "Concert in the park outing", theme: "music", tagIds: ["tag-music", "tag-outdoors", "tag-chill"], goal: "celebrate",
    pitch: "Bring blankets and snacks to a free evening concert outdoors.",
    description: "Find a free community concert or summer music series and meet up on the lawn. Bring blankets, folding chairs and snacks to share. It is an easy, low-pressure evening that people can join for as long as they like.",
    durationMinutes: 150, groupMin: 4, groupMax: 40, costCents: 1000, dayparts: ["after_work"], weekdays: [4, 5], months: WARM,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "park amphitheater or bandshell", coverCategory: "outdoors", lowKey: false,
  }),
  mk({
    id: "playlist-swap", title: "Playlist swap listening party", theme: "music", tagIds: ["tag-music", "tag-chill", "tag-social"], goal: "team_bonding",
    pitch: "Share one favorite song each and tell the story behind it.",
    description: "Everyone submits one song ahead of time, and the group listens to them in turn while the person who chose it shares why it matters. A shared playlist is created afterward for the office. It is simple to run and brings out new sides of colleagues.",
    durationMinutes: 60, groupMin: 5, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch"], weekdays: [3, 4, 5], months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "meeting room with speakers", coverCategory: "games", lowKey: true,
  }),
  // Learning
  mk({
    id: "lightning-talks", title: "Lightning talks lunch", theme: "learning", tagIds: ["tag-learning", "tag-social"], goal: "learning",
    pitch: "Five-minute talks on anything people love, from sourdough to space.",
    description: "Volunteers each give a short talk on a hobby, skill or idea they enjoy, with no slides required. Keep each talk to five minutes with a quick question round. The topics are always varied and often surprising.",
    durationMinutes: 60, groupMin: 6, groupMax: 40, costCents: 500, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "meeting room with a screen", coverCategory: "games", lowKey: true,
  }),
  mk({
    id: "kitchen-science-demo", title: "Kitchen science demo", theme: "learning", tagIds: ["tag-learning", "tag-cooking"], goal: "learning",
    pitch: "Watch everyday ingredients fizz, freeze and transform in a live demo.",
    description: "A volunteer or guest presenter runs simple, safe experiments using kitchen ingredients and explains the science behind each. Attendees can taste a few of the results. It is a fun, curious break from the usual day.",
    durationMinutes: 60, groupMin: 6, groupMax: 30, costCents: 1000, dayparts: ["weekday_lunch", "weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "kitchen or meeting room", coverCategory: "cooking", lowKey: false,
  }),
  mk({
    id: "book-club-kickoff", title: "Book club kickoff", theme: "learning", tagIds: ["tag-learning", "tag-chill"], goal: "learning",
    pitch: "Pick a first book together and start a low-key reading circle.",
    description: "Meet to vote on a first book from a short list that includes fiction, nonfiction and short reads. Set a simple monthly rhythm and a place to share notes. Audiobooks and library copies keep the cost at zero.",
    durationMinutes: 45, groupMin: 4, groupMax: 20, costCents: 0, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "quiet meeting room or library", coverCategory: "games", lowKey: true,
  }),
  mk({
    id: "cpr-class", title: "Basic CPR certification class", theme: "learning", tagIds: ["tag-learning", "tag-wellness"], goal: "learning",
    pitch: "Learn a practical skill from a certified instructor that is useful anywhere.",
    description: "A certified instructor teaches the steps of CPR and the use of an automated defibrillator with hands-on practice using training mannequins. Participants who complete the course receive a certificate from the training provider. This is a skills class and the instructor covers all content.",
    durationMinutes: 180, groupMin: 6, groupMax: 20, costCents: 4000, dayparts: ["weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "community_site", venueSearchHint: "certified CPR training provider", coverCategory: "fitness", lowKey: false,
  }),
  mk({
    id: "language-lunch", title: "Language swap lunch", theme: "learning", tagIds: ["tag-learning", "tag-food", "tag-social"], goal: "learning",
    pitch: "Share lunch and learn how to say hello in a few new languages.",
    description: "Set up tables by language and have colleagues who speak it teach a few phrases, greetings and food words. Rotate every fifteen minutes. People often discover that coworkers speak more languages than they knew.",
    durationMinutes: 60, groupMin: 6, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "shared kitchen or large meeting room", coverCategory: "cooking", lowKey: true,
  }),
  mk({
    id: "financial-basics-talk", title: "Financial basics talk", theme: "learning", tagIds: ["tag-learning"], goal: "learning",
    pitch: "A friendly general-knowledge session on budgeting and saving basics.",
    description: "Invite a speaker from a nonprofit financial education group for a general talk on budgeting, saving and common money terms. The talk is educational only and does not give personal advice. Leave time for questions at the end.",
    durationMinutes: 60, groupMin: 6, groupMax: 50, costCents: 0, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "meeting room with a screen", coverCategory: "games", lowKey: true,
  }),
  // Volunteering
  mk({
    id: "food-bank-shift", title: "Food bank volunteer shift", theme: "volunteering", tagIds: ["tag-volunteering", "tag-social"], goal: "give_back",
    pitch: "Sort and pack food for neighbors in need as a team.",
    description: "Spend a few hours at a local food bank sorting donations and packing boxes alongside the staff. The coordinators give a short orientation and tasks fit different abilities. It is a rewarding way to help the community together.",
    durationMinutes: 180, groupMin: 4, groupMax: 20, costCents: 0, dayparts: ["weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "community_site", venueSearchHint: "food bank", coverCategory: "cooking", lowKey: false,
  }),
  mk({
    id: "park-cleanup", title: "Park cleanup morning", theme: "volunteering", tagIds: ["tag-volunteering", "tag-outdoors"], goal: "give_back",
    pitch: "Grab gloves and bags and leave a favorite park cleaner than you found it.",
    description: "Pick a nearby park, trail or waterfront and spend a morning collecting litter. The local parks department or a volunteer group can often lend gloves, bags and grabbers. Finish with a snack and a look at the bags you filled.",
    durationMinutes: 120, groupMin: 4, groupMax: 40, costCents: 0, dayparts: ["weekend_daytime"], weekdays: [6], months: NOT_WINTER,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "local park or waterfront cleanup", coverCategory: "outdoors", lowKey: false,
  }),
  mk({
    id: "care-kit-build", title: "Build care kits", theme: "volunteering", tagIds: ["tag-volunteering", "tag-social"], goal: "give_back",
    pitch: "Pack hygiene and comfort kits for a local shelter in an easy lunch hour.",
    description: "Set up an assembly line to pack basics like socks, toiletries and notes of encouragement into kits for a local shelter. Check with the shelter for what they need most. Writing a kind note for each kit is a nice personal touch.",
    durationMinutes: 75, groupMin: 6, groupMax: 40, costCents: 800, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "large meeting room with long tables", coverCategory: "cooking", lowKey: true,
  }),
  mk({
    id: "tutoring-session", title: "Tutoring session", theme: "volunteering", tagIds: ["tag-volunteering", "tag-learning"], goal: "give_back",
    pitch: "Share your skills with local students who could use a study buddy.",
    description: "Partner with a nearby school or library to help students with homework or reading. The organization handles sign-ups and any required background checks in advance. Even one afternoon a month can make a real difference.",
    durationMinutes: 90, groupMin: 3, groupMax: 12, costCents: 0, dayparts: ["after_work"], weekdays: MID_WEEK, months: [1, 2, 3, 4, 5, 9, 10, 11, 12],
    isOutdoor: false, venueType: "community_site", venueSearchHint: "local school or library", coverCategory: "games", lowKey: false,
  }),
  mk({
    id: "animal-shelter-visit", title: "Animal shelter visit", theme: "volunteering", tagIds: ["tag-volunteering", "tag-chill"], goal: "give_back",
    pitch: "Walk dogs, socialize cats and help the shelter team for an afternoon.",
    description: "Visit a local animal shelter to help with walking, socializing and simple cleaning tasks as directed by the staff. Closed-toe shoes and a short sign-up form are usually required. The shelter can also tell you about wish list items to donate.",
    durationMinutes: 120, groupMin: 3, groupMax: 10, costCents: 0, dayparts: ["weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "community_site", venueSearchHint: "animal shelter", coverCategory: "outdoors", lowKey: false,
  }),
  // Wellness
  mk({
    id: "guided-meditation", title: "Guided meditation break", theme: "wellness", tagIds: ["tag-wellness", "tag-chill"], goal: "wellness",
    pitch: "Thirty quiet minutes to slow down and breathe together.",
    description: "A volunteer or guest leads a short guided session focused on breathing and relaxing, using a recording if you prefer. Sit in a chair or on the floor, whichever feels comfortable. Participation is optional and no experience is needed.",
    durationMinutes: 30, groupMin: 3, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch", "weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "quiet meeting room", coverCategory: "fitness", lowKey: true,
  }),
  mk({
    id: "chair-yoga", title: "Chair yoga session", theme: "wellness", tagIds: ["tag-wellness", "tag-chill"], goal: "wellness",
    pitch: "Gentle stretches you can do in work clothes without leaving your chair.",
    description: "An instructor leads easy stretches and breathing that can all be done seated. No mats, special clothing or flexibility needed. Everyone moves within their own comfort and skips anything that does not feel right.",
    durationMinutes: 45, groupMin: 4, groupMax: 30, costCents: 1000, dayparts: ["weekday_lunch", "weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "meeting room or yoga studio", coverCategory: "fitness", lowKey: true,
  }),
  mk({
    id: "walking-meeting-club", title: "Walking meeting club", theme: "wellness", tagIds: ["tag-wellness", "tag-outdoors"], goal: "wellness",
    pitch: "Swap a sit-down catch-up for a walk around the block.",
    description: "Pair up or form small groups for a thirty-minute walk and chat instead of a conference room meeting. Choose a simple loop near the office. Set a weekly time so it becomes an easy habit.",
    durationMinutes: 30, groupMin: 4, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch", "weekday_afternoon"], weekdays: MID_WEEK, months: NOT_WINTER,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "park or tree-lined walking loop near the office", coverCategory: "hiking", lowKey: true,
  }),
  mk({
    id: "digital-detox-lunch", title: "Digital detox lunch", theme: "wellness", tagIds: ["tag-wellness", "tag-social", "tag-chill"], goal: "team_bonding",
    pitch: "Phones in a basket and a lunch full of real conversation.",
    description: "Share lunch with phones and laptops set aside for an hour. Put a few conversation cards on each table to get things going. Anyone who needs to stay reachable can keep a phone nearby for emergencies.",
    durationMinutes: 60, groupMin: 4, groupMax: 30, costCents: 0, dayparts: ["weekday_lunch"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "shared kitchen or meeting room", coverCategory: "cooking", lowKey: true,
  }),
  mk({
    id: "gratitude-journaling", title: "Gratitude journaling hour", theme: "wellness", tagIds: ["tag-wellness", "tag-chill"], goal: "wellness",
    pitch: "Write a few kind thoughts and share a note of thanks with a teammate.",
    description: "Hand out simple notebooks and prompts, then spend a quiet half hour writing about things that went well. End by writing a short thank-you note to a colleague. It is a gentle reset in a busy week.",
    durationMinutes: 45, groupMin: 4, groupMax: 30, costCents: 300, dayparts: ["weekday_afternoon"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "quiet meeting room", coverCategory: "fitness", lowKey: true,
  }),
  mk({
    id: "afternoon-tea-break", title: "Afternoon tea break", theme: "wellness", tagIds: ["tag-wellness", "tag-food", "tag-chill"], goal: "wellness",
    pitch: "A slow tea break with good snacks and nothing on the agenda.",
    description: "Set up a tea station with a few varieties, honey and light snacks, and invite everyone to pause together. No agenda and no presentations, only conversation. Include caffeine-free choices for those who want them.",
    durationMinutes: 45, groupMin: 4, groupMax: 40, costCents: 600, dayparts: ["weekday_afternoon"], weekdays: [3, 4, 5], months: COOL,
    isOutdoor: false, venueType: "office", venueSearchHint: "office kitchen or lounge", coverCategory: "cooking", lowKey: true,
  }),
  // Fitness
  mk({
    id: "lunchtime-run-club", title: "Lunchtime run club", theme: "fitness", tagIds: ["tag-fitness", "tag-energetic", "tag-outdoors"], goal: "wellness",
    pitch: "An easy, social run or walk at every pace, finished in under an hour.",
    description: "Meet at a set spot for a conversational-pace loop with a walking option for anyone who prefers it. Routes are short enough to shower and eat afterward. Everyone sets their own pace, and nobody is left behind.",
    durationMinutes: 45, groupMin: 4, groupMax: 25, costCents: 0, dayparts: ["weekday_lunch"], weekdays: [2, 3, 4], months: NOT_WINTER,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "park path or running trail near the office", coverCategory: "fitness", lowKey: true,
  }),
  mk({
    id: "rock-climbing-intro", title: "Intro to rock climbing", theme: "fitness", tagIds: ["tag-fitness", "tag-energetic"], goal: "team_bonding",
    pitch: "Try indoor climbing with gear and coaching, and cheer each other up the wall.",
    description: "Staff at an indoor climbing gym provide a safety briefing, equipment and beginner routes. Climbers belay and encourage each other, and resting between routes is always fine. No experience is needed.",
    durationMinutes: 120, groupMin: 4, groupMax: 16, costCents: 2500, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "climbing gym", coverCategory: "fitness", lowKey: false,
  }),
  mk({
    id: "step-challenge-kickoff", title: "Team step challenge kickoff", theme: "fitness", tagIds: ["tag-fitness", "tag-energetic", "tag-social"], goal: "competition",
    pitch: "Form walking teams and start a friendly month-long step challenge.",
    description: "Meet briefly to form teams, pick names and agree on simple rules. Steps are tracked with any phone or watch and shared on a weekly leaderboard. Make goals fair for different abilities by counting progress rather than raw totals.",
    durationMinutes: 45, groupMin: 8, groupMax: 80, costCents: 0, dayparts: ["weekday_lunch"], weekdays: [1, 2], months: YEAR,
    isOutdoor: false, venueType: "office", venueSearchHint: "meeting room or break room", coverCategory: "fitness", lowKey: true,
  }),
  mk({
    id: "ultimate-frisbee", title: "Ultimate frisbee game", theme: "fitness", tagIds: ["tag-fitness", "tag-outdoors", "tag-energetic"], goal: "competition",
    pitch: "A friendly pickup game that is easy to learn and fun to lose.",
    description: "Teach the basic rules in a few minutes and split into mixed teams for a casual pickup game. Lots of running is optional because there are positions for every energy level. Bring water and cleats or sneakers.",
    durationMinutes: 90, groupMin: 10, groupMax: 24, costCents: 0, dayparts: ["after_work"], weekdays: [3, 4], months: MILD,
    isOutdoor: true, venueType: "park_or_outdoors", venueSearchHint: "park with an open field", coverCategory: "fitness", lowKey: false,
  }),
  mk({
    id: "beginner-spin-class", title: "Beginner spin class", theme: "fitness", tagIds: ["tag-fitness", "tag-energetic", "tag-hype"], goal: "wellness",
    pitch: "Ride to the beat in a high-energy but beginner-friendly cycling class.",
    description: "An instructor leads a beginner-friendly indoor cycling class with music and clear cues. Everyone sets their own resistance and can rest whenever they need. Arrive a few minutes early so the staff can set up each bike.",
    durationMinutes: 60, groupMin: 4, groupMax: 20, costCents: 2500, dayparts: ["weekday_morning", "after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "indoor cycling studio", coverCategory: "fitness", lowKey: false,
  }),
  mk({
    id: "beginner-dance-class", title: "Beginner dance class", theme: "fitness", tagIds: ["tag-fitness", "tag-hype", "tag-social"], goal: "team_bonding",
    pitch: "Learn a simple routine together and laugh at your own footwork.",
    description: "An instructor teaches a short, beginner-friendly routine in a style the group picks, such as salsa or line dancing. Partners rotate so everyone meets someone new. No experience is needed, and sitting out a round is always fine.",
    durationMinutes: 60, groupMin: 6, groupMax: 24, costCents: 2000, dayparts: ["after_work"], weekdays: MID_WEEK, months: YEAR,
    isOutdoor: false, venueType: "activity_venue", venueSearchHint: "dance studio", coverCategory: "fitness", lowKey: false,
  }),
];

const BY_ID = new Map(IDEA_CATALOG.map(idea => [idea.id, idea]));

export function ideaById(id: string): IdeaTemplate | undefined {
  return BY_ID.get(id);
}
