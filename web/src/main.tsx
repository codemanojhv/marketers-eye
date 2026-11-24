import { createRoot } from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Dashboard, type DashboardBundle } from "./dashboard.js";
import { WorkspaceApp } from "./workspace.js";
import "./index.css";

Object.assign(window, { marked, DOMPurify });
window.dispatchEvent(new Event("marketers-eye-renderer-ready"));

declare global {
  interface Window {
    marketersEyeBundle?: DashboardBundle;
    marketersEyeRenderOverview?: (bundle: DashboardBundle) => void;
    marketersEyeOpenEvidence?: (ids: string[]) => void;
  }
}

const mount = document.getElementById("overviewDashboard");
const workspaceMount = document.getElementById("workspaceApp");
if (workspaceMount) createRoot(workspaceMount).render(<WorkspaceApp />);
if (mount) {
  const root = createRoot(mount);
  window.marketersEyeRenderOverview = bundle => root.render(<Dashboard bundle={bundle} />);
  if (window.marketersEyeBundle) window.marketersEyeRenderOverview(window.marketersEyeBundle);
}
