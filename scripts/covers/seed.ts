// Build the 14 seed covers: 5 legacy photos + 9 weekly-theme illustrations on their accent.
//   node --import tsx scripts/covers/seed.ts [--root <coversDir>]
// Idempotent: re-running replaces the seed entries and keeps any other manifest entries.
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT, buildImages, coversDirFrom, entryFrom, parseArgs, readManifest, sharp, writeCoverFiles, writeManifest,
  type CoverMeta, type License,
} from "./lib";

const EVENTS_DIR = path.join(REPO_ROOT, "apps/admin/public/img/events");
const THEMES_DIR = path.join(REPO_ROOT, "apps/admin/public/img/themes");

const prototype: License = {
  type: "prototype-unconfirmed",
  source: "DIP Figma prototype",
  sourceURL: "",
  creator: "",
  creatorURL: "",
  notes: "Rights unconfirmed; replace when licensed photos arrive",
};
const original: License = {
  type: "dip-original",
  source: "DIP weekly theme art",
  sourceURL: "",
  creator: "DIP",
  creatorURL: "",
  notes: "Original DIP mascot art on the theme accent from apps/admin/public/img/themes/ACCENTS.md",
};

interface LegacySeed extends CoverMeta { source: string; gravity: string }

const legacy: LegacySeed[] = [
  {
    key: "default-fitness", source: "fitness.jpg", gravity: "south",
    themes: ["fitness", "wellness"],
    tags: ["puppy yoga", "yoga", "pug", "dog", "stretching", "indoor workout", "yoga mat"],
    mood: ["playful", "calm"], season: ["any"],
    label: "Puppy yoga session",
    alt: "A woman in blue activewear lies on a yoga mat holding a pug on her raised legs",
    license: prototype,
  },
  {
    key: "default-outdoors", source: "outdoors.jpg", gravity: "centre",
    themes: ["outdoors", "fitness"],
    tags: ["kayaking", "kayak", "paddling", "water", "coast", "lake"],
    mood: ["energetic", "calm"], season: ["summer"],
    label: "Kayaking along the coast",
    alt: "A paddler in a yellow life vest steers an orange kayak past a forested rocky shoreline",
    license: prototype,
  },
  {
    key: "default-hiking", source: "hiking.jpg", gravity: "centre",
    themes: ["outdoors", "fitness"],
    tags: ["hiking", "trail", "mountains", "walking", "nature", "alpine"],
    mood: ["energetic", "calm"], season: ["summer"],
    label: "Mountain trail hike",
    alt: "A narrow gravel trail curves across a green alpine slope toward rocky peaks under a blue sky",
    license: prototype,
  },
  {
    key: "default-games", source: "games.jpg", gravity: "centre",
    themes: ["games", "food"],
    tags: ["board games", "game night", "game cafe", "puzzles", "cards", "cafe"],
    mood: ["social", "playful", "cozy"], season: ["any"],
    label: "Game night at the cafe",
    alt: "A colorful cafe with round game tables, patterned armchairs and shelves of jars",
    license: prototype,
  },
  {
    key: "default-cooking", source: "cooking.jpg", gravity: "centre",
    themes: ["food"],
    tags: ["cafe", "cooking", "lunch", "coffee", "brunch", "dining", "restaurant"],
    mood: ["cozy", "social"], season: ["any"],
    label: "Cafe lunch spot",
    alt: "A bright cafe with wooden tables, blue cross-back chairs, pendant lamps and a patterned tile floor",
    license: prototype,
  },
];

interface ThemeSeed { theme: string; accent: string; label: string; tags: string[]; mood: string[]; alt: string }

const illustrations: ThemeSeed[] = [
  { theme: "fitness", accent: "#FB72E4", label: "Fitness and workout",
    tags: ["fitness", "workout", "weights", "gym", "strength", "training"], mood: ["energetic", "playful"],
    alt: "A cartoon blob in a headband lifts a barbell overhead on a pink background" },
  { theme: "outdoors", accent: "#6BE5D0", label: "Outdoors adventure",
    tags: ["outdoors", "hiking", "camping", "adventure", "nature", "mountains"], mood: ["energetic", "playful"],
    alt: "A cartoon hiker in a straw hat with a backpack walks past a snowy mountain on a teal background" },
  { theme: "food", accent: "#FF7C73", label: "Food and cooking",
    tags: ["food", "cooking", "pizza", "chef", "baking", "dinner"], mood: ["social", "playful"],
    alt: "A cartoon chef in a toque holds up a slice of pizza on a coral background" },
  { theme: "arts", accent: "#7B88FA", label: "Arts and crafts",
    tags: ["arts", "painting", "crafts", "drawing", "creative", "easel"], mood: ["playful", "focused"],
    alt: "A cartoon painter in a beret stands by an easel with a palette on a purple background" },
  { theme: "games", accent: "#FFCC3E", label: "Games night",
    tags: ["games", "board games", "dice", "game night", "chess", "puzzles"], mood: ["playful", "social"],
    alt: "Three cartoon characters cheer over a checkered game board with dice on a yellow background" },
  { theme: "music", accent: "#66D9FF", label: "Music and jam session",
    tags: ["music", "guitar", "band", "jam session", "headphones", "concert"], mood: ["energetic", "festive"],
    alt: "A cartoon character with headphones plays guitar among floating music notes on a blue background" },
  { theme: "learning", accent: "#6BFF9B", label: "Learning and book club",
    tags: ["learning", "books", "book club", "study", "workshop", "reading"], mood: ["focused", "calm"],
    alt: "A cartoon character in round glasses stands by a stack of books under a lightbulb on a green background" },
  { theme: "volunteering", accent: "#1E212B", label: "Volunteering together",
    tags: ["volunteering", "community", "charity", "helping", "giving back", "cleanup"], mood: ["social", "calm"],
    alt: "Two cartoon characters hold a heart-shaped balloon together on a dark background" },
  { theme: "wellness", accent: "#FF7C73", label: "Wellness and relaxing",
    tags: ["wellness", "yoga", "meditation", "relaxing", "self care", "mindfulness"], mood: ["calm", "cozy"],
    alt: "A cartoon character balances on a yoga mat under a crescent moon next to a water bottle on a coral background" },
];

async function illustration(seed: ThemeSeed): Promise<Buffer> {
  const W = 1200;
  const H = 750;
  const art = await sharp(path.join(THEMES_DIR, `${seed.theme}.png`)).resize({ height: Math.round(H * 0.7) }).toBuffer({ resolveWithObject: true });
  return sharp({ create: { width: W, height: H, channels: 3, background: seed.accent } })
    .composite([{
      input: art.data,
      left: Math.round((W - art.info.width) / 2),
      top: Math.round((H - art.info.height) / 2),
    }])
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const dir = coversDirFrom(parseArgs(process.argv.slice(2)));
  const manifest = readManifest(dir);
  const seedKeys = new Set([...legacy.map((l) => l.key), ...illustrations.map((i) => `theme-${i.theme}`)]);
  manifest.covers = manifest.covers.filter((c) => !seedKeys.has(c.key));
  fs.mkdirSync(dir, { recursive: true });

  for (const l of legacy) {
    const img = await buildImages(path.join(EVENTS_DIR, l.source), { gravity: l.gravity });
    const entry = entryFrom({ ...l, kind: "photo" }, img);
    writeCoverFiles(dir, entry, img);
    manifest.covers.push(entry);
  }
  for (const i of illustrations) {
    const img = await buildImages(await illustration(i));
    const entry = entryFrom({
      key: `theme-${i.theme}`, kind: "illustration", themes: [i.theme], tags: i.tags, mood: i.mood, season: ["any"],
      label: i.label, alt: i.alt, license: original,
    }, img);
    writeCoverFiles(dir, entry, img);
    manifest.covers.push(entry);
  }
  writeManifest(dir, manifest);
  console.log(`Seeded ${seedKeys.size} covers into ${path.relative(REPO_ROOT, dir) || dir}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
