import { clipDuration, setAnim } from './assets';
import { sfxHit, sfxShot, sfxSwing } from './audio';
import { ATTACK_CD, ATTACK_RANGE, CORPSE_LINGER, MUSKET_DMG, MUSKET_RANGE, SHOT_ALERT_RADIUS } from './config';
import { flashLight, muzzleFlash, scene, smoke } from './scene';
import { state } from './state';
import type { Monster } from './types';
import { cancelLoot, flashHurt, endRun, showMsg, updateHUD } from './ui';
import { startReload } from './weapons';

/** 카메라가 바라보는 수평 방향의 단위 벡터. */
function facing(): [fx: number, fz: number] {
  return [-Math.sin(state.yaw + Math.PI), -Math.cos(state.yaw + Math.PI)];
}

export function killMonster(m: Monster): void {
  m.hp = 0;
  state.runGold += m.type.reward;
  updateHUD();
  // 사망 클립이 있으면 끝까지 재생하고 잠시 시체를 남긴 뒤 치운다. 없으면 바로 지운다.
  if (m.playback?.clips.death) {
    m.dead = true;
    m.attackT = 0;
    m.pendingHit = null;
    m.deadT = (clipDuration(m.playback, 'death') ?? 2.5) + CORPSE_LINGER;
    setAnim(m.playback, 'death', { loop: false, force: true, fade: 0.1 });
  } else {
    scene.remove(m.mesh);
  }
}

export function fireMusket(): void {
  if (!state.loaded) {
    if (state.ammo <= 0) showMsg('탄약 없음');
    else if (state.reloadT < 0) startReload();
    return;
  }
  state.loaded = false;
  state.ammo--;
  state.recoilT = 0;
  state.flashT = 0.09;
  muzzleFlash.visible = true;
  smoke.material.opacity = 0.55;
  smoke.scale.set(1, 1, 1);
  flashLight.position.copy(state.pos);
  flashLight.intensity = 3.5;
  sfxShot();

  // 조준선 판정: 시선 방향과 가장 각도가 가까운 크리처 하나.
  const [fx, fz] = facing();
  let best: Monster | null = null;
  let bestDot = 0.985;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const dx = m.mesh.position.x - state.pos.x, dz = m.mesh.position.z - state.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > MUSKET_RANGE) continue;
    const dot = (dx * fx + dz * fz) / (d || 1);
    // 가깝거나 덩치가 크면 판정을 넓혀 준다.
    const tol = 0.985 - (m.type.r / (d || 1)) * 0.6;
    if (dot > tol && dot > bestDot - (0.985 - tol)) {
      best = m;
      bestDot = dot;
    }
  }
  if (best) {
    best.hp -= MUSKET_DMG;
    best.hurtT = 0.25;
    sfxHit(false);
    if (best.hp <= 0) {
      showMsg(`${best.type.name} 사살 +${best.type.reward} G`);
      killMonster(best);
    }
  }

  // 총성: 반경 안 모든 크리처가 플레이어 위치를 알아챈다.
  let alerted = 0;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    if (Math.hypot(m.mesh.position.x - state.pos.x, m.mesh.position.z - state.pos.z) < SHOT_ALERT_RADIUS) {
      m.alert = 10;
      m.repath = 0;
      alerted++;
    }
  }
  if (alerted > 1) showMsg(`총성이 울렸다... ${alerted}마리가 이쪽으로`);

  updateHUD();
  if (state.ammo > 0) startReload();
}

export function tryAttack(): void {
  if (state.gameOver) return;
  if (state.weapon === 'musket') {
    fireMusket();
    return;
  }
  if (state.atkTimer > 0) return;
  state.atkTimer = ATTACK_CD;
  state.swingT = 0;
  sfxSwing();

  // 검은 부채꼴로 닿는 모든 크리처를 동시에 벤다.
  const [fx, fz] = facing();
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const dx = m.mesh.position.x - state.pos.x, dz = m.mesh.position.z - state.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > ATTACK_RANGE + m.type.r) continue;
    if ((dx * fx + dz * fz) / (d || 1) > 0.35) {
      m.hp--;
      m.hurtT = 0.18;
      sfxHit(false);
      if (m.hp <= 0) {
        showMsg(`${m.type.name} 처치 +${m.type.reward} G`);
        killMonster(m);
      }
    }
  }
}

export function playerHurt(dmg: number): void {
  state.hp -= dmg;
  sfxHit(true);
  if (state.looting) {
    cancelLoot();
    showMsg('열기 취소!');
  }
  flashHurt();
  updateHUD();
  if (state.hp <= 0) endRun(false);
}
