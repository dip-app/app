// Preview data for Suggest challenge (suggestThemeV1). `?themeSuggest=` picks a scenario for design review:
// `slow` (6 s), `error` (the server could not answer), `busy` (unavailable), `limit` (daily cap), `fallback` (catalog only,
// free), `long` (the longest titles, descriptions and why lines the server allows). `?ai=nocredits` is the out-of-credits state.
// Mock content stands in for model output: English, and Spanish when the request asks for it.

import type { ThemeSuggestion } from "./adminTypes";

export type ThemeSuggestScenario = "default" | "slow" | "error" | "busy" | "limit" | "fallback" | "long";

export function themeSuggestScenarioFromSearch(search: string): ThemeSuggestScenario {
  const value = new URLSearchParams(search).get("themeSuggest");
  return value === "slow" || value === "error" || value === "busy" || value === "limit" || value === "fallback" || value === "long" ? value : "default";
}

type Row = Omit<ThemeSuggestion, "id" | "weekStart" | "reasonBasis" | "source">;

const EN: Row[] = [
  { title: "Recipe Swap Week", themeKey: "food", tagIds: ["tag-food", "tag-cooking", "tag-social"], fitLabel: "perfect",
    description: "Cook something from a coworker's favorite recipe and share one of yours. Post a photo of the dish and its name.",
    why: ["Food & Drink is a popular interest here (20+ members).", "No Food & Drink challenge in the last 8 weeks."] },
  { title: "Lunch Walk Club", themeKey: "fitness", tagIds: ["tag-fitness", "tag-outdoors"], fitLabel: "great",
    description: "Take a 20 minute walk at lunch on three days this week, alone or with a coworker. Post a photo from your route.",
    why: ["Fitness is a popular interest here (20+ members)."] },
  { title: "Game Break", themeKey: "games", tagIds: ["tag-games", "tag-social"], fitLabel: "good",
    description: "Play a quick puzzle or card game with someone new each day. Post your score or a photo of the table.",
    why: ["Games events filled 74% on average."] },
  { title: "Unplug Hour", themeKey: "wellness", tagIds: ["tag-wellness", "tag-chill"],
    description: "Spend one hour a day away from screens. Post what you did instead: a walk, a book or a meal.",
    why: ["An easy weekly habit anyone can join."] },
];

const ES: Row[] = [
  { title: "Semana de recetas compartidas", themeKey: "food", tagIds: ["tag-food", "tag-cooking", "tag-social"], fitLabel: "perfect",
    description: "Cocina algo de la receta favorita de un compañero y comparte una tuya. Publica una foto del plato y su nombre.",
    why: ["Comida y bebida es un interés popular aquí (20+ miembros).", "No hubo un reto de Comida y bebida en las últimas 8 semanas."] },
  { title: "Club de caminatas al mediodía", themeKey: "fitness", tagIds: ["tag-fitness", "tag-outdoors"], fitLabel: "great",
    description: "Camina 20 minutos al mediodía tres días esta semana, solo o con un compañero. Publica una foto de tu ruta.",
    why: ["Fitness es un interés popular aquí (20+ miembros)."] },
  { title: "Pausa de juegos", themeKey: "games", tagIds: ["tag-games", "tag-social"], fitLabel: "good",
    description: "Juega un rompecabezas o un juego de cartas rápido con alguien nuevo cada día. Publica tu puntaje o una foto de la mesa.",
    why: ["Los eventos de Juegos se llenaron un 74% en promedio."] },
  { title: "Hora sin pantallas", themeKey: "wellness", tagIds: ["tag-wellness", "tag-chill"],
    description: "Pasa una hora al día lejos de las pantallas. Publica lo que hiciste: una caminata, un libro o una comida.",
    why: ["Un hábito semanal fácil al que cualquiera puede unirse."] },
];

const LONG: Row = {
  title: "Neighborhood Volunteering and Kindness Week Together", themeKey: "volunteering", tagIds: ["tag-volunteering", "tag-social", "tag-outdoors", "tag-wellness"], fitLabel: "great",
  description: "Spend at least thirty minutes this week helping out in your neighborhood: pick up litter on a walk, drop off warm clothes or books at a donation point, help a neighbor carry groceries or volunteer an hour at a local food bank. Post a photo of what you did or a few words about it, without names, and cheer on what others share.",
  why: [
    "Volunteering is a growing interest here, and past giving-back challenges kept members posting all week (10-19).",
    "No Volunteering challenge in the last 8 weeks, so this adds variety after the recent fitness and food challenges.",
    "Outdoor parts work in most weather, and indoor options like the food bank keep it open to everyone.",
  ],
};

const LONG_ES: Row = {
  title: "Semana de voluntariado y amabilidad en el vecindario", themeKey: "volunteering", tagIds: ["tag-volunteering", "tag-social", "tag-outdoors", "tag-wellness"], fitLabel: "great",
  description: "Dedica al menos treinta minutos esta semana a ayudar en tu vecindario: recoge basura en una caminata, lleva ropa abrigada o libros a un punto de donación, ayuda a un vecino con las compras o colabora una hora en un banco de alimentos. Publica una foto de lo que hiciste o unas palabras, sin nombres, y anima lo que comparten los demás.",
  why: [
    "El voluntariado es un interés en aumento aquí y los retos solidarios mantuvieron activos a los miembros (10-19).",
    "No hubo un reto de Voluntariado en las últimas 8 semanas, así que aporta variedad tras fitness y comida.",
    "Las partes al aire libre funcionan casi con cualquier clima y las opciones bajo techo lo abren a todos.",
  ],
};

/** Monday "YYYY-MM-DD" `weeks` weeks after the current week, in local time (the client checks it against its own week list). */
function mondayIn(now: Date, weeks: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - day + 1 + weeks * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One suggestion and three alternatives for the scenario and language. `generation` rotates the order on every new press. */
export function buildMockThemeSuggestions(scenario: ThemeSuggestScenario, locale: "en" | "es", generation: number, now: Date): ThemeSuggestion[] {
  const rows = locale === "es" ? ES : EN;
  const rotated = [...rows.slice(generation % rows.length), ...rows.slice(0, generation % rows.length)];
  const list = scenario === "long" ? [locale === "es" ? LONG_ES : LONG, ...rotated.slice(0, 3)] : rotated;
  const fallback = scenario === "fallback";
  return list.map((row, i) => {
    const { fitLabel, ...rest } = row;
    return {
      ...rest, id: `mock-theme-${generation}-${i}`, weekStart: mondayIn(now, 3 + i), reasonBasis: fallback ? "generic" : "company_data",
      source: fallback ? "catalog" : "agent", ...(fitLabel && !fallback ? { fitLabel } : {}),
      ...(fallback ? { why: [locale === "es" ? "Un hábito semanal fácil al que cualquiera puede unirse." : "An easy weekly habit anyone can join."] } : {}),
    };
  });
}
