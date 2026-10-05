/**
 * The text with the task whose list item starts at `offset` checked or
 * unchecked: only its `[ ]` or `[x]` changes. Undefined when no task marker
 * starts there, as for a task list written in HTML.
 */
export function toggleTask(text: string, offset: number): string | undefined {
  const marker = /^(?:[-+*]|\d{1,9}[.)])[ \t]+\[([ xX])\]/.exec(
    text.slice(offset, offset + 20),
  );
  if (!marker) return;
  const at = offset + marker[0].length - 2;
  const mark = marker[1] === " " ? "x" : " ";
  return text.slice(0, at) + mark + text.slice(at + 1);
}
