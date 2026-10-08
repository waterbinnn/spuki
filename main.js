import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createConsole } from "./console.js";
import { createSound, TRACK } from "./sound.js";

// Same models and colours as Sources/Spuki/UI/SpeakerModels.swift.
const MODELS = [
  { id: "alloy", name: "ALLOY", desc: "Brushed steel, sheet-metal horn" },
  {
    id: "tulip", name: "TULIP", desc: "Painted fibreboard, round horn",
    finishes: [
      ["cream", "CREAM", "#FFF1D6"],
      ["bubblegum", "BUBBLEGUM", "#FF8FC7"],
      ["butter", "BUTTER", "#FFE14D"],
      ["lilac", "LILAC", "#B48CFF"],
      ["tomato", "TOMATO", "#FF4A2E"],
      ["cobalt", "COBALT", "#2E5BFF"],
      ["babyblue", "BABY BLUE", "#7FD3FF"],
      ["tangerine", "TANGERINE", "#FF8A1F"],
      ["pistachio", "PISTACHIO", "#A8E07A"],
      ["chocolate", "CHOCOLATE", "#4A2414"],
    ],
  },
  {
    id: "hive", name: "SUMMER", desc: "Birch ply, frosted glass, eight-cell horn",
    // Any front goes with any horn; cream and black is the default.
    finishes: [
      ["cream", "CREAM", "#FFF1D6"],
      ["bubblegum", "BUBBLEGUM", "#FF8FC7"],
      ["butter", "BUTTER", "#FFE14D"],
      ["lilac", "LILAC", "#B48CFF"],
      ["tomato", "TOMATO", "#FF4A2E"],
      ["cobalt", "COBALT", "#2E5BFF"],
      ["babyblue", "BABY BLUE", "#7FD3FF"],
      ["tangerine", "TANGERINE", "#FF8A1F"],
      ["pistachio", "PISTACHIO", "#A8E07A"],
      ["chocolate", "CHOCOLATE", "#4A2414"],
    ],
    horns: [
      ["black", "BLACK", "#111111"],
      ["cherry", "CHERRY", "#E8173A"],
      ["hotpink", "HOT PINK", "#FF3D9A"],
      ["sunflower", "SUNFLOWER", "#FFC300"],
      ["kelly", "KELLY GREEN", "#12B35A"],
      ["cobalt", "COBALT", "#1F4BFF"],
      ["cream", "CREAM", "#F3EBD8"],
    ],
  },
];
// Earlier ALLOYs, kept for reference: not in the picker; open the page with ?model=<id>.
const LEGACY = [
  { id: "alloy-legacy", name: "ALLOY LEGACY", desc: "Brushed steel, wide sector horn" },
  { id: "alloy-neck", name: "ALLOY NECK", desc: "Brushed steel, cast neck horn" },
];

// --- Wordmark: "spuki" on a pixel grid, like the notes the horn throws out. ---
const GLYPHS = {
  s: ["...", "...", "###", "#..", "###", "..#", "###", "...", "..."],
  p: ["...", "...", "###", "#.#", "#.#", "###", "#..", "#..", "#.."],
  u: ["...", "...", "#.#", "#.#", "#.#", "#.#", "###", "...", "..."],
  k: ["#..", "#..", "#.#", "#.#", "##.", "#.#", "#.#", "...", "..."],
  i: ["#", ".", "#", "#", "#", "#", "#", ".", "."],
};
{
  const svg = document.getElementById("wordmark");
  let x = 0;
  let rects = "";
  for (const ch of "spuki") {
    const g = GLYPHS[ch];
    g.forEach((row, y) => [...row].forEach((c, dx) => {
      if (c === "#") rects += `<rect x="${x + dx}" y="${y}" width="1" height="1"/>`;
    }));
    x += g[0].length + 1;
  }
  // And the horn's eighth note beside it, in the notes' pink (PixelNotes.swift).
  x += 1;
  ["..####", "..#..#", "..#.##", "..#...", "..#...", "..#...", "###...", "###..."].forEach((row, y) =>
    [...row].forEach((c, dx) => {
      if (c === "#") rects += `<rect class="note" x="${x + dx}" y="${y}" width="1" height="1"/>`;
    }));
  x += 7;
  svg.setAttribute("viewBox", `0 0 ${x - 1} 9`);
  svg.innerHTML = rects;
}

// --- Scene ---
const stage = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Neutral keeps the front colours as picked; ACES bleaches the pale ones.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
// Far enough that the speaker fills about a quarter of the height; scroll or pinch to come closer.
const CAMERA_HOME = new THREE.Vector3(0.94, 0.61, 2.44);
camera.position.copy(CAMERA_HOME);
let zoom = 1, zoomTarget = 1;             // distance as a share of CAMERA_HOME's
const ZOOM_MIN = 0.4, ZOOM_MAX = 1.35;

const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(-1.2, 2.2, 1.6);
scene.add(key);

// A contact shadow instead of a cast one: a soft, blurred footprint right under the speaker, the way
// product shots sit on a sweep. A light's shadow trailed off to one side and swung about as the view turned.
function contactShadow(w, d) {
  const c = document.createElement("canvas");
  const px = 256, pad = 64;
  c.width = c.height = px + pad * 2;
  const g = c.getContext("2d");
  g.filter = "blur(22px)";
  g.fillStyle = "rgba(0, 0, 0, 0.55)";
  g.beginPath();
  g.roundRect(pad, pad, px, px, 30);
  g.fill();
  g.filter = "blur(6px)";                // a darker core where it actually touches
  g.fillStyle = "rgba(0, 0, 0, 0.35)";
  g.beginPath();
  g.roundRect(pad + 16, pad + 16, px - 32, px - 32, 18);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  const k = (px + pad * 2) / px;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w * k, d * k),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.0005;
  return mesh;
}

// --- Turning it: the camera stays put and the speaker itself rolls any way it is dragged,
// upside down included. Let go and it coasts; leave it and it rights itself and spins slowly.
const pivot = new THREE.Group();          // turns about the speaker's middle
const lookAt = new THREE.Vector3();
const spin = new THREE.Vector2();         // angular velocity, rad/s: x about world up, y about screen right
let dragging = null;                      // last pointer position while dragging
let lastTouch = -Infinity;
const IDLE = 6;                           // seconds before it rights itself
const AUTO_SPIN = 0.14;                   // rad/s once upright again
let lift = 0;                             // how far it is raised so a tipped speaker stays above the floor

renderer.domElement.addEventListener("pointerdown", (e) => {
  dragging = { x: e.clientX, y: e.clientY, t: performance.now() };
  renderer.domElement.setPointerCapture(e.pointerId);
  spin.set(0, 0);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const now = performance.now();
  const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
  const dt = Math.max((now - dragging.t) / 1000, 1 / 240);
  const k = 0.008;                        // radians per pixel
  turn(dx * k, dy * k);
  spin.set((dx * k) / dt, (dy * k) / dt).multiplyScalar(0.5).add(spin.clone().multiplyScalar(0.5));
  dragging = { x: e.clientX, y: e.clientY, t: now };
  lastTouch = clock.elapsedTime;
});
const endDrag = () => {
  if (dragging && performance.now() - dragging.t > 80) spin.set(0, 0);   // held still before letting go
  dragging = null;
  lastTouch = clock.elapsedTime;
};
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

// Two fingers on a phone pinch to zoom; while they are down the speaker doesn't turn.
const touches = new Map();
let pinch = null;                         // { dist, zoom } when the second finger lands
const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
renderer.domElement.addEventListener("pointerdown", (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) { pinch = { dist: spread(), zoom: zoomTarget }; dragging = null; spin.set(0, 0); }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    zoomTarget = THREE.MathUtils.clamp(pinch.zoom * pinch.dist / Math.max(spread(), 1), ZOOM_MIN, ZOOM_MAX);
    dragging = null;
    lastTouch = clock.elapsedTime;
  }
});
const fingerUp = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
renderer.domElement.addEventListener("pointerup", fingerUp);
renderer.domElement.addEventListener("pointercancel", fingerUp);

// Scroll (or pinch on a trackpad, which arrives as a ctrl-wheel) to zoom.
renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();
  const k = e.ctrlKey ? 0.01 : 0.0015;
  zoomTarget = THREE.MathUtils.clamp(zoomTarget * Math.exp(e.deltaY * k), ZOOM_MIN, ZOOM_MAX);
}, { passive: false });

const _q = new THREE.Quaternion();
const _right = new THREE.Vector3();
function turn(yaw, pitch) {
  _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
  pivot.quaternion.premultiply(_q);
  _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  _q.setFromAxisAngle(_right, pitch);
  pivot.quaternion.premultiply(_q);
}

// Upright again, facing wherever it faces now.
function uprightTarget() {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(pivot.quaternion);
  if (Math.hypot(f.x, f.z) < 1e-3) f.set(0, 0, 1);   // looking straight up or down: any heading will do
  return new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(f.x, f.z));
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + "px";
  renderer.domElement.style.height = h + "px";
  camera.aspect = w / h;
  // On a tall, narrow screen hold the width instead of the height, so the speaker still fits.
  const t = Math.tan(THREE.MathUtils.degToRad(14));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t * Math.max(1, 1.2 / camera.aspect)));
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// --- Models ---
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const holder = new THREE.Group();
// SET → SPEAKER SIZE. The holder's origin is on the floor, so it grows and shrinks standing where it is.
let size = 1, sizeTarget = 1;
scene.add(holder);
holder.add(pivot);
let current = null;      // { model, root, cone: [{ node, rest }], boards: [materials], horns: [materials] }
let finishFor = {};      // model id -> finish id, like the app remembers per model
let hornFor = {};        // model id -> horn colour id

function load(model) {
  if (!cache.has(model.id)) {
    cache.set(model.id, loader.loadAsync(`models/${model.id}.glb`).then((gltf) => prepare(model, gltf.scene)));
  }
  return cache.get(model.id);
}

function prepare(model, root) {
  const boards = [];
  const horns = [];
  const cone = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.name.startsWith("Fibreboard") || m.name.startsWith("Frosted glass")) boards.push(m);
      if (model.horns && /^Horn (black|bezel)/.test(m.name)) horns.push(m);
      if (m.transmission > 0) m.thickness = 0.004;
    }
    if (/^(Cone|Dust[ _]cap|Cap[ _]vent)/.test(o.name)) cone.push({ node: o, rest: o.position.clone() });
  });

  // Sit it on the floor, centred, and scale so every model reads the same size.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = 0.42 / Math.max(size.x, size.y, size.z);
  root.scale.setScalar(s);
  box.setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  const height = box.max.y - box.min.y;
  // Footprint of the lowest few centimetres, so a horn up top doesn't widen the shadow.
  const foot = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.min.y < 0.03) foot.union(b);          // world space: the speaker now stands on y = 0
  });
  const shadow = contactShadow(foot.max.x - foot.min.x, foot.max.z - foot.min.z);
  // It stays on the floor (outside the part that turns), so it sits in world space.
  shadow.position.set((foot.min.x + foot.max.x) / 2, 0.0005, (foot.min.z + foot.max.z) / 2);
  // Its centre as seen from the turning axis, so it can follow the speaker round (see the render loop).
  shadow.userData.centre = { x: shadow.position.x, z: shadow.position.z };

  // Notes come out of the middle of the horn's front.
  root.updateMatrixWorld(true);
  const horn = new THREE.Box3();
  root.traverse((o) => o.isMesh && /^Horn/.test(o.name) && horn.expandByObject(o));
  const mouth = horn.isEmpty() ? new THREE.Vector3(0, height, 0)
    : new THREE.Vector3((horn.min.x + horn.max.x) / 2, (horn.min.y + horn.max.y) / 2, horn.max.z);
  // Hang it from its middle so it turns about its centre, not its base.
  root.position.y -= height / 2;
  root.updateMatrixWorld(true);
  const mouthLocal = root.worldToLocal(mouth.clone().setY(mouth.y - height / 2));
  return { model, root, cone, boards, horns, height, mouth: mouthLocal, shadow };
}

function applyFinish(entry) {
  const f = entry.model.finishes;
  if (!f) return;
  const id = finishFor[entry.model.id] ?? f[0][0];
  const hex = f.find((x) => x[0] === id)[2];
  for (const m of entry.boards) m.color.set(hex);
  const h = entry.model.horns;
  if (!h) return;
  // Black is gloss; the colours are a satin moulded plastic (speaker_hive.py, paint_horn).
  const horn = hornFor[entry.model.id] ?? h[0][0];
  const black = horn === "black";
  for (const m of entry.horns) {
    m.color.set(h.find((x) => x[0] === horn)[2]);
    m.roughness = black ? (m.name.startsWith("Horn bezel") ? 0.32 : 0.12) : 0.42;
    if ("clearcoat" in m) m.clearcoat = black ? (m.name.startsWith("Horn bezel") ? 0.2 : 0.6) : 0.15;
  }
}

// What the page and the console both show: model, front colour, horn colour.
const choice = () => ({
  id: selected.id,
  finish: selected.finishes ? finishFor[selected.id] ?? selected.finishes[0][0] : null,
  horn: selected.horns ? hornFor[selected.id] ?? selected.horns[0][0] : null,
});

const loading = document.getElementById("loading");
let showing = 0;   // guards against a slow load landing after a newer pick

async function show(model) {
  const ticket = ++showing;
  loading.hidden = false;
  const entry = await load(model);
  if (ticket !== showing) return;
  loading.hidden = true;
  pivot.clear();
  pivot.add(entry.root);
  pivot.position.y = entry.height / 2;
  lift = 0;
  holder.children.filter((o) => o !== pivot).forEach((o) => holder.remove(o));
  holder.add(entry.shadow);
  current = entry;
  applyFinish(entry);
  lookAt.set(0, entry.height * 0.5 * size, 0);
  popIn = 0;
  renderPicker();
}

// --- Click the speaker to push the woofer ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let down = null;
let thump = 1;          // 0 → 1 over one push
let thumpAmp = 1;
let popIn = 1;
renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || !current) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.intersectObject(current.root, true).length) {
    thump = 0;
    thumpAmp = 1;
    for (let i = 0; i < 4; i++) setTimeout(() => spawnNote(1), i * 70);
  } else if (consoleOpen) setConsole(false);   // a click on empty space, as outside the app's window
});

// --- Pixel notes out of the horn, as on the desktop (Sources/Spuki/UI/PixelNotes.swift) ---
const NOTE_GLYPHS = [
  ["..####", "..#..#", "..#.##", "..#...", "..#...", "..#...", "###...", "###..."],   // eighth note
  ["######", "######", "#....#", "#....#", "#....#", "#....#", "##..##", "##..##"],   // two beamed notes
];
const NOTE_COLOURS = ["#ff5ea3", "#ffd93d", "#ff7a1a"];   // pink, yellow, orange
const noteTextures = NOTE_GLYPHS.map((rows) => NOTE_COLOURS.map((colour) => {
  const c = document.createElement("canvas");
  c.width = 6;
  c.height = 8;
  const g = c.getContext("2d");
  g.fillStyle = colour;
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === "#" && g.fillRect(x, y, 1, 1)));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;   // keep the pixels square
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}));

const notes = [];
const NOTE_CELL = 0.0048;   // one pixel of the sprite, in metres of the 0.42 m speaker
const rand = (a, b) => a + Math.random() * (b - a);

function spawnNote(strength = 1) {
  if (!current || notes.length > 24) return;
  const material = new THREE.SpriteMaterial({
    map: noteTextures[Math.floor(Math.random() * 2)][Math.floor(Math.random() * 3)],
    transparent: true,
    depthWrite: false,
    toneMapped: false,     // flat sticker colours, not lit
  });
  const drift = rand(-1, 1);
  material.rotation = THREE.MathUtils.degToRad(-drift * 14);
  const sprite = new THREE.Sprite(material);
  const scale = (0.8 + strength * 0.6) * NOTE_CELL * size;
  sprite.scale.set(6 * scale, 8 * scale, 1);
  sprite.renderOrder = 1;
  scene.add(sprite);
  // Sideways means sideways on screen, whichever way the camera has turned.
  const side = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  notes.push({
    sprite, drift, side,
    from: current.root.localToWorld(current.mouth.clone()),
    rise: rand(0.19, 0.3),
    born: clock.elapsedTime,
    life: rand(1.3, 1.8),
  });
}

function updateNotes(now) {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const t = Math.min((now - n.born) / n.life, 1);
    // Quick off the mark, drifting by the end; full strength for the first third, then fade.
    const e = 1 - (1 - t) ** 2;
    n.sprite.position.copy(n.from)
      .addScaledVector(n.side, n.drift * 0.07 * e)
      .add(new THREE.Vector3(0, n.rise * e, 0.03 * e));
    n.sprite.material.opacity = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
    if (t >= 1) {
      scene.remove(n.sprite);
      n.sprite.material.dispose();
      notes.splice(i, 1);
    }
  }
}

// While the sample plays, a note and a push of the woofer on every kick.
let lowsAvg = -60, lastKick = 0;

// --- Picker ---
const swatches = document.getElementById("finishes");
const hornChips = document.getElementById("horns");
const frontRow = document.getElementById("front-row");
const hornRow = document.getElementById("horn-row");
const shuffleButton = document.getElementById("shuffle");
let selected = [...MODELS, ...LEGACY].find((m) => m.id === new URLSearchParams(location.search).get("model")) ?? MODELS[0];
let consoleApi = null;   // made below, once the page's own picker exists

function renderPicker() {
  ringFollow();
  document.getElementById("name").textContent = selected.name;
  consoleApi?.setSpeaker(choice());
  document.getElementById("desc").textContent = selected.desc;

  chipRow(frontRow, swatches, selected.finishes, finishFor);
  chipRow(hornRow, hornChips, selected.horns, hornFor);
  // At the end of the last colour row's head line.
  shuffleButton.hidden = !selected.finishes;
  const last = selected.horns ? hornRow : frontRow;
  last.querySelector(".chip-head").append(shuffleButton);
}

// One row of colour chips; picking one recolours the speaker on the page.
function chipRow(wrap, row, list, chosenFor) {
  row.innerHTML = "";
  wrap.hidden = !list;
  const chosen = chosenFor[selected.id] ?? list?.[0][0];
  wrap.querySelector(".chip-name").textContent = list?.find((x) => x[0] === chosen)[1] ?? "";
  for (const [id, name, hex] of list ?? []) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.style.setProperty("--swatch", hex);
    b.title = name;
    b.setAttribute("aria-label", name);
    b.setAttribute("aria-pressed", id === chosen);
    b.onclick = () => {
      chosenFor[selected.id] = id;
      if (current?.model === selected) applyFinish(current);
      renderPicker();
    };
    li.append(b);
    row.append(li);
  }
}

// A random front and horn, never the pair already showing.
shuffleButton.onclick = () => {
  const draw = (list, now) => {
    if (!list) return now;
    const rest = list.filter((x) => x[0] !== now);
    return rest[Math.floor(Math.random() * rest.length)][0];
  };
  const c = choice();
  finishFor[selected.id] = draw(selected.finishes, c.finish);
  if (selected.horns) hornFor[selected.id] = draw(selected.horns, c.horn);
  if (current?.model === selected) applyFinish(current);
  renderPicker();
  thump = 0;     // a little bump, so the change is felt
  thumpAmp = 0.6;
};

function pick(model) {
  if (model === selected) return;
  selected = model;
  renderPicker();
  show(model);
}

// --- The ring: the three speakers along an arc, the one on show standing on the page itself and
// the other two to either side of where it came from. Drag the arc round, or click one.
const ring = document.getElementById("ring");
const RING_STEP = 6;          // degrees between neighbours
const RING_SHOWN = 1.5;       // how far to either side one is still drawn
let ringAt = 0, ringTo = 0;   // where the ring is and where it is headed, in steps (not wrapped)
let ringDrag = null;
const wrapStep = (d) => ((d + MODELS.length / 2) % MODELS.length + MODELS.length) % MODELS.length - MODELS.length / 2;
const ringItems = MODELS.map((m, i) => {
  const li = document.createElement("li");
  const b = document.createElement("button");
  b.setAttribute("aria-label", m.name);
  b.dataset.i = i;
  li.append(b);
  ring.append(li);
  return li;
});
// Each stands there in the colours last picked for it.
function ringArt() {
  MODELS.forEach((m, i) => {
    const finish = m.finishes && (finishFor[m.id] ?? m.finishes[0][0]), horn = m.horns && (hornFor[m.id] ?? m.horns[0][0]);
    const art = [`${m.id}${finish ? "-" + finish : ""}`, horn && `${m.id}-horn-${horn}`, `${m.id}-cone`].filter(Boolean).join(" ");
    const b = ringItems[i].firstChild;
    if (b.dataset.art === art) return;
    b.dataset.art = art;
    b.innerHTML = art.split(" ").map((n) => `<img src="console/speakers/${n}.png" alt="" draggable="false">`).join("");
  });
}
// The ring turns to whatever is on show, however it was picked (here, or the console's DESIGN page).
function ringFollow() {
  ringArt();
  const i = MODELS.indexOf(selected);
  if (i >= 0) ringTo += wrapStep(i - ringTo);
}
const ringSettle = () => pick(MODELS[((Math.round(ringTo) % MODELS.length) + MODELS.length) % MODELS.length]);
ring.addEventListener("pointerdown", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  ringDrag = { x: e.clientX, from: ringTo, i: +b.dataset.i, moved: false };
  ring.setPointerCapture(e.pointerId);
});
ring.addEventListener("pointermove", (e) => {
  if (!ringDrag) return;
  const dx = e.clientX - ringDrag.x;
  if (Math.abs(dx) > 5) ringDrag.moved = true;
  // One step of arc is this many pixels at the top of the circle.
  const perStep = (parseFloat(getComputedStyle(ring).getPropertyValue("--ring-r")) * RING_STEP * Math.PI) / 180;
  if (ringDrag.moved) ringAt = ringTo = ringDrag.from - dx / perStep;
});
const ringUp = () => {
  if (!ringDrag) return;
  ringTo = ringDrag.moved ? Math.round(ringTo) : ringTo + wrapStep(ringDrag.i - ringTo);
  ringDrag = null;
  ringSettle();
};
ring.addEventListener("pointerup", ringUp);
ring.addEventListener("pointercancel", ringUp);
addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key) || e.target.closest("input, textarea, [contenteditable]")) return;
  if (consoleOpen || docOpen) return;
  ringTo = Math.round(ringTo) + (e.key === "ArrowRight" ? 1 : -1);
  ringSettle();
});
function updateRing(dt) {
  if (!ringDrag) ringAt += (ringTo - ringAt) * (1 - Math.exp(-dt * 9));
  ringItems.forEach((li, i) => {
    const d = wrapStep(i - ringAt), far = Math.abs(d);
    if (far > RING_SHOWN) { if (!li.hidden) li.hidden = true; return; }
    li.hidden = false;
    li.style.transform = `translateX(-50%) rotate(${(d * RING_STEP).toFixed(3)}deg)`;
    // The one on show stands on the page itself, so its place on the arc stays empty.
    li.style.opacity = Math.min(1, Math.max(0, far * 2 - 0.6), (RING_SHOWN - far) * 4).toFixed(3);
    li.style.pointerEvents = far < 0.5 ? "none" : "";
  });
}

renderPicker();
show(selected);
MODELS.filter((m) => m !== selected).forEach(load);   // warm the others so switching is instant

// --- Console: the disc up in the corner slides the speaker left and the app's console in ---
const consolePanel = document.getElementById("console");
const consoleToggle = document.getElementById("console-toggle");
let consoleOpen = false;
let sound = { playing: false, volume: 0.72 };   // what the console says is playing
const audio = createSound();
const playButton = document.getElementById("play");
playButton.querySelector("[data-track]").textContent = `${TRACK.title} · ${TRACK.artist}`;
playButton.onclick = () => consoleApi.togglePlay();
let viewShift = new THREE.Vector2();   // where the speaker is headed on screen, in px

consoleApi = createConsole(consolePanel, {
  speakers: MODELS,
  speaker: choice,
  // DESIGN → SAVE puts that speaker "on the desktop": here, the one on the page.
  onSpeaker: ({ id, finish, horn }) => {
    const model = MODELS.find((m) => m.id === id);
    if (finish) finishFor[id] = finish;
    if (horn) hornFor[id] = horn;
    if (model === selected) {
      if (current?.model === model) applyFinish(current);
      renderPicker();
    } else pick(model);
  },
  onSize: (scale) => { sizeTarget = scale; },
  onChange: (st) => {
    sound = st;
    audio.set(st);
    playButton.setAttribute("aria-pressed", st.playing);
    playButton.querySelector("[data-label]").textContent = st.playing ? "Pause" : "Play a sample";
  },
  audio,
});
consoleApi.onQuit(() => setConsole(false));

// --- Guide and install: a panel from the right instead of another page ---
const doc = document.getElementById("doc");
// English first; Korean when the reader has picked it before.
let lang = "en";
try { lang = localStorage.getItem("spuki.lang") ?? "en"; } catch {}
function setLang(l) {
  lang = l;
  try { localStorage.setItem("spuki.lang", l); } catch {}
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === l));
  if (docOpen) setDoc(docOpen);
}
document.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
const docBody = document.getElementById("doc-body");
let docOpen = null;

function setDoc(name) {
  docOpen = name;
  document.body.classList.toggle("doc-open", !!name);
  doc.inert = !name;
  document.querySelectorAll("[data-doc]").forEach((a) => {
    if (a.dataset.doc === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (name) {
    setConsole(false);
    docBody.replaceChildren(document.getElementById(`doc-${name}-${lang}`).content.cloneNode(true));
    docBody.lang = lang;
    if (name === "install") prepareInstall();
    docBody.scrollTop = 0;
  }
  const hash = name ? `#${name}` : location.pathname + location.search;
  if (location.hash !== (name ? `#${name}` : "")) history.replaceState(null, "", hash);
}
document.querySelectorAll("[data-doc]").forEach((a) => a.addEventListener("click", (e) => {
  e.preventDefault();
  setDoc(docOpen === a.dataset.doc && a.closest("header") ? null : a.dataset.doc);
}));
document.getElementById("doc-close").onclick = () => setDoc(null);
setLang(lang);
docBody.addEventListener("click", (e) => {
  if (e.target.closest("[data-open-console]")) { setDoc(null); setConsole(true); }
  // The download itself is the link's default action; this only shows what to do next.
  if (e.target.closest("[data-download]")) {
    docBody.querySelector("[data-after]").hidden = false;
    window.goatcounter?.count?.({ path: `download-${lang}`, title: "Download Spuki", event: true });
  }
  const copy = e.target.closest("[data-copy]");
  if (copy) navigator.clipboard?.writeText(location.origin + location.pathname + "#install").then(() => (copy.textContent = copy.dataset.copied));
});

// --- Install: the button downloads the file itself, no stop at GitHub ---
// iPads also say Macintosh, but have a touch screen.
const isMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
function prepareInstall() {
  docBody.querySelector("[data-mac-only]").hidden = !isMac;
  docBody.querySelector("[data-not-mac]").hidden = isMac;
}
addEventListener("hashchange", () => setDoc(["guide", "install"].includes(location.hash.slice(1)) ? location.hash.slice(1) : null));

function targetShift() {
  // With a document open, the speaker moves into what the panel leaves (unless the panel is the whole screen).
  if (docOpen) return innerWidth - doc.offsetWidth > 240 ? new THREE.Vector2(doc.offsetWidth / 2, 0) : new THREE.Vector2();
  // On its own, it stands a little above the middle, clear of the ring of speakers under it.
  if (!consoleOpen) return new THREE.Vector2(0, matchMedia("(max-width: 700px)").matches ? 70 : 56);
  // Side by side: centre the speaker in what the console leaves. Stacked (phone): lift it above.
  // Sizes, not positions: the console is still sliding in while this is read.
  if (matchMedia("(max-width: 700px)").matches) return new THREE.Vector2(0, (consolePanel.offsetHeight + 24) / 2);
  return new THREE.Vector2((consolePanel.offsetWidth + 104) / 2, 0);
}

// The cursor that points at the disc has done its job once the EQ has been opened.
try { if (localStorage.getItem("spuki.eqSeen")) document.body.classList.add("eq-seen"); } catch {}
function setConsole(open) {
  consoleOpen = open;
  if (open) {
    document.body.classList.add("eq-seen");
    try { localStorage.setItem("spuki.eqSeen", "1"); } catch {}
  }
  if (open && docOpen) setDoc(null);
  document.body.classList.toggle("console-open", open);
  consoleToggle.setAttribute("aria-expanded", open);
  consoleToggle.title = open ? "Close the EQ" : "Open the EQ";
  consolePanel.inert = !open;
}
consoleToggle.onclick = () => setConsole(!consoleOpen);
// Anywhere else that is not a control closes it, like clicking outside the app's window.
// The stage is left to its own click above: a drag there turns the speaker.
document.addEventListener("pointerdown", (e) => {
  if (consoleOpen && !e.target.closest("#console, button, a, input, canvas")) setConsole(false);
});
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (docOpen) setDoc(null);
  else if (consoleOpen) setConsole(false);
});
if (["guide", "install"].includes(location.hash.slice(1))) setDoc(location.hash.slice(1));

// --- Loop ---
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!dragging) {
    if (clock.elapsedTime - lastTouch > IDLE) {
      // Right itself, then turn slowly like it sits on a turntable.
      pivot.quaternion.slerp(uprightTarget(), 1 - Math.exp(-dt * 2.5));
      spin.lerp(new THREE.Vector2(AUTO_SPIN, 0), 1 - Math.exp(-dt * 1.5));
    } else {
      spin.multiplyScalar(Math.exp(-dt * 2.2));      // coasting to a stop
    }
    turn(spin.x * dt, spin.y * dt);
  }
  // Tipped over, it would sink through the floor; lift it by however far its lowest corner dips below.
  if (current) {
    pivot.position.y = current.height / 2;
    pivot.updateMatrixWorld(true);
    // Upright it never dips, so skip the per-vertex walk; tilted, a loose box would float it off the floor.
    const tilted = new THREE.Vector3(0, 1, 0).applyQuaternion(pivot.quaternion).y < 0.9995;
    const dip = tilted ? new THREE.Box3().setFromObject(current.root, true).min.y : 0;
    lift += (Math.max(0, -dip) / size - lift) * (1 - Math.exp(-dt * 20));
    pivot.position.y += lift;
  }
  zoom += (zoomTarget - zoom) * (1 - Math.exp(-dt * 10));
  camera.position.copy(CAMERA_HOME).sub(lookAt).multiplyScalar(zoom).add(lookAt);
  camera.lookAt(lookAt);
  // The floor shadow only makes sense while it stands the right way up.
  if (current) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pivot.quaternion).y;
    current.shadow.material.opacity = Math.max(0, up) ** 3;
    // Turn the footprint with the speaker's heading, and carry its centre round the axis with it.
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(pivot.quaternion);
    const yaw = Math.atan2(-ax.z, ax.x), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const c = current.shadow.userData.centre;
    current.shadow.rotation.z = yaw;
    current.shadow.position.x = c.x * cy + c.z * sy;
    current.shadow.position.z = -c.x * sy + c.z * cy;
  }

  if (popIn < 1 || size !== sizeTarget) {
    popIn = Math.min(1, popIn + dt * 3);
    const e = 1 - Math.pow(1 - popIn, 3);
    size += (sizeTarget - size) * (1 - Math.exp(-dt * 12));
    if (Math.abs(sizeTarget - size) < 1e-4) size = sizeTarget;
    holder.scale.setScalar((0.94 + 0.06 * e) * size);
    holder.rotation.y = (1 - e) * -0.35;
    if (current) lookAt.set(0, current.height * 0.5 * size, 0);
  }

  if (current && thump < 1) {
    thump = Math.min(1, thump + dt * 2.2);
    // A quick push out, then a damped wobble back to rest.
    const t = thump;
    const push = Math.exp(-6 * t) * Math.sin(t * Math.PI * 5) * 0.01 * thumpAmp / current.root.scale.x;
    for (const { node, rest } of current.cone) node.position.set(rest.x, rest.y, rest.z + push);
  }

  updateRing(dt);
  // Ease the speaker toward its side of the screen; the panel's width is read live.
  viewShift.lerp(targetShift(), 1 - Math.exp(-dt * 6));
  const { clientWidth: w, clientHeight: h } = stage;
  if (viewShift.lengthSq() < 0.25) camera.clearViewOffset();
  else camera.setViewOffset(w, h, viewShift.x, viewShift.y, w, h);

  // A kick is the lows jumping well above where they have been: the more bass comes out, the harder it goes.
  const lows = audio.lows();
  if (lows > -100) {
    const now = clock.elapsedTime;
    if (popIn >= 1 && lows > lowsAvg + 5 && lows > -45 && now - lastKick > 0.22) {
      lastKick = now;
      thump = 0;
      thumpAmp = Math.min(1, Math.max(0.2, (lows + 45) / 30));
      if (Math.random() < 0.7) spawnNote(Math.random() * 0.5 + thumpAmp * 0.5);
    }
    lowsAvg += (lows - lowsAvg) * (1 - Math.exp(-dt * 4));
  }
  updateNotes(clock.elapsedTime);

  renderer.render(scene, camera);
});
