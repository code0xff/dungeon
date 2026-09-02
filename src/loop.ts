import * as THREE from 'three';
import { clipDuration, flashLoadedMesh, setAnim } from './assets';
import { audioReady, lastBeat, setLastBeat, sfxCreature, sfxHeartbeat, sfxReloadStep } from './audio';
import {
  ATTACK_IMPACT, ATTACK_IMPACT_REACH, CELL, EYE_H, FALLBACK_ATTACK_TIME, LOOT_TIME,
  MUSKET_RELOAD, SPEED, TURN_RATE, WALK_CLIP_SPEED, WALK_TIMESCALE_RANGE, WALL_H,
} from './config';
import { playerHurt } from './combat';
import { findPath } from './dungeon';
import { edgeTurn, keys, moveVec } from './input';
import { openChest } from './loot';
import {
  DUST, camera, dustGeo, flashLight, MUSKET_REST, musket, muzzleFlash, portal, portalCore,
  renderFrame, scene, SMOKE_REST_Y, smoke, sword, SWORD_REST, torch,
} from './scene';
import { state } from './state';
import { collides } from './world';
import type { CreatureRig, Monster, MonsterPlayback } from './types';
import {
  cancelLoot, drawMinimap, endRun, lootBtn, lootFillEl,
  promptEl, reloadBarEl, reloadFillEl, updateHUD,
} from './ui';

// ================= 크리처 애니메이션 =================
/** 외부 모델: 상황에 맞는 클립만 골라 주고 믹서에 시간을 넘긴다. */
function animLoaded(m: Monster, pb: MonsterPlayback, dt: number): void {
  const flash = m.hurtT > 0;
  if (flash) m.hurtT -= dt;
  flashLoadedMesh(m.mesh, flash);

  if (m.attackT > 0) {
    // 공격 클립은 startAttack이 이미 틀어놨다. 끝날 때까지 건드리지 않는다.
  } else if (m.moving) {
    setAnim(pb, 'walk');
    // 발이 미끄러지지 않게 재생 속도를 실제 이동 속도에 맞춘다.
    if (pb.action) {
      const [lo, hi] = WALK_TIMESCALE_RANGE;
      const scale = (m.type.speed * m.speedMul) / WALK_CLIP_SPEED;
      pb.action.timeScale = Math.max(lo, Math.min(hi, scale));
    }
  } else {
    setAnim(pb, 'idle');
  }

  m.moving = false;
  pb.mixer.update(dt);
}

/** 폴백 박스 모델: 사인파로 팔다리를 흔든다. */
function animProcedural(m: Monster, rig: CreatureRig, dt: number, now: number): void {
  const t = m.type;
  const flash = m.hurtT > 0;
  if (flash) m.hurtT -= dt;
  for (const mt of rig.mats) mt.emissive.setHex(flash ? 0x7a1a1a : 0x000000);

  if (m.attackT > 0) {
    // 팔을 크게 치켜들었다 내린다.
    const k = Math.sin((1 - m.attackT / FALLBACK_ATTACK_TIME) * Math.PI);
    rig.armL.rotation.x = rig.armBase[0] - k * 1.4;
    rig.armR.rotation.x = rig.armBase[1] - k * 1.4;
    m.moving = false;
    return;
  }

  m.anim += dt * (m.moving ? t.animSpeed : 1.4);
  const sw = m.moving ? t.swing : 0.08;
  rig.armL.rotation.x = rig.armBase[0] + Math.sin(m.anim) * sw;
  rig.armR.rotation.x = rig.armBase[1] - Math.sin(m.anim) * sw * 0.6;
  rig.legL.rotation.x = Math.sin(m.anim) * sw * 0.9;
  rig.legR.rotation.x = -Math.sin(m.anim) * sw * rig.limp;
  rig.torso.rotation.z = Math.sin(m.anim * 0.5) * 0.06;
  rig.head.rotation.z = Math.sin(now * 0.0017 + m.bobSeed) * 0.12;
  // 걸을 때 몸 전체가 위아래로 튄다.
  m.mesh.position.y = m.moving ? Math.abs(Math.sin(m.anim)) * 0.05 : 0;
  m.moving = false;
}

/** 공격 모션을 시작한다. 클립이 있으면 그 길이를 그대로 존중한다. */
function startAttack(m: Monster): void {
  const clip = m.playback ? clipDuration(m.playback, 'attack') : null;
  const dur = clip ?? FALLBACK_ATTACK_TIME;
  m.attackT = dur;
  // 타격은 모션 시작이 아니라 팔이 내려오는 중간에 터진다.
  m.pendingHit = dur * ATTACK_IMPACT;
  // 모션이 끝나기 전에 다음 공격이 겹치지 않게 한다.
  m.atkCd = Math.max(m.type.atkCd, dur);
  if (m.playback) setAnim(m.playback, 'attack', { loop: false, force: true, fade: 0.08 });
}

/** 각도를 목표까지 최대 maxStep만큼만 돌린다 (-π~π 최단 경로). */
function turnToward(current: number, target: number, maxStep: number): number {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

// ================= 플레이어 =================
/** 이번 프레임에 움직였는지 돌려준다 (루팅 취소 판정에 쓴다). */
function updatePlayer(dt: number, now: number): boolean {
  if (keys['ArrowLeft']) state.yaw += 2.2 * dt;
  if (keys['ArrowRight']) state.yaw -= 2.2 * dt;
  edgeTurn(dt);

  let f = 0, s = 0;
  if (keys['KeyW'] || keys['ArrowUp']) f += 1;
  if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
  if (keys['KeyA']) s -= 1;
  if (keys['KeyD']) s += 1;
  f += -moveVec.y;
  s += moveVec.x;

  const len = Math.hypot(f, s);
  let moving = false;
  if (len > 0.01) {
    moving = true;
    // 대각선이 빨라지지 않게 정규화하되, 스틱의 미세 입력은 그대로 둔다.
    f /= Math.max(len, 1);
    s /= Math.max(len, 1);
    const dx = (Math.sin(state.yaw) * f - Math.cos(state.yaw) * s) * SPEED * dt;
    const dz = (Math.cos(state.yaw) * f + Math.sin(state.yaw) * s) * SPEED * dt;
    // 축을 따로 밀어야 벽을 스치며 미끄러진다.
    if (!collides(state.pos.x + dx, state.pos.z)) state.pos.x += dx;
    if (!collides(state.pos.x, state.pos.z + dz)) state.pos.z += dz;
  }
  state.pos.y = EYE_H + (moving ? Math.sin(now * 0.012) * 0.045 : 0);
  return moving;
}

// ================= 무기 =================
function updateWeapons(dt: number): void {
  state.atkTimer = Math.max(0, state.atkTimer - dt);

  // ---- 검 휘두르기 ----
  if (state.swingT >= 0) {
    state.swingT += dt * 4.5;
    if (state.swingT >= 1) {
      state.swingT = -1;
      sword.rotation.copy(SWORD_REST.rot);
      sword.position.copy(SWORD_REST.pos);
    } else {
      const k = Math.sin(state.swingT * Math.PI);
      sword.rotation.x = SWORD_REST.rot.x - k * 1.1;
      sword.position.z = SWORD_REST.pos.z - k * 0.25;
    }
  }

  // ---- 머스킷 장전 ----
  if (state.reloadT >= 0) {
    state.reloadT += dt;
    reloadFillEl.style.width = Math.min(100, (state.reloadT / MUSKET_RELOAD) * 100) + '%';
    const step = Math.floor((state.reloadT / MUSKET_RELOAD) * 3);
    if (String(step) !== reloadBarEl.dataset.step && step < 3) {
      reloadBarEl.dataset.step = String(step);
      sfxReloadStep(step);
    }
    // 장전 중엔 총을 내린다.
    musket.position.y = MUSKET_REST.y - Math.sin(Math.min(1, state.reloadT / 0.4) * (Math.PI / 2)) * 0.12;
    if (state.reloadT >= MUSKET_RELOAD) {
      state.reloadT = -1;
      state.loaded = true;
      reloadBarEl.style.display = 'none';
      musket.position.y = MUSKET_REST.y;
      updateHUD();
    }
  }

  // ---- 반동 ----
  if (state.recoilT >= 0) {
    state.recoilT += dt * 5;
    const k = state.recoilT < 1 ? Math.sin(state.recoilT * Math.PI) : 0;
    musket.position.z = MUSKET_REST.z + k * 0.16;
    musket.rotation.x = MUSKET_REST.rotX + k * 0.22;
    if (state.recoilT >= 1) state.recoilT = -1;
  }

  // ---- 총구 화염 ----
  if (state.flashT > 0) {
    state.flashT -= dt;
    if (state.flashT <= 0) {
      muzzleFlash.visible = false;
      flashLight.intensity = 0;
    } else {
      flashLight.intensity = 3.5 * (state.flashT / 0.09);
    }
  }

  // ---- 연기 ----
  if (smoke.material.opacity > 0) {
    smoke.material.opacity = Math.max(0, smoke.material.opacity - dt * 1.1);
    smoke.scale.multiplyScalar(1 + dt * 2.5);
    smoke.position.y += dt * 0.4;
    if (smoke.material.opacity <= 0) smoke.position.y = SMOKE_REST_Y;
  }
}

// ================= 크리처 =================
/** 가장 가까운 살아있는 크리처와의 거리를 돌려준다 (심장박동 강도용). */
function updateMonsters(dt: number, now: number): number {
  let nearest = 99;
  const pgx = Math.round(state.pos.x / CELL), pgz = Math.round(state.pos.z / CELL);

  for (const m of state.monsters) {
    if (m.hp <= 0) {
      // 사망 모션을 끝까지 재생한 뒤 씬에서 치운다.
      if (m.dead) {
        m.playback?.mixer.update(dt);
        m.deadT -= dt;
        if (m.deadT <= 0) {
          scene.remove(m.mesh);
          m.dead = false;
        }
      }
      continue;
    }

    const t = m.type;
    m.atkCd = Math.max(0, m.atkCd - dt);

    const dx = state.pos.x - m.mesh.position.x, dz = state.pos.z - m.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    nearest = Math.min(nearest, dist);

    // ---- 공격 모션 진행 ----
    const attacking = m.attackT > 0;
    if (attacking) {
      m.attackT -= dt;
      if (m.pendingHit !== null) {
        m.pendingHit -= dt;
        if (m.pendingHit <= 0) {
          m.pendingHit = null;
          // 팔이 내려온 시점에도 사거리 안이어야 맞는다 — 뒤로 빠지면 헛스윙.
          if (dist < t.reach * ATTACK_IMPACT_REACH) playerHurt(t.dmg);
        }
      }
    }

    m.groanT -= dt;
    if (m.groanT <= 0) {
      m.groanT = t.groan[0] + Math.random() * (t.groan[1] - t.groan[0]);
      if (dist < 13) sfxCreature(m.key, Math.max(0.15, 1 - dist / 13));
    }
    if (m.alert > 0) m.alert -= dt;

    const aggroed = dist < t.aggro || m.alert > 0;

    if (aggroed) {
      // 공격 중엔 제자리에 서서 모션을 끝낸다.
      if (!attacking) {
        // 가까우면 직선으로, 멀면 BFS 첫 걸음을 향해 간다.
        let tx: number, tz: number;
        if (dist < CELL * 1.4) {
          tx = state.pos.x;
          tz = state.pos.z;
        } else {
          m.repath -= dt;
          if (m.repath <= 0 || !m.step) {
            m.step = findPath(state.maze, Math.round(m.mesh.position.x / CELL), Math.round(m.mesh.position.z / CELL), pgx, pgz);
            m.repath = 0.4;
          }
          if (m.step) {
            tx = m.step[0] * CELL;
            tz = m.step[1] * CELL;
          } else {
            tx = m.mesh.position.x;
            tz = m.mesh.position.z;
          }
        }

        const ddx = tx - m.mesh.position.x, ddz = tz - m.mesh.position.z;
        const dl = Math.hypot(ddx, ddz);
        if (dl > 0.05 && dist > t.reach * 0.75) {
          m.moving = true;
          const step = t.speed * m.speedMul * dt;
          const nx = m.mesh.position.x + (ddx / dl) * step;
          const nz = m.mesh.position.z + (ddz / dl) * step;
          if (!collides(nx, m.mesh.position.z, t.r)) m.mesh.position.x = nx;
          if (!collides(m.mesh.position.x, nz, t.r)) m.mesh.position.z = nz;
        }
      }
      // 즉시 스냅하지 않고 부드럽게 플레이어 쪽을 향한다.
      m.mesh.rotation.y = turnToward(m.mesh.rotation.y, Math.atan2(dx, dz), TURN_RATE * dt);

      if (!attacking && dist < t.reach && m.atkCd <= 0) startAttack(m);
    }

    if (m.playback) animLoaded(m, m.playback, dt);
    else if (m.rig) animProcedural(m, m.rig, dt, now);
  }
  return nearest;
}

// ================= 상자 =================
function updateChests(dt: number, playerMoving: boolean): void {
  state.nearChest = null;
  let nd = 1.7;
  for (const c of state.chests) {
    if (c.state !== 'closed') continue;
    const d = Math.hypot(c.mesh.position.x - state.pos.x, c.mesh.position.z - state.pos.z);
    if (d < nd) {
      nd = d;
      state.nearChest = c;
    }
  }
  promptEl.style.display = state.nearChest && !state.looting ? 'block' : 'none';
  lootBtn.classList.toggle('show', !!state.nearChest && !state.looting);

  if (state.looting) {
    // 움직이면 루팅이 끊긴다.
    if (playerMoving) {
      cancelLoot();
    } else {
      state.looting.t += dt;
      lootFillEl.style.width = Math.min(100, (state.looting.t / LOOT_TIME) * 100) + '%';
      if (state.looting.t >= LOOT_TIME) {
        openChest(state.looting.chest);
        cancelLoot();
      }
    }
  }

  // 뚜껑 열림 이징
  for (const c of state.chests) {
    if (c.state === 'opened' && c.openT < 1) {
      c.openT = Math.min(1, c.openT + dt * 3);
      c.lid.rotation.x = -1.9 * (1 - Math.pow(1 - c.openT, 3));
    }
  }
}

// ================= 분위기 =================
function updateAmbience(dt: number, now: number): void {
  torch.position.set(state.pos.x, state.pos.y + 0.25, state.pos.z);
  // 두 개의 사인 + 노이즈로 불규칙하게 깜빡이게 한다.
  torch.intensity = state.torchBase + Math.sin(now * 0.011) * 0.2 + Math.sin(now * 0.037) * 0.12 + (Math.random() - 0.5) * 0.1;

  portal.rotation.z += dt * 1.0;
  portalCore.material.opacity = 0.38 + Math.sin(now * 0.004) * 0.12;
  portal.lookAt(state.pos.x, 1.5, state.pos.z);
  portalCore.lookAt(state.pos.x, 1.5, state.pos.z);

  for (const s of state.sconces) {
    const k = 0.75 + Math.sin(now * 0.013 + s.seed) * 0.15 + (Math.random() - 0.5) * 0.2;
    s.light.intensity = 0.55 * k;
    s.flame.scale.set(k, 0.8 + k * 0.4, k);
  }
  for (const p of state.props) {
    if (p.swing !== null) p.object.rotation.z = Math.sin(now * 0.0012 + p.swing) * 0.06;
  }

  // 먼지: 천천히 내려가다 바닥에 닿으면 천장으로. 플레이어 주변 14m 안에서 순환시킨다.
  const dp = dustGeo.attributes.position.array as Float32Array;
  for (let i = 0; i < DUST; i++) {
    dp[i * 3] += Math.sin(now * 0.0004 + i) * 0.0015;
    dp[i * 3 + 1] -= 0.06 * dt;
    dp[i * 3 + 2] += Math.cos(now * 0.0005 + i * 1.3) * 0.0015;
    if (dp[i * 3 + 1] < 0.05) dp[i * 3 + 1] = WALL_H;
    if (dp[i * 3] - state.pos.x > 7) dp[i * 3] -= 14;
    else if (state.pos.x - dp[i * 3] > 7) dp[i * 3] += 14;
    if (dp[i * 3 + 2] - state.pos.z > 7) dp[i * 3 + 2] -= 14;
    else if (state.pos.z - dp[i * 3 + 2] > 7) dp[i * 3 + 2] += 14;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

// ================= 루프 =================
const clock = new THREE.Clock();

export function animate(): void {
  requestAnimationFrame(animate);
  // 탭이 백그라운드에 있다 돌아왔을 때 한 번에 큰 dt가 들어오지 않게 자른다.
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (!state.gameOver) {
    const moving = updatePlayer(dt, now);
    updateWeapons(dt);
    const nearest = updateMonsters(dt, now);
    updateChests(dt, moving);

    // 크리처가 가까울수록 심장이 빨리 뛴다.
    if (audioReady() && nearest < 7.5) {
      const interval = 0.42 + (nearest / 7.5) * 0.7;
      if (now / 1000 - lastBeat() > interval) {
        setLastBeat(now / 1000);
        sfxHeartbeat(0.35 + (1 - nearest / 7.5) * 0.65);
      }
    }

    const ex = portal.position.x - state.pos.x, ez = portal.position.z - state.pos.z;
    if (ex * ex + ez * ez < 1.6 ** 2) endRun(true);
    if (state.hasMap) drawMinimap();
  }

  camera.position.copy(state.pos);
  camera.rotation.set(state.pitch, state.yaw + Math.PI, 0, 'YXZ');
  updateAmbience(dt, now);
  renderFrame();
}
