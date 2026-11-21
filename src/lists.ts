import type { Command } from "@codemirror/view";
import { cycleTask, toggleList, toggleNumbered } from "./formatting.ts";
import type { IconName } from "./icons.ts";

/**
 * The lists that the formatting toolbar's buttons make, and the keyboard
 * toolbar's from List's menu.
 */
export const LISTS: readonly {
  name: string;
  command: Command;
  icon: IconName;
}[] = [
  { name: "Bulleted list", command: toggleList, icon: "format_list_bulleted" },
  {
    name: "Numbered list",
    command: toggleNumbered,
    icon: "format_list_numbered",
  },
  { name: "Checkbox", command: cycleTask, icon: "check_box" },
];
