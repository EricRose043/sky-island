// 畫面層：three.js 畫出 World 的狀態，並把鍵盤與滑鼠轉成遊戲動作
import * as THREE from "three";
import { World, movePlayer, inReach, DIG_TIME, MONSTER_HP, SIZE } from "./world.js";

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
scene.background = new THREE.Color(0x9cc9ff);
scene.fog = new THREE.Fog(0x9cc9ff, 30, 60);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
renderer.setPixelRatio(1); // 舊電腦也要 30 fps，不跟著高解析度螢幕放大
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(8, 20, 5);
scene.add(sun);

// ---------- 像素材質（16×16，用程式畫，之後可換成素材包的圖） ----------
function pixelTexture(draw) {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d");
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  draw(g, rand);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(g, rand, base, spread) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const k = 1 + (rand() - 0.5) * spread;
      g.fillStyle = `rgb(${base.map((v) => Math.min(255, v * k) | 0).join(",")})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.strokeRect(0.5, 0.5, 15, 15);
}
const tex = {
  grassTop: pixelTexture((g, r) => noise(g, r, [95, 160, 60], 0.3)),
  dirt: pixelTexture((g, r) => noise(g, r, [134, 90, 52], 0.3)),
  grassSide: pixelTexture((g, r) => {
    noise(g, r, [134, 90, 52], 0.3);
    g.fillStyle = "rgb(95,160,60)";
    for (let x = 0; x < 16; x++) g.fillRect(x, 0, 1, 3 + ((r() * 2) | 0));
  }),
  stone: pixelTexture((g, r) => noise(g, r, [128, 128, 128], 0.35)),
};
const lam = (map) => new THREE.MeshLambertMaterial({ map });
const MATERIALS = {
  // 順序：+x, -x, +y(上), -y(下), +z, -z
  dirt: [lam(tex.grassSide), lam(tex.grassSide), lam(tex.grassTop), lam(tex.dirt), lam(tex.grassSide), lam(tex.grassSide)],
  stone: lam(tex.stone),
};

// ---------- 方塊：每種材質一個 InstancedMesh，只在世界變動時重建 ----------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const blockGroup = new THREE.Group();
scene.add(blockGroup);
let drawnVersion = -1;

function rebuildBlocks() {
  for (const child of blockGroup.children) child.dispose();
  blockGroup.clear();
  const byType = { dirt: [], stone: [] };
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

const crackTex = pixelTexture((g, r) => {
  g.strokeStyle = "rgba(0,0,0,0.9)";
  g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = 8, y = 8;
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (r() - 0.5) * 8;
      y += (r() - 0.5) * 8;
      g.lineTo(x, y);
    }
    g.stroke();
  }
});
const crack = new THREE.Mesh(
  new THREE.BoxGeometry(1.01, 1.01, 1.01),
  new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false }),
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
  if (e.code === "Digit1") selected = "dirt";
  if (e.code === "Digit2") selected = "stone";
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
    crack.material.opacity = Math.min(1, progress / DIG_TIME[type]);
  } else {
    crack.visible = false;
  }
}

const hud = document.getElementById("hud");
const slots = document.querySelectorAll("[data-slot]");
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
