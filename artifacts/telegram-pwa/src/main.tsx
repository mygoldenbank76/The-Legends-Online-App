import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "./lib/auth-fetch"; // Initialize auth fetch

// Apply persisted theme before React mounts to avoid a flash of wrong theme.
// Resolves "system" against the OS prefers-color-scheme media query.
const _storedTheme = localStorage.getItem("telechat_theme");
const _pref = _storedTheme === "light" || _storedTheme === "dark" || _storedTheme === "system"
  ? _storedTheme
  : "system";
const _systemDark = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-color-scheme: dark)").matches
  : true;
const _initialTheme = _pref === "system" ? (_systemDark ? "dark" : "light") : _pref;
document.documentElement.dataset.theme = _initialTheme;
if (_initialTheme === "dark") document.documentElement.classList.add("dark");
const _metaThemeColor = document.querySelector('meta[name="theme-color"]');
if (_metaThemeColor) {
  _metaThemeColor.setAttribute("content", _initialTheme === "dark" ? "#0e121c" : "#f9f9fc");
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