import "./styles.css";
import { createApp } from "./runtime/createApp";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const uiRoot = document.querySelector<HTMLDivElement>("#ui-root");

if (!canvas || !uiRoot) {
  throw new Error("Missing required DOM elements (#scene, #ui-root).");
}

const app = createApp({ canvas, uiRoot });
app.start();

window.addEventListener("pagehide", () => {
  app.dispose();
});

