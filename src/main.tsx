import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { markTab } from "./drive-tab.ts";
import { requestFromDrive } from "./drive-ui.ts";
import { sharedPage } from "./drive-web.ts";
import "./index.css";
import { hrefOf, routeOf } from "./router.ts";
import { createSession } from "./session.ts";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

// Drive's Open with gives way to the file's own address, which a reload or
// a copied address then keeps, in a tab marked as one Drive opened; Open with
// and New name the account to sign in as.
const fromDrive = requestFromDrive(new URL(window.location.href));
if (fromDrive?.action === "open") {
  history.replaceState(
    null,
    "",
    hrefOf({ name: "file", file: fromDrive.file }),
  );
}
markTab(fromDrive?.action === "open");
// A share with the installed app gives way to the page its link leads to,
// and what was shared leaves the address and the history either way.
const url = new URL(window.location.href);
if (routeOf(url).name === "share") {
  history.replaceState(null, "", sharedPage(url) ?? hrefOf({ name: "share" }));
}
const session = createSession(fromDrive?.account);

createRoot(root).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
