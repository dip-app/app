import type { ThemeKey } from "../../suggestions/domain/catalog";

/**
 * Curated weekly theme ideas (docs/design/stretch/dipbot-suggest-theme.md). The free fallback of Suggest theme and a tool
 * the model can read for inspiration. Three or more per theme illustration; each says what members do during the week
 * and what they post as proof. Tags are global catalog ids (the theme's own tag first). English catalog content: never
 * translated (docs/design/backend-i18n.md).
 */
export interface ThemeIdea {
  id: string;
  theme: ThemeKey;
  title: string;
  description: string;
  tagIds: string[];
  /** Seasonal fit, northern-hemisphere months 1..12. */
  months: number[];
}

const YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const WARM = [4, 5, 6, 7, 8, 9, 10];
const COOL = [10, 11, 12, 1, 2, 3];

export const THEME_IDEAS: readonly ThemeIdea[] = [
  { id: "th-step-up-week", theme: "fitness", title: "Step Up Week", tagIds: ["tag-fitness", "tag-energetic"], months: YEAR,
    description: "Take the stairs, walk a meeting or add a short loop at lunch. Log your steps or a walk each day and post a photo or screenshot." },
  { id: "th-try-a-class", theme: "fitness", title: "Try a New Class", tagIds: ["tag-fitness", "tag-social"], months: YEAR,
    description: "Join a class you have never tried, alone or with coworkers: spin, yoga, climbing or dance. Post where you went and how it felt." },
  { id: "th-desk-stretch", theme: "fitness", title: "Desk Stretch Breaks", tagIds: ["tag-fitness", "tag-wellness", "tag-chill"], months: YEAR,
    description: "Take a five minute stretch break every afternoon. Share your favorite stretch or a photo of your break spot." },
  { id: "th-lunch-outside", theme: "outdoors", title: "Lunch Outside", tagIds: ["tag-outdoors", "tag-chill"], months: WARM,
    description: "Eat lunch outdoors at least twice this week: a park bench, a patio or a picnic blanket. Post a photo of your spot." },
  { id: "th-park-explorer", theme: "outdoors", title: "Park Explorer", tagIds: ["tag-outdoors", "tag-fitness"], months: WARM,
    description: "Visit a park or trail you have not been to yet. Post one photo and a short tip for coworkers who want to go." },
  { id: "th-fresh-air-walks", theme: "outdoors", title: "Fresh Air Walks", tagIds: ["tag-outdoors", "tag-wellness"], months: COOL,
    description: "Bundle up and take a short walk outside on three days this week. Share a photo of something you noticed on the way." },
  { id: "th-lunch-swap", theme: "food", title: "Lunch Swap Week", tagIds: ["tag-food", "tag-cooking", "tag-social"], months: YEAR,
    description: "Bring a homemade lunch and trade a portion with a coworker. Post a photo of the swap and the recipe name." },
  { id: "th-local-eats", theme: "food", title: "Local Eats", tagIds: ["tag-food", "tag-social"], months: YEAR,
    description: "Try a cafe or food spot near the office you have never visited. Post a photo and one dish you would order again." },
  { id: "th-soup-season", theme: "food", title: "Soup Season", tagIds: ["tag-food", "tag-cooking", "tag-chill"], months: COOL,
    description: "Cook or order a soup you have never had before. Share a photo and a one-line review." },
  { id: "th-sketch-a-day", theme: "arts", title: "Sketch a Day", tagIds: ["tag-arts", "tag-chill"], months: YEAR,
    description: "Spend ten minutes a day drawing anything around you. No skills needed. Post your favorite sketch of the week." },
  { id: "th-photo-walk", theme: "arts", title: "Photo Walk", tagIds: ["tag-arts", "tag-outdoors"], months: YEAR,
    description: "Take one photo a day around a single word: light, color or texture. Post your best shot with the word." },
  { id: "th-make-something", theme: "arts", title: "Make Something Week", tagIds: ["tag-arts", "tag-learning"], months: YEAR,
    description: "Knit, paint, build or craft something small this week. Post a photo of the work in progress or the finished piece." },
  { id: "th-puzzle-break", theme: "games", title: "Puzzle Break", tagIds: ["tag-games", "tag-chill"], months: YEAR,
    description: "Solve a puzzle a day: a crossword, a word game or a logic grid. Post your score or a screenshot." },
  { id: "th-game-night-week", theme: "games", title: "Game Night Week", tagIds: ["tag-games", "tag-social"], months: YEAR,
    description: "Play a board or card game with coworkers, friends or family. Post a photo of the table and who won." },
  { id: "th-trivia-streak", theme: "games", title: "Trivia Streak", tagIds: ["tag-games", "tag-learning"], months: YEAR,
    description: "Answer one trivia question a day and share a fun fact you learned. Post your favorite fact." },
  { id: "th-new-music", theme: "music", title: "New Music Week", tagIds: ["tag-music", "tag-chill"], months: YEAR,
    description: "Listen to an album or artist you have never heard. Post the name and one song coworkers should try." },
  { id: "th-team-playlist", theme: "music", title: "Team Playlist", tagIds: ["tag-music", "tag-social", "tag-hype"], months: YEAR,
    description: "Add one song a day to a shared team playlist. Post the song and why you picked it." },
  { id: "th-live-music", theme: "music", title: "Live Music Week", tagIds: ["tag-music", "tag-social"], months: YEAR,
    description: "Catch live music this week: a concert, an open mic or a street performer. Post a photo or short clip." },
  { id: "th-learn-a-skill", theme: "learning", title: "Learn One Thing", tagIds: ["tag-learning"], months: YEAR,
    description: "Spend twenty minutes a day learning something new, from a language app to a short course. Post what you learned." },
  { id: "th-book-week", theme: "learning", title: "Read Together", tagIds: ["tag-learning", "tag-chill"], months: YEAR,
    description: "Read for fifteen minutes a day, any book or long article. Post the title and one line you liked." },
  { id: "th-teach-a-tip", theme: "learning", title: "Teach a Tip", tagIds: ["tag-learning", "tag-social"], months: YEAR,
    description: "Share one tip you know well with a coworker: a shortcut, a recipe or a tool. Post the tip so everyone can try it." },
  { id: "th-kindness-week", theme: "volunteering", title: "Kindness Week", tagIds: ["tag-volunteering", "tag-social"], months: YEAR,
    description: "Do one small kind thing a day for a coworker or neighbor. Post what you did, without names." },
  { id: "th-donate-drive", theme: "volunteering", title: "Donation Drive", tagIds: ["tag-volunteering"], months: COOL,
    description: "Bring warm clothes, food or books to donate this week. Post a photo of what you dropped off." },
  { id: "th-clean-up", theme: "volunteering", title: "Neighborhood Cleanup", tagIds: ["tag-volunteering", "tag-outdoors"], months: WARM,
    description: "Pick up litter for ten minutes on a walk near home or the office. Post a photo of your bag." },
  { id: "th-unplug", theme: "wellness", title: "Unplug Hour", tagIds: ["tag-wellness", "tag-chill"], months: YEAR,
    description: "Spend one hour a day away from screens. Post what you did instead: a walk, a book or a meal." },
  { id: "th-hydration", theme: "wellness", title: "Water Check", tagIds: ["tag-wellness"], months: YEAR,
    description: "Drink a glass of water before every meeting break. Post a photo of your favorite bottle or mug." },
  { id: "th-gratitude", theme: "wellness", title: "Gratitude Notes", tagIds: ["tag-wellness", "tag-social"], months: YEAR,
    description: "Write down one thing you are grateful for each day. Post one note to the team at the end of the week." },
];

const BY_ID: ReadonlyMap<string, ThemeIdea> = new Map(THEME_IDEAS.map(i => [i.id, i]));
export const themeIdeaById = (id: string): ThemeIdea | undefined => BY_ID.get(id);
