import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { registerSW } from "virtual:pwa-register";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerSW({
  immediate: true,

  onNeedRefresh() {
    console.log("Nueva versión disponible");
  },

  onOfflineReady() {
    console.log("ClueKeeper lista para funcionar offline");
  },
});
