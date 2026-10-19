import { useId, useSyncExternalStore } from "react";
import { Icon } from "./Icon.tsx";
import { useTouch } from "./layout.ts";
import { read, write } from "./storage.ts";

const KEY = "drivemd.installHint";

/** Got it, for the page, should the device keep nothing. */
let gotIt = false;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Got it in another tab.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function dismissed(): boolean {
  return gotIt || read("localStorage", KEY) !== null;
}

function dismiss(): void {
  gotIt = true;
  write("localStorage", KEY, "dismissed");
  for (const listener of listeners) listener();
}

/**
 * Whether the browser is a WebKit view on an iPhone or an iPad outside the
 * Home Screen, which Safari, other browsers there and apps' own views all
 * say, and which never offers to add a web app, as other systems do.
 */
function outsideHomeScreen(): boolean {
  return "standalone" in navigator && navigator.standalone === false;
}

/**
 * How to add DriveMD to the Home Screen, on a banner that goes for good
 * once the user taps Got it.
 */
export function InstallHint() {
  const touch = useTouch();
  const gone = useSyncExternalStore(subscribe, dismissed);
  const id = useId();
  if (gone || !touch || !outsideHomeScreen()) return null;
  return (
    <section className="banner tip" aria-labelledby={id}>
      <Icon name="ios_share" />
      <h3 id={id}>Add DriveMD to your Home Screen</h3>
      <p>
        In Safari, tap Share, then Add to Home Screen, to open DriveMD in a
        window of its own.
      </p>
      <div className="actions">
        <button type="button" className="text" onClick={dismiss}>
          Got it
        </button>
      </div>
    </section>
  );
}
