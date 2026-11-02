/**
 * The emoji a project can pick from.
 *
 * Curated rather than complete. The full set is some four thousand characters;
 * a project mark is drawn at 22 pixels and stands for a codebase, so the list
 * is the ones that actually read at that size and actually say something about
 * software — and a short list someone can scan beats a long one they have to
 * search. Search exists anyway, for when they know what they want.
 *
 * Keywords are what someone would type, not the Unicode name: "db" finds the
 * floppy disk, "ship" finds both the rocket and the boat.
 */

export interface EmojiEntry {
  readonly char: string;
  /** Lowercase, space-separated. The char itself is also matched. */
  readonly keywords: string;
}

export interface EmojiGroup {
  readonly name: string;
  readonly entries: readonly EmojiEntry[];
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    name: "Building",
    entries: [
      { char: "🚀", keywords: "rocket ship launch deploy release fast" },
      { char: "🛠️", keywords: "tools hammer wrench build fix" },
      { char: "⚙️", keywords: "gear cog settings config engine" },
      { char: "🧪", keywords: "test tube lab experiment beta" },
      { char: "🔧", keywords: "wrench fix tool repair" },
      { char: "🧱", keywords: "brick wall build foundation infra" },
      { char: "📦", keywords: "package box bundle ship module npm" },
      { char: "🏗️", keywords: "construction crane build wip" },
      { char: "⚡", keywords: "zap lightning fast perf speed" },
      { char: "🔭", keywords: "telescope observe monitor watch scope" },
      { char: "🧭", keywords: "compass navigate direction guide" },
      { char: "🪄", keywords: "wand magic auto generate" },
    ],
  },
  {
    name: "Systems",
    entries: [
      { char: "🖥️", keywords: "desktop computer machine host" },
      { char: "💾", keywords: "floppy disk save db database storage" },
      { char: "🗄️", keywords: "cabinet file archive db storage" },
      { char: "🛰️", keywords: "satellite orbit remote signal relay" },
      { char: "📡", keywords: "antenna dish signal broadcast api" },
      { char: "🔌", keywords: "plug socket connect integration adapter" },
      { char: "🧩", keywords: "puzzle piece plugin extension module" },
      { char: "🕹️", keywords: "joystick game control arcade" },
      { char: "🤖", keywords: "robot bot agent ai automation" },
      { char: "🧠", keywords: "brain ai model think smart" },
      { char: "🔐", keywords: "lock key secure auth security" },
      { char: "🪫", keywords: "battery low power energy" },
    ],
  },
  {
    name: "Signals",
    entries: [
      { char: "🟠", keywords: "orange circle dot brand" },
      { char: "🔴", keywords: "red circle dot stop error" },
      { char: "🟢", keywords: "green circle dot go pass ok" },
      { char: "🔵", keywords: "blue circle dot info" },
      { char: "🟣", keywords: "purple circle dot" },
      { char: "⭐", keywords: "star favourite favorite best" },
      { char: "🔥", keywords: "fire hot urgent burn trending" },
      { char: "💡", keywords: "bulb idea light insight" },
      { char: "🎯", keywords: "target goal aim bullseye focus" },
      { char: "🚩", keywords: "flag milestone mark warning" },
      { char: "📌", keywords: "pin pinned stick note" },
      { char: "🏁", keywords: "finish chequered checkered done race" },
    ],
  },
  {
    name: "Places & things",
    entries: [
      { char: "🏠", keywords: "house home main local" },
      { char: "🏢", keywords: "office building work company" },
      { char: "🌍", keywords: "earth globe world web public" },
      { char: "🌱", keywords: "seedling sprout grow new garden" },
      { char: "🌲", keywords: "tree forest evergreen branch" },
      { char: "🐙", keywords: "octopus git octocat tentacle" },
      { char: "🦀", keywords: "crab rust ferris" },
      { char: "🐍", keywords: "snake python" },
      { char: "☕", keywords: "coffee java cup brew" },
      { char: "🍕", keywords: "pizza slice food" },
      { char: "🎨", keywords: "palette art design paint colour color" },
      { char: "🎸", keywords: "guitar music rock play" },
    ],
  },
];

/**
 * Filters the groups by a search term, dropping any group left empty.
 *
 * An empty term is the whole list rather than nothing — the grid is the primary
 * way to pick, and search only narrows it.
 */
export function searchEmoji(term: string): readonly EmojiGroup[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return EMOJI_GROUPS;

  return EMOJI_GROUPS.map((group) => ({
    name: group.name,
    entries: group.entries.filter(
      (entry) => entry.keywords.includes(needle) || entry.char === term.trim(),
    ),
  })).filter((group) => group.entries.length > 0);
}
