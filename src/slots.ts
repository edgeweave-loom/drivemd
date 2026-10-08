import { createContext } from "react";

/** The places of a note's app bar that the note's page fills. */
export type SlotName = "title" | "mode" | "save";

export type Slots = Partial<Record<SlotName, HTMLElement>>;

/** The app bar's places, once it shows them; none outside the navigator. */
export const SlotsContext = createContext<Slots | undefined>(undefined);
