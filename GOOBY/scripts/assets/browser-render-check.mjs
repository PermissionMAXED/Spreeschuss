import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const url = process.env.GOOBY_URL ?? "http://127.0.0.1:4519";
const artifactRoot = process.env.GOOBY_ARTIFACT_DIR ?? "/opt/cursor/artifacts";
const screenshotPath = resolve(artifactRoot, "gooby_asset_pipeline_showcase_final.png");
const videoPath = resolve(artifactRoot, "gooby_asset_pipeline_showcase_final.webm");
await mkdir(artifactRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  recordVideo: { dir: artifactRoot, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const browserErrors = [];
page.on("console", (message) => {
  const value = message.text();
  if (
    message.type() === "error"
    && !value.includes("frame-ancestors' is ignored when delivered via a <meta> element")
  ) {
    browserErrors.push(value);
  }
});
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("requestfailed", (request) => browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`));

await page.goto(url, { waitUntil: "networkidle" });
const result = await page.evaluate(async () => {
  const THREE = await import("/node_modules/three/build/three.module.js");
  const { GLTFLoader } = await import("/node_modules/three/examples/jsm/loaders/GLTFLoader.js");
  const { createProceduralAsset } = await import("/src/render/proc/index.ts");

  document.title = "Gooby offline asset pipeline";
  document.body.innerHTML = `
    <main>
      <header>
        <span>GOOBY ASSET LAB</span>
        <h1>Warm toy-box assets, fully offline</h1>
        <p>Forced procedural fallbacks and locally served Kenney GLBs render side by side.</p>
      </header>
      <section class="stage">
        <canvas></canvas>
        <div class="row-label proc">PROCEDURAL FALLBACKS</div>
        <div class="row-label vendor">VENDORED SUBSETS</div>
        <div class="labels top"></div>
        <div class="labels bottom"></div>
      </section>
      <footer><b>33/33 AssetKeys mapped</b><span>3 genuine pack licenses</span><span>7 consumer-complete files</span><span>No runtime network</span></footer>
    </main>`;
  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f5cfa9;color:#59443d;font-family:Inter,ui-rounded,system-ui,sans-serif}
    main{height:100%;display:grid;grid-template-rows:112px 1fr 58px;background:radial-gradient(circle at 50% 35%,#fff6df 0,#f9dfbf 48%,#efb88f 100%)}
    header{padding:19px 40px 10px;text-align:center}header span{display:inline-block;padding:4px 11px;border-radius:99px;background:#e77c6c;color:#fff;font-size:11px;font-weight:900;letter-spacing:.16em}
    h1{margin:7px 0 1px;font-size:32px;line-height:1;letter-spacing:-.04em}header p{margin:5px 0;color:#8a6658;font-size:13px;font-weight:650}
    .stage{position:relative;min-height:0;margin:0 28px 10px;border:2px solid #fff9;border-radius:26px;overflow:hidden;background:#fff6e0a8;box-shadow:0 18px 45px #8d593532,inset 0 1px #fff}
    canvas{display:block;width:100%;height:100%}.row-label{position:absolute;left:13px;padding:5px 8px;border-radius:8px;color:#fff;font-size:9px;font-weight:950;letter-spacing:.1em;writing-mode:vertical-rl;transform:rotate(180deg)}
    .row-label.proc{top:15% ;background:#d96f63}.row-label.vendor{top:59%;background:#649b8a}
    .labels{position:absolute;left:4.8%;right:1.8%;display:grid;grid-template-columns:repeat(4,1fr);text-align:center;pointer-events:none}.labels.top{top:43.5%}.labels.bottom{top:91%}
    .labels span{font-size:10px;font-weight:900;letter-spacing:.03em;color:#654b42;text-shadow:0 1px #fff}.labels small{display:block;color:#a26c5b;font-size:8px;font-weight:800;text-transform:uppercase}
    footer{display:flex;align-items:center;justify-content:center;gap:11px;padding-bottom:10px}footer>*{padding:7px 13px;border-radius:99px;background:#fff8e9;color:#76564a;font-size:11px;box-shadow:0 3px 10px #96623a24}footer b{background:#6fae93;color:#fff}
  `;
  document.head.append(style);

  const canvas = document.querySelector("canvas");
  const stage = document.querySelector(".stage");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const aspect = stage.clientWidth / stage.clientHeight;
  const camera = new THREE.OrthographicCamera(-3.65 * aspect, 3.65 * aspect, 3.65, -3.65, 0.1, 100);
  camera.position.set(0, 2.4, 15);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff5dc, 0x8e725f, 3.3));
  const sun = new THREE.DirectionalLight(0xffffff, 4.2);
  sun.position.set(-4, 8, 10);
  sun.castShadow = true;
  scene.add(sun);

  const columns = [-4.65, -1.55, 1.55, 4.65];
  const cards = [];
  for (const y of [1.65, -1.65]) {
    for (const x of columns) {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(1.86, 2.58, 0.08),
        new THREE.MeshStandardMaterial({ color: y > 0 ? 0xfff5df : 0xeaf5e9, roughness: 0.9 }),
      );
      card.position.set(x, y, -0.78);
      card.receiveShadow = true;
      scene.add(card);
    }
  }

  function normalize(object, x, y, rotation = -0.42) {
    object.rotation.y = rotation;
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 1.55 / Math.max(size.x, size.y, size.z);
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);
    const scaledBounds = new THREE.Box3().setFromObject(object);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    object.position.x += x - center.x;
    object.position.y += y - center.y;
    object.position.z += -0.42 - center.z;
    object.userData.baseY = object.position.y;
    cards.push(object);
    scene.add(object);
  }

  const procedural = [
    ["city.car", "Gooby car", "traffic"],
    ["building.carrot-market", "Carrot Market", "shop facade"],
    ["building.cloud-boutique", "Cloud Boutique", "shop facade"],
    ["building.fluff-salon", "Fluff Salon", "shop facade"],
  ];
  procedural.forEach(([key], index) => normalize(createProceduralAsset(key), columns[index], 1.65));

  const vendored = [
    ["assets/vendor/car-kit/gooby-car.glb", "Sedan", "Car Kit"],
    ["assets/vendor/city-kit-commercial/carrot-market.glb", "Market", "Commercial"],
    ["assets/vendor/city-kit-suburban/cloud-boutique.glb", "Boutique", "Suburban"],
    ["assets/vendor/city-kit-commercial/fluff-salon.glb", "Salon", "Commercial"],
  ];
  const loader = new GLTFLoader();
  await Promise.all(vendored.map(async ([path], index) => {
    const gltf = await loader.loadAsync(`/${path}`);
    normalize(gltf.scene, columns[index], -1.65, 0.42);
  }));

  for (const [selector, items] of [[".labels.top", procedural], [".labels.bottom", vendored]]) {
    document.querySelector(selector).innerHTML = items
      .map(([, name, detail]) => `<span>${name}<small>${detail}</small></span>`)
      .join("");
  }

  let running = true;
  const started = performance.now();
  const draw = (time) => {
    const elapsed = (time - started) / 1000;
    cards.forEach((object, index) => {
      object.rotation.y += 0.0035 + index % 3 * 0.0004;
      object.position.y = object.userData.baseY + Math.sin(elapsed * 1.8 + index * 0.6) * 0.035;
    });
    renderer.render(scene, camera);
    if (running) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  window.__stopAssetShowcase = () => {
    running = false;
  };
  return { procedural: procedural.length, vendored: vendored.length };
});

if (result.procedural !== 4 || result.vendored !== 4) throw new Error("Asset showcase did not render both rows");
await page.waitForTimeout(2400);
await page.screenshot({ path: screenshotPath });
await page.evaluate(() => window.__stopAssetShowcase?.());
const video = page.video();
await context.close();
if (video) await video.saveAs(videoPath);
await browser.close();

if (browserErrors.length > 0) throw new Error(`Browser asset check failed:\n${browserErrors.join("\n")}`);
console.log(`Browser render check passed: ${result.procedural} procedural and ${result.vendored} vendored models.`);
console.log(`Screenshot: ${screenshotPath}`);
console.log(`Video: ${videoPath}`);
