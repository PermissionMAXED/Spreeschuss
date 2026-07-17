import { GoobyApp } from "./app/App";
import "./ui/styles.css";

const mount = document.querySelector<HTMLElement>("#app");

if (!mount) throw new Error("Gooby requires an #app mount");

const app = new GoobyApp(mount);

void app.boot().catch((error: unknown) => {
  console.error(error);
  mount.innerHTML = `
    <main class="fatal-error">
      <h1>Gooby needs a tiny moment</h1>
      <p>Please close and reopen the game. Your cozy home is safe.</p>
    </main>
  `;
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void app.dispose();
  });
}
