import React from "react";
import ReactDOM from "react-dom/client";
import { applyAppearance, loadAppearance } from "@dh/ui-kit";
import "@dh/ui-kit/styles";
import App from "./App";

// Before the first render, so the window never flashes in the wrong theme.
applyAppearance(loadAppearance());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
