import { test } from "node:test";
import assert from "node:assert/strict";
import { World, movePlayer, SIZE, MONSTER_HP, SPAWN_MAX } from "../src/world.js";

const center = { x: 16, y: 11, z: 16 };

// STEP 0　小島和走路
test("STEP 0: 世界不超過 32 × 32 × 32，島上有方塊", () => {
  const w = new World();
  assert.equal(SIZE, 32);
  assert.equal(w.getBlock(16, 10, 16), "dirt");
});

test("STEP 0: 走路不會走出島的邊界", () => {
  let p = { x: 0, y: 11, z: 0 };
  p = movePlayer(p, -1, -1);
  assert.ok(p.x >= 0 && p.z >= 0);
  p = { x: 31, y: 11, z: 31 };
  p = movePlayer(p, 1, 1);
  assert.ok(p.x <= SIZE - 1 && p.z <= SIZE - 1);
});

test("STEP 0: 島的邊緣外沒有地面，走不出去", () => {
  const w = new World();
  assert.equal(w.canWalkTo(16.5, 11, 16.5), true);
  assert.equal(w.canWalkTo(1.5, 11, 1.5), false);
});

test("STEP 0: 不能穿過方塊", () => {
  const w = new World();
  w.inventory.dirt = 1;
  w.placeBlock(17, 11, 16, "dirt");
  assert.equal(w.canWalkTo(17.5, 11, 16.5), false);
});

test("STEP 0: 站的高度是腳下最高的方塊上面", () => {
  const w = new World();
  assert.equal(w.groundHeight(16.5, 16.5, 11), 11);
  w.inventory.dirt = 1;
  w.placeBlock(16, 11, 16, "dirt");
  assert.equal(w.groundHeight(16.5, 16.5, 12), 12);
});

// STEP 1　挖方塊
test("STEP 1: 只點一下（不到 1 秒）方塊不會消失", () => {
  const w = new World();
  w.startDig(16, 10, 16);
  w.update(0.5);
  assert.equal(w.getBlock(16, 10, 16), "dirt");
});

test("STEP 1: 泥土挖滿 1 秒會消失", () => {
  const w = new World();
  w.startDig(16, 10, 16);
  w.update(1.1);
  assert.equal(w.getBlock(16, 10, 16), null);
});

test("STEP 1: 石頭比泥土久，大約 2 秒", () => {
  const w = new World();
  w.startDig(16, 9, 16);
  w.update(1.5);
  assert.equal(w.getBlock(16, 9, 16), "stone");
  w.update(0.6);
  assert.equal(w.getBlock(16, 9, 16), null);
});

test("STEP 1: 挖到一半放開，進度不保留", () => {
  const w = new World();
  w.startDig(16, 10, 16);
  w.update(0.9);
  w.stopDig();
  w.startDig(16, 10, 16);
  w.update(0.2);
  assert.equal(w.getBlock(16, 10, 16), "dirt");
});

// STEP 2　掉出來
test("STEP 2: 挖掉後彈出同種類的小方塊", () => {
  const w = new World();
  w.startDig(16, 10, 16);
  w.update(1.1);
  assert.equal(w.drops.length, 1);
  assert.equal(w.drops[0].type, "dirt");
});

// STEP 3　撿起來
test("STEP 3: 走到附近撿起，數字 +1", () => {
  const w = new World();
  w.startDig(16, 10, 16);
  w.update(1.1);
  const d = w.drops[0];
  w.pickupNear(d.x, d.y, d.z);
  assert.equal(w.inventory.dirt, 1);
  assert.equal(w.drops.length, 0);
});

test("STEP 3: 站在 3 格外不會撿起", () => {
  const w = new World();
  w.startDig(16, 10, 16);
  w.update(1.1);
  const d = w.drops[0];
  w.pickupNear(d.x + 3, d.y, d.z);
  assert.equal(w.inventory.dirt, 0);
  assert.equal(w.drops.length, 1);
});

// STEP 4　放回去
test("STEP 4: 放一格，數字 −1", () => {
  const w = new World();
  w.inventory.dirt = 2;
  assert.equal(w.placeBlock(16, 12, 16, "dirt"), true);
  assert.equal(w.inventory.dirt, 1);
  assert.equal(w.getBlock(16, 12, 16), "dirt");
});

test("STEP 4: 數字是 0 時放不出來", () => {
  const w = new World();
  assert.equal(w.placeBlock(16, 12, 16, "dirt"), false);
});

test("STEP 4: 整串走一遍（挖 → 掉 → 撿 → 放），數字回到原本", () => {
  const w = new World();
  w.startDig(16, 10, 16);
  w.update(1.1);
  const d = w.drops[0];
  w.pickupNear(d.x, d.y, d.z);
  assert.equal(w.inventory.dirt, 1);
  assert.equal(w.placeBlock(16, 10, 16, "dirt"), true);
  assert.equal(w.inventory.dirt, 0);
});

// STEP 5　怪獸出現
test("STEP 5: 等待一段時間後，怪獸隨機出現", () => {
  const w = new World(() => 0.5); // 固定亂數
  w.update(w.nextSpawn + 0.1, center);
  assert.equal(w.monsters.length, 1);
});

test("STEP 5: 怪獸不會出現在玩家腳下（至少 4 格）", () => {
  const w = new World(() => 0.5);
  const m = w.spawnMonster(center);
  assert.ok(Math.hypot(m.x - center.x, m.z - center.z) >= 4);
});

test("STEP 5: 怪獸還沒被打敗前，不會再出現第二隻", () => {
  const w = new World(() => 0.5);
  w.update(w.nextSpawn + 0.1, center);
  for (let i = 0; i < 10; i++) w.update(SPAWN_MAX + 1, center);
  assert.equal(w.monsters.length, 1);
});

// STEP 6　打敗怪獸
test("STEP 6: 怪獸存在時，放方塊放不出來", () => {
  const w = new World(() => 0.5);
  w.inventory.dirt = 1;
  w.spawnMonster(center);
  assert.equal(w.placeBlock(16, 12, 16, "dirt"), false);
});

test("STEP 6: 怪獸存在時，挖方塊也不能開始", () => {
  const w = new World(() => 0.5);
  w.spawnMonster(center);
  assert.equal(w.startDig(16, 10, 16), false);
});

test("STEP 6: 攻擊扣血，血量歸零後怪獸消失", () => {
  const w = new World(() => 0.5);
  w.spawnMonster(center);
  for (let i = 0; i < MONSTER_HP; i++) w.attackMonster(center);
  assert.equal(w.monsters.length, 0);
});

// STEP 7　打敗後繼續建造
test("STEP 7: 怪獸消失後，挖、撿、放都解鎖", () => {
  const w = new World(() => 0.5);
  w.inventory.dirt = 1;
  w.spawnMonster(center);
  for (let i = 0; i < MONSTER_HP; i++) w.attackMonster(center);
  assert.equal(w.startDig(16, 10, 16), true);
  w.update(1.1);
  assert.equal(w.drops.length, 1);
  w.pickupNear(w.drops[0].x, w.drops[0].y, w.drops[0].z);
  assert.equal(w.placeBlock(16, 12, 16, "dirt"), true);
});
