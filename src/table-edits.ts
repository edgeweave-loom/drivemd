import type { IconName } from "./icons.ts";
import { ALIGNING, type Alignment, type TableEdit } from "./live-preview.ts";

/**
 * Obsidian's items, in its words, in its groups. On a touch screen, those
 * with an icon are the keyboard toolbar's keys in a cell, and the menu of
 * its Table options key holds the others.
 */
export const TABLE_EDITS: {
  edit: TableEdit;
  name: string;
  icon?: IconName;
}[][] = [
  [
    { edit: "addRowAbove", name: "Add row above" },
    { edit: "addRowBelow", name: "Add row below", icon: "add_row_below" },
    { edit: "moveRowUp", name: "Move row up" },
    { edit: "moveRowDown", name: "Move row down" },
    { edit: "deleteRow", name: "Delete row", icon: "delete_row" },
  ],
  [
    { edit: "addColumnLeft", name: "Add column to the left" },
    {
      edit: "addColumnRight",
      name: "Add column to the right",
      icon: "add_column_right",
    },
    { edit: "moveColumnLeft", name: "Move column left" },
    { edit: "moveColumnRight", name: "Move column right" },
    { edit: "deleteColumn", name: "Delete column", icon: "delete_column" },
  ],
  [
    { edit: "alignLeft", name: "Align left", icon: "format_align_left" },
    { edit: "alignCenter", name: "Align center", icon: "format_align_center" },
    { edit: "alignRight", name: "Align right", icon: "format_align_right" },
  ],
];

/** The alignment an edit gives its column, if it aligns it. */
export const ALIGNS: Partial<Record<TableEdit, Alignment>> = ALIGNING;
