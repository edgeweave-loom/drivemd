import { createContext, useContext } from "react";
import type { Session } from "./session.ts";

/** The signed-in user's Drive, as the navigator's pages reach it. */
export type DriveAccess = Pick<Session, "drive" | "renew">;

export const DriveContext = createContext<DriveAccess | undefined>(undefined);

export function useDrive(): DriveAccess {
  const access = useContext(DriveContext);
  if (!access) throw new Error("Render this inside a DriveContext");
  return access;
}
