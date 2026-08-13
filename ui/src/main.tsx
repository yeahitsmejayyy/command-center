import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/tokens.css";
import "./styles/fonts.css";
import "./styles/drag.css";

const root = document.getElementById("root");
if (!root) throw new Error("The board has nowhere to mount: #root is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
