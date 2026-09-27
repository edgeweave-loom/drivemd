import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { createSession } from "./session.ts";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

const session = createSession();

createRoot(root).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);
