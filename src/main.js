// 畫面層：three.js 畫出 World 的狀態，並把鍵盤與滑鼠轉成遊戲動作
import * as THREE from "three";
import { World, movePlayer, inReach, DIG_TIME, BLOCK_TYPES, MONSTER_HP, SIZE } from "./world.js";

const ATTACK_RANGE = 3;
const GRAVITY = 20;
const JUMP_SPEED = 7;
const WALK_SPEED = 4;

const world = new World();
const player = { x: 16.5, y: 11, z: 16.5, vy: 0, onGround: true };
const keys = new Set();
const pointer = { x: innerWidth / 2, y: innerHeight / 2, down: false };
let selected = "dirt";
let camYaw = 0;
let hitFlash = 0;
let facing = Math.PI; // 角色面向的方向（一開始背對鏡頭）
let walkPhase = 0;
let moving = false;
let actionTime = 0; // 放方塊、攻擊時揮一下手

// ---------- 場景 ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe0f4); // 素材包建議的天空色
scene.fog = new THREE.Fog(0xbfe0f4, 30, 60);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
renderer.setPixelRatio(1); // 舊電腦也要 30 fps，不跟著高解析度螢幕放大
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(8, 20, 5);
scene.add(sun);

// ---------- 材質：老師的素材包（assets/textures，16×16） ----------
const loader = new THREE.TextureLoader();
function pixelTexture(name) {
  const t = loader.load(`assets/textures/${name}.png`);
  // 像素圖保持銳利
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const lam = (name) => new THREE.MeshLambertMaterial({ map: pixelTexture(name) });
// 六個面的順序：+x, -x, +y(上), -y(下), +z, -z
const sides = (side, top, bottom = top) => [side, side, top, bottom, side, side];
const MATERIALS = {
  // 泥土方塊照素材包的 Grass：上面 grass_top、側面 grass_side、底面 dirt
  dirt: sides(lam("grass_side"), lam("grass_top"), lam("dirt")),
  stone: lam("stone"),
  // Log：上下兩面 log_top，側面 log_side
  log: sides(lam("log_side"), lam("log_top")),
  planks: lam("planks"),
  sand: lam("sand"),
  brick: lam("brick"),
  leaves: new THREE.MeshLambertMaterial({ map: pixelTexture("leaves"), alphaTest: 0.5 }),
};
const NAMES = { dirt: "泥土", stone: "石頭", log: "木頭", planks: "木板", sand: "沙子", brick: "磚塊", leaves: "樹葉" };
const ICONS = { dirt: "grass", stone: "stone", log: "log", planks: "planks", sand: "sand", brick: "brick", leaves: "leaves" };

// ---------- 方塊：每種材質一個 InstancedMesh，只在世界變動時重建 ----------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const blockGroup = new THREE.Group();
scene.add(blockGroup);
let drawnVersion = -1;

function rebuildBlocks() {
  for (const child of blockGroup.children) child.dispose();
  blockGroup.clear();
  const byType = Object.fromEntries(BLOCK_TYPES.map((t) => [t, []]));
  for (const [k, type] of world.blocks) byType[type].push(k.split(",").map(Number));
  const m = new THREE.Matrix4();
  for (const type of Object.keys(byType)) {
    const cells = byType[type];
    if (!cells.length) continue;
    const mesh = new THREE.InstancedMesh(boxGeo, MATERIALS[type], cells.length);
    cells.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x + 0.5, y + 0.5, z + 0.5)));
    mesh.userData.cells = cells;
    blockGroup.add(mesh);
  }
  drawnVersion = world.version;
}

// 瞄準框與挖掘裂痕
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000 }),
);
highlight.visible = false;
scene.add(highlight);

// 裂痕：destroy_stage_0（剛開始挖）～ destroy_stage_9（快挖掉了）
const crackTex = Array.from({ length: 10 }, (_, i) => pixelTexture(`destroy_stage_${i}`));
const crack = new THREE.Mesh(
  new THREE.BoxGeometry(1.01, 1.01, 1.01),
  new THREE.MeshBasicMaterial({ map: crackTex[0], transparent: true, depthWrite: false }),
);
crack.visible = false;
scene.add(crack);

// ---------- 玩家 ----------
// 角色面向 +z；手腳用「關節」群組，轉關節就能擺動
const skin = new THREE.MeshLambertMaterial({ color: 0xf2c79b });
const shirt = new THREE.MeshLambertMaterial({ color: 0x3a7bd5 });
const pants = new THREE.MeshLambertMaterial({ color: 0x2b2d42 });
const playerMesh = new THREE.Group();
function limb(w, h, mat, x, y) {
  const joint = new THREE.Group();
  joint.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
  m.position.y = -h / 2;
  joint.add(m);
  playerMesh.add(joint);
  return joint;
}
const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.28), shirt);
torso.position.y = 1.025;
const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
head.position.y = 1.56;
const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), pants);
const eyeR = eyeL.clone();
eyeL.position.set(-0.1, 1.6, 0.22);
eyeR.position.set(0.1, 1.6, 0.22);
playerMesh.add(torso, head, eyeL, eyeR);
const armL = limb(0.16, 0.6, skin, -0.33, 1.32);
const armR = limb(0.16, 0.6, skin, 0.33, 1.32);
const legL = limb(0.2, 0.7, pants, -0.12, 0.7);
const legR = limb(0.2, 0.7, pants, 0.12, 0.7);
scene.add(playerMesh);

function animatePlayer(dt, time, target) {
  // 轉向：走路時看前進方向；站著時看滑鼠瞄準的方塊
  let want = facing;
  if (moving) want = moveYaw;
  else if (target) want = Math.atan2(target.hit.x + 0.5 - player.x, target.hit.z + 0.5 - player.z);
  let diff = ((want - facing + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  facing += diff * Math.min(1, dt * 12);
  playerMesh.rotation.y = facing;

  // 走路擺手擺腳
  walkPhase = moving ? walkPhase + dt * 10 : walkPhase * 0.8;
  const swing = Math.sin(walkPhase) * 0.7;
  legL.rotation.x = swing;
  legR.rotation.x = -swing;
  armL.rotation.x = -swing;

  // 右手：挖的時候一直揮，放方塊、攻擊時揮一下
  actionTime = Math.max(0, actionTime - dt);
  if (world.digging) armR.rotation.x = -1.2 - Math.abs(Math.sin(time * 14)) * 0.9;
  else if (actionTime > 0) armR.rotation.x = -2 * Math.sin((actionTime / 0.25) * Math.PI);
  else armR.rotation.x = swing;
}
let moveYaw = facing;

// ---------- 掉落物與怪獸 ----------
const dropMeshes = new Map();
function syncDrops(time) {
  for (const [d, mesh] of dropMeshes) {
    if (!world.drops.includes(d)) {
      scene.remove(mesh);
      dropMeshes.delete(d);
    }
  }
  for (const d of world.drops) {
    let mesh = dropMeshes.get(d);
    if (!mesh) {
      mesh = new THREE.Mesh(boxGeo, MATERIALS[d.type]);
      mesh.scale.setScalar(0.3);
      scene.add(mesh);
      dropMeshes.set(d, mesh);
    }
    // 慢慢轉、上下浮動，但不會浮到空中或穿過地面
    mesh.position.set(d.x + 0.5, d.y - 0.3 + Math.sin(time * 3) * 0.05, d.z + 0.5);
    mesh.rotation.y = time * 1.5;
  }
}

const monsterMat = new THREE.MeshLambertMaterial({ color: 0x7a1fa2 });
const monsterHitMat = new THREE.MeshLambertMaterial({ color: 0xff3355 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const monsterMeshes = new Map();
function makeMonster() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), monsterMat);
  b.position.y = 0.45;
  b.name = "body";
  const eyeGeo = new THREE.BoxGeometry(0.15, 0.15, 0.05);
  const e1 = new THREE.Mesh(eyeGeo, eyeMat);
  const e2 = new THREE.Mesh(eyeGeo, eyeMat);
  e1.position.set(-0.2, 0.6, 0.46);
  e2.position.set(0.2, 0.6, 0.46);
  g.add(b, e1, e2);
  return g;
}
function syncMonsters(time) {
  for (const [mon, mesh] of monsterMeshes) {
    if (!world.monsters.includes(mon)) {
      scene.remove(mesh);
      monsterMeshes.delete(mon);
    }
  }
  for (const mon of world.monsters) {
    let mesh = monsterMeshes.get(mon);
    if (!mesh) {
      mesh = makeMonster();
      scene.add(mesh);
      monsterMeshes.set(mon, mesh);
    }
    const ground = world.groundHeight(mon.x + 0.5, mon.z + 0.5, SIZE) ?? mon.y;
    mesh.position.set(mon.x + 0.5, ground + Math.abs(Math.sin(time * 6)) * 0.15, mon.z + 0.5);
    mesh.lookAt(player.x, mesh.position.y, player.z);
    mesh.getObjectByName("body").material = hitFlash > 0 ? monsterHitMat : monsterMat;
  }
}

// ---------- 瞄準：滑鼠指到哪一格 ----------
const raycaster = new THREE.Raycaster();
raycaster.far = 40;
function pickCell() {
  const ndc = new THREE.Vector2((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(blockGroup.children, false)[0];
  if (!hit) return null;
  const [x, y, z] = hit.object.userData.cells[hit.instanceId];
  const n = hit.face.normal;
  // 太遠的方塊挖不到，要走過去
  if (!inReach(player, { x, y, z })) return null;
  return {
    hit: { x, y, z },
    adjacent: { x: x + Math.round(n.x), y: y + Math.round(n.y), z: z + Math.round(n.z) },
  };
}

function nearestMonsterDist() {
  let best = Infinity;
  for (const m of world.monsters) best = Math.min(best, Math.hypot(m.x + 0.5 - player.x, m.z + 0.5 - player.z));
  return best;
}

// ---------- 輸入 ----------
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Space") e.preventDefault();
  const n = Number(e.code.replace("Digit", ""));
  if (n >= 1 && n <= BLOCK_TYPES.length) selected = BLOCK_TYPES[n - 1];
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => {
  keys.clear();
  pointer.down = false;
  world.stopDig();
});

const canvas = renderer.domElement;
canvas.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
canvas.addEventListener("pointerdown", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  if (e.button === 0) {
    // 怪獸在身邊：左鍵是攻擊
    if (world.monsterAlive() && nearestMonsterDist() <= ATTACK_RANGE) {
      world.attackMonster({ x: player.x - 0.5, z: player.z - 0.5 });
      hitFlash = 0.15;
      actionTime = 0.25;
      return;
    }
    pointer.down = true;
  } else if (e.button === 2) {
    const t = pickCell();
    if (!t) return;
    const { x, y, z } = t.adjacent;
    const px = Math.floor(player.x);
    const pz = Math.floor(player.z);
    const py = Math.floor(player.y + 0.01);
    // 不能把方塊放在自己身上
    if (x === px && z === pz && (y === py || y === py + 1)) return;
    if (world.placeBlock(x, y, z, selected)) actionTime = 0.25;
  }
});
addEventListener("pointerup", () => {
  pointer.down = false;
  world.stopDig();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- 每一幀 ----------
function step(dt) {
  // 鏡頭旋轉
  if (keys.has("KeyQ")) camYaw += 2 * dt;
  if (keys.has("KeyE")) camYaw -= 2 * dt;

  // 走路：WASD 依鏡頭方向
  let f = 0;
  let s = 0;
  if (keys.has("KeyW")) f += 1;
  if (keys.has("KeyS")) f -= 1;
  if (keys.has("KeyD")) s += 1;
  if (keys.has("KeyA")) s -= 1;
  moving = !!(f || s);
  if (moving) {
    const len = Math.hypot(f, s);
    const dx = ((-Math.sin(camYaw) * f + Math.cos(camYaw) * s) / len) * WALK_SPEED * dt;
    const dz = ((-Math.cos(camYaw) * f - Math.sin(camYaw) * s) / len) * WALK_SPEED * dt;
    moveYaw = Math.atan2(dx, dz);
    // 分開試 x、z，撞牆時還能沿著牆走
    const nx = movePlayer(player, dx, 0, 1);
    if (world.canWalkTo(nx.x, player.y, player.z)) player.x = nx.x;
    const nz = movePlayer(player, 0, dz, 1);
    if (world.canWalkTo(player.x, player.y, nz.z)) player.z = nz.z;
  }

  // 跳躍與重力
  if (keys.has("Space") && player.onGround) {
    player.vy = JUMP_SPEED;
    player.onGround = false;
  }
  player.vy -= GRAVITY * dt;
  player.y += player.vy * dt;
  const ground = world.groundHeight(player.x, player.z, player.y + 0.5) ?? -Infinity;
  if (player.y < -10) {
    // 把腳下挖空掉下去了：回到島中央
    player.x = player.z = 16.5;
    player.y = (world.groundHeight(16.5, 16.5, SIZE) ?? 11) + 1;
    player.vy = 0;
  } else if (player.y <= ground) {
    player.y = ground;
    player.vy = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }
  // 頭頂撞到方塊
  if (player.vy > 0 && world.getBlock(Math.floor(player.x), Math.floor(player.y + 2), Math.floor(player.z))) {
    player.vy = 0;
  }

  // 挖：按住左鍵持續挖；換到別格就重新開始
  const target = pickCell();
  if (pointer.down && target) {
    const d = world.digging;
    const same = d && d.x === target.hit.x && d.y === target.hit.y && d.z === target.hit.z;
    if (!same) world.startDig(target.hit.x, target.hit.y, target.hit.z);
  } else if (world.digging) {
    world.stopDig();
  }

  world.update(dt, { x: player.x - 0.5, z: player.z - 0.5 });
  world.pickupNear(player.x - 0.5, player.y + 0.5, player.z - 0.5);
  hitFlash = Math.max(0, hitFlash - dt);

  animatePlayer(dt, performance.now() / 1000, target);

  // 瞄準框
  highlight.visible = !!target;
  if (target) highlight.position.set(target.hit.x + 0.5, target.hit.y + 0.5, target.hit.z + 0.5);

  // 裂痕：越挖越明顯
  if (world.digging) {
    const { x, y, z, type, progress } = world.digging;
    crack.visible = true;
    crack.position.set(x + 0.5, y + 0.5, z + 0.5);
    const stage = Math.min(9, Math.floor((progress / DIG_TIME[type]) * 10));
    crack.material.map = crackTex[stage];
  } else {
    crack.visible = false;
  }
}

const hud = document.getElementById("hud");
// 方塊欄：照 BLOCK_TYPES 順序產生 1～7 格，點一下也能選
const bar = document.getElementById("bar");
for (const [i, type] of BLOCK_TYPES.entries()) {
  const el = document.createElement("div");
  el.dataset.slot = type;
  el.innerHTML = `<img src="assets/icons/${ICONS[type]}.png" alt="" />${i + 1} ${NAMES[type]}<b>0</b>`;
  el.addEventListener("pointerdown", () => (selected = type));
  bar.appendChild(el);
}
const slots = bar.querySelectorAll("[data-slot]");
const banner = document.getElementById("banner");
let last = performance.now();
let fpsTime = 0;
let fpsFrames = 0;
let fps = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const time = now / 1000;
  step(dt);

  if (world.version !== drawnVersion) rebuildBlocks();
  syncDrops(time);
  syncMonsters(time);

  playerMesh.position.set(player.x, player.y, player.z);
  const camDist = 8;
  camera.position.set(
    player.x + Math.sin(camYaw) * camDist,
    player.y + 5,
    player.z + Math.cos(camYaw) * camDist,
  );
  camera.lookAt(player.x, player.y + 1, player.z);

  // HUD
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  const digPct = world.digging
    ? Math.round(Math.min(1, world.digging.progress / DIG_TIME[world.digging.type]) * 100)
    : 0;
  hud.textContent = `${fps} fps` + (digPct ? `　挖掘 ${digPct}%` : "");
  for (const el of slots) {
    const type = el.dataset.slot;
    el.querySelector("b").textContent = world.inventory[type];
    el.classList.toggle("on", type === selected);
  }
  if (world.monsterAlive()) {
    const hp = world.monsters.map((m) => "♥".repeat(m.hp) + "♡".repeat(MONSTER_HP - m.hp)).join("　");
    banner.textContent = `⚠ 怪獸出現！走近按左鍵打敗它，才能繼續建造　${hp}`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
