// 畫面層：three.js 畫出 World 的狀態，並把鍵盤與滑鼠轉成遊戲動作
import * as THREE from "three";
import { World, movePlayer, DIG_TIME } from "./world.js";

const COLORS = { dirt: 0x8b5a2b, stone: 0x888888 };
const MONSTER_COLOR = 0x7a1fa2;
const BLOCK_SIZE = 1;

const world = new World();
const player = { x: 16, y: 11, z: 16 };
const keys = new Set();
let vy = 0;
let onGround = true;
let pointer = { x: 0, y: 0, down: false };

// 場景與相機
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc9ff);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(10, 20, 10);
scene.add(sun);

const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
const mats = {
  dirt: new THREE.MeshLambertMaterial({ color: COLORS.dirt }),
  stone: new THREE.MeshLambertMaterial({ color: COLORS.stone }),
};
const blockMeshes = new Map();
const dropMeshes = new Map();
const monsterMeshes = new Map();
const monsterMat = new THREE.MeshLambertMaterial({ color: MONSTER_COLOR });
const playerMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 1.2, 0.6),
  new THREE.MeshLambertMaterial({ color: 0xffd166 }),
);
scene.add(playerMesh);

const hud = document.getElementById("hud");
const raycaster = new THREE.Raycaster();

function ensureBlockMeshes() {
  // 方塊變動時重畫：先清掉舊的，再依狀態重新加入
  for (const m of blockMeshes.values()) scene.remove(m);
  blockMeshes.clear();
  for (const [k, type] of world.blocks) {
    const [x, y, z] = k.split(",").map(Number);
    const mesh = new THREE.Mesh(geo, mats[type]);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.userData.cell = { x, y, z };
    scene.add(mesh);
    blockMeshes.set(k, mesh);
  }
}

function syncDrops() {
  for (const m of dropMeshes.values()) scene.remove(m);
  dropMeshes.clear();
  for (const d of world.drops) {
    const m = new THREE.Mesh(geo, mats[d.type]);
    m.scale.setScalar(0.35);
    m.position.set(d.x + 0.5, d.y, d.z + 0.5);
    scene.add(m);
    dropMeshes.set(d, m);
  }
}

function syncMonsters() {
  for (const m of monsterMeshes.values()) scene.remove(m);
  monsterMeshes.clear();
  for (const mon of world.monsters) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), monsterMat);
    m.position.set(mon.x + 0.5, mon.y + 0.45, mon.z + 0.5);
    scene.add(m);
    monsterMeshes.set(mon, m);
  }
}

// 滑鼠指到的方塊（用來挖或放）
function pickCell() {
  const ndc = new THREE.Vector2(
    (pointer.x / innerWidth) * 2 - 1,
    -(pointer.y / innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects([...blockMeshes.values()])[0];
  if (!hit) return null;
  const cell = hit.object.userData.cell;
  const n = hit.face.normal;
  return {
    hit: cell,
    adjacent: { x: cell.x + Math.round(n.x), y: cell.y + Math.round(n.y), z: cell.z + Math.round(n.z) },
  };
}

function distToMonster() {
  let best = null;
  for (const m of world.monsters) {
    const d = Math.hypot(m.x - player.x, m.z - player.z);
    if (best === null || d < best) best = d;
  }
  return best;
}

addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Space" && onGround) {
    vy = 0.3;
    onGround = false;
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("pointermove", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
addEventListener("pointerdown", (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  const target = pickCell();
  if (e.button === 0) {
    // 怪獸在身邊就攻擊；否則挖方塊
    if (world.monsterAlive() && distToMonster() <= 3) {
      world.attackMonster(player);
      return;
    }
    if (target) {
      pointer.down = true;
      world.startDig(target.hit.x, target.hit.y, target.hit.z);
    }
  } else if (e.button === 2) {
    if (target) world.placeBlock(target.adjacent.x, target.adjacent.y, target.adjacent.z, "dirt");
  }
});
addEventListener("pointerup", () => {
  pointer.down = false;
  world.stopDig();
});
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function step(dt) {
  // 移動：WASD 相對於鏡頭方向
  let dx = 0;
  let dz = 0;
  if (keys.has("KeyW")) dz -= 1;
  if (keys.has("KeyS")) dz += 1;
  if (keys.has("KeyA")) dx -= 1;
  if (keys.has("KeyD")) dx += 1;
  if (dx || dz) {
    const next = movePlayer(player, dx, dz, 0.08);
    player.x = next.x;
    player.z = next.z;
  }

  // 跳躍與重力（簡單處理，落回第 11 層）
  vy -= 0.02;
  player.y += vy;
  if (player.y <= 11) {
    player.y = 11;
    vy = 0;
    onGround = true;
  }

  world.update(dt, player);
  world.pickupNear(player.x, player.y, player.z);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  step(dt);

  playerMesh.position.set(player.x + 0.5, player.y + 0.6, player.z + 0.5);
  camera.position.set(player.x + 0.5, player.y + 6, player.z + 9);
  camera.lookAt(player.x + 0.5, player.y + 0.5, player.z + 0.5);

  ensureBlockMeshes();
  syncDrops();
  syncMonsters();

  const digPct = world.digging
    ? Math.round((world.digging.progress / DIG_TIME[world.digging.type]) * 100)
    : 0;
  hud.textContent =
    `泥土 ${world.inventory.dirt}　石頭 ${world.inventory.stone}` +
    (world.monsterAlive() ? "　⚠ 怪獸出現！打敗它才能繼續建造" : "") +
    (digPct ? `　挖掘 ${digPct}%` : "");

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
