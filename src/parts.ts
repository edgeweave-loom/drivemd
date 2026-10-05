import { slug } from "github-slugger";

/**
 * Shows the part of the note on screen that a name after a `#` stands for:
 * the element the sanitizer gave that id, as on GitHub, opening the folded
 * callouts around it. Footnotes' ids keep the encoding links have, headings'
 * do not. Nothing happens when the note has no such part.
 */
export function showPart(name: string): void {
  // A heading's text, as Obsidian's Markdown links give it, names it last.
  const part =
    document.getElementById(`user-content-${name}`) ??
    document.getElementById(`user-content-${decoded(name)}`) ??
    document.getElementById(`user-content-${slug(decoded(name))}`);
  if (!part) return;
  // The note's own folded callouts only, never one of the app's.
  for (
    let folded = part.closest(".markdown details");
    folded;
    folded = folded.parentElement?.closest(".markdown details") ?? null
  ) {
    if (folded instanceof HTMLDetailsElement) folded.open = true;
  }
  part.scrollIntoView();
  // The app's header stays at the top of the screen: the part goes below it.
  const header = document.querySelector("header.bar");
  const covered =
    (header?.getBoundingClientRect().bottom ?? 0) -
    part.getBoundingClientRect().top;
  if (covered > 0) window.scrollBy(0, -covered);
}

function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * The `#` part of an address that leads to a part of a note as Obsidian names
 * it: a heading's text, which the viewer names as GitHub does, or a block's
 * `^id`; nothing for no part.
 */
export function partHash(part: string): string {
  if (part === "") return "";
  return `#${encodeURIComponent(part.startsWith("^") ? part : slug(part))}`;
}

/** The same, for a Markdown link's `#` part, which the link encodes. */
export function linkPartHash(hash: string): string {
  return partHash(decoded(hash.slice(1)));
}

/**
 * What an Obsidian link or embed names, `Note#Heading#Sub`: its path, and
 * the headings under one another, or the block, it names, the spaces around
 * `#` taken off.
 */
export function targetOf(written: string): { path: string; parts: string[] } {
  const [path = "", ...parts] = written.split("#").map((step) => step.trim());
  return { path, parts: parts.filter((part) => part !== "") };
}
