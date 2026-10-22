// 空中之島的遊戲邏輯（不含畫面，方便用測試驗證）
export const SIZE = 32;
export const DIG_TIME = { dirt: 1, stone: 2 };
export const PICK_RANGE = 1.5;
export const MONSTER_HP = 3;
export const SPAWN_MIN = 10;
export const SPAWN_MAX = 20;

const key = (x, y, z) => `${x},${y},${z}`;

export function inBounds(x, y, z) {
  return [x, y, z].every((v) => Number.isInteger(v) && v >= 0 && v < SIZE);
}

export class World {
  // rng 可注入，測試時讓結果固定
  constructor(rng = Math.random) {
    this.rng = rng;
    this.blocks = new Map();
    this.drops = [];
    this.monsters = [];
    this.inventory = { dirt: 0, stone: 0 };
    this.digging = null; // { x, y, z, type, progress }
    this.nextSpawn = this.randomSpawnDelay();
    this.buildIsland();
  }

  // 一座小島：中央圓形，上層是泥土，下層是石頭
  buildIsland() {
    const c = SIZE / 2;
    for (let x = 0; x < SIZE; x++) {
      for (let z = 0; z < SIZE; z++) {
        const d = Math.hypot(x - c, z - c);
        if (d > 7) continue;
        this.blocks.set(key(x, 10, z), "dirt");
        this.blocks.set(key(x, 9, z), "stone");
      }
    }
  }

  getBlock(x, y, z) {
    return this.blocks.get(key(x, y, z)) ?? null;
  }

  monsterAlive() {
    return this.monsters.length > 0;
  }

  // 開始挖：怪獸在場時不能挖
  startDig(x, y, z) {
    if (this.monsterAlive()) return false;
    const type = this.getBlock(x, y, z);
    if (!type) return false;
    this.digging = { x, y, z, type, progress: 0 };
    return true;
  }

  // 放開左鍵：進度歸零（挖到一半放開不保留）
  stopDig() {
    this.digging = null;
  }

  // 每幀呼叫，seconds 是經過的秒數
  update(seconds, playerPos = null) {
    if (this.digging) {
      this.digging.progress += seconds;
      if (this.digging.progress >= DIG_TIME[this.digging.type]) {
        const { x, y, z, type } = this.digging;
        this.blocks.delete(key(x, y, z));
        this.drops.push({ type, x, y: y + 0.5, z });
        this.digging = null;
      }
    }

    this.nextSpawn -= seconds;
    if (this.nextSpawn <= 0 && playerPos) {
      this.spawnMonster(playerPos);
      this.nextSpawn = this.randomSpawnDelay();
    }
  }

  // 撿起：走到附近才撿，數字 +1
  pickupNear(px, py, pz) {
    const picked = [];
    this.drops = this.drops.filter((d) => {
      const dist = Math.hypot(d.x - px, d.y - py, d.z - pz);
      if (dist <= PICK_RANGE) {
        this.inventory[d.type] += 1;
        picked.push(d);
        return false;
      }
      return true;
    });
    return picked.length;
  }

  // 放回去：怪獸在場、沒有數字、格子被佔、超出範圍都放不出來
  placeBlock(x, y, z, type) {
    if (this.monsterAlive()) return false;
    if (!inBounds(x, y, z)) return false;
    if (this.inventory[type] <= 0) return false;
    if (this.getBlock(x, y, z)) return false;
    this.blocks.set(key(x, y, z), type);
    this.inventory[type] -= 1;
    return true;
  }

  randomSpawnDelay() {
    return SPAWN_MIN + this.rng() * (SPAWN_MAX - SPAWN_MIN);
  }

  // 怪獸出現在島上（離玩家至少 4 格），不會出現在玩家腳下
  spawnMonster(playerPos) {
    const tops = [];
    for (let x = 0; x < SIZE; x++) {
      for (let z = 0; z < SIZE; z++) {
        if (this.getBlock(x, 10, z) === "dirt") tops.push({ x, z });
      }
    }
    const far = tops.filter(
      (t) => Math.hypot(t.x - playerPos.x, t.z - playerPos.z) >= 4,
    );
    if (far.length === 0) return null;
    const spot = far[Math.floor(this.rng() * far.length)];
    const monster = { x: spot.x, y: 11, z: spot.z, hp: MONSTER_HP };
    this.monsters.push(monster);
    return monster;
  }

  // 攻擊最近的怪獸，血量歸零就消失
  attackMonster(playerPos, damage = 1) {
    if (!this.monsterAlive()) return false;
    let target = this.monsters[0];
    let best = Infinity;
    for (const m of this.monsters) {
      const d = Math.hypot(m.x - playerPos.x, m.z - playerPos.z);
      if (d < best) {
        best = d;
        target = m;
      }
    }
    target.hp -= damage;
    if (target.hp <= 0) {
      this.monsters = this.monsters.filter((m) => m !== target);
    }
    return true;
  }
}

// 玩家移動：限制在世界範圍內
export function movePlayer(pos, dx, dz, step = 0.2) {
  const x = Math.min(SIZE - 1, Math.max(0, pos.x + dx * step));
  const z = Math.min(SIZE - 1, Math.max(0, pos.z + dz * step));
  return { x, y: pos.y, z };
}
