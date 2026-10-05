import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { requestFromDrive } from "./drive-ui.ts";
import "./index.css";
import { hrefOf } from "./router.ts";
import { createSession } from "./session.ts";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

// Drive's Open with gives way to the file's own address, which a reload or
// a copied address then keeps, and names the account to sign in as.
const fromDrive = requestFromDrive(new URL(window.location.href));
if (fromDrive) {
  history.replaceState(
    null,
    "",
    hrefOf({ name: "file", file: fromDrive.file }),
  );
}
const session = createSession(fromDrive?.account);

createRoot(root).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
