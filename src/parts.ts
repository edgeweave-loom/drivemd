/**
 * Shows the part of the note on screen that a name after a `#` stands for:
 * the element the sanitizer gave that id, as on GitHub, opening the folded
 * callouts around it. Footnotes' ids keep the encoding links have, headings'
 * do not. Nothing happens when the note has no such part.
 */
export function showPart(name: string): void {
  const part =
    document.getElementById(`user-content-${name}`) ??
    document.getElementById(`user-content-${decoded(name)}`);
  if (!part) return;
  for (
    let folded = part.closest("details");
    folded;
    folded = folded.parentElement?.closest("details") ?? null
  ) {
    folded.open = true;
  }
  part.scrollIntoView();
}

function decoded(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
