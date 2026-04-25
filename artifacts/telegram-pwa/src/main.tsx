import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "./lib/auth-fetch"; // Initialize auth fetch

// Apply persisted theme before React mounts to avoid a flash of wrong theme
const _storedTheme = localStorage.getItem("telechat_theme");
const _initialTheme = _storedTheme === "light" ? "light" : "dark";
document.documentElement.dataset.theme = _initialTheme;
if (_initialTheme === "dark") document.documentElement.classList.add("dark");

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