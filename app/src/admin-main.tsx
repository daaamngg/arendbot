import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./AdminApp.tsx";
import "./styles.css";

// Отдельное приложение админки: своя страница admin.html, вход кодом через бота
const root = document.getElementById("root")!;
root.textContent = "";
createRoot(root).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
