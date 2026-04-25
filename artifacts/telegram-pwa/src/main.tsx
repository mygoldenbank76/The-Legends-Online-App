import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "./lib/auth-fetch"; // Initialize auth fetch

// Theme is locked to dark for the whole platform.
document.documentElement.dataset.theme = "dark";
document.documentElement.classList.add("dark");
const _metaThemeColor = document.querySelector('meta[name="theme-color"]');
if (_metaThemeColor) {
  _metaThemeColor.setAttribute("content", "#0e121c");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const basePath = import.meta.env.BASE_URL || '/';
    navigator.serviceWorker.register(`${basePath}sw.js`).catch((err) => {
      console.log("ServiceWorker registration failed: ", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);