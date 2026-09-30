import { MY_DRIVE } from "./drive.ts";
import { hrefOf, type Crumb } from "./router.ts";

/** Where every path through the navigator starts. */
export const ROOTS = {
  myDrive: {
    name: "My Drive",
    href: hrefOf({ name: "folder", folder: { id: MY_DRIVE } }),
  },
  shortcuts: { name: "Shortcuts", href: hrefOf({ name: "shortcuts" }) },
  sharedDrives: {
    name: "Shared drives",
    href: hrefOf({ name: "shared-drives" }),
  },
  sharedWithMe: {
    name: "Shared with me",
    href: hrefOf({ name: "shared-with-me" }),
  },
} satisfies Record<string, Crumb>;
