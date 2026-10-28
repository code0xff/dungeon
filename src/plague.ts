import { PLAGUE_BURST } from './config';
import { playerHurt } from './combat';
import { cloud } from './fx';
import { state } from './state';
import { showMsg } from './ui';

/**
 * The plague-bearer's death: PLAGUE_BURST.delay after it falls, its cloud
 * bursts where it lies.
 *
 * Runs on every client, creature authority or not, off the hp the authority
 * reports — a follower sees the death the same frame it sees the body fall.
 * Each client judges only its own player, which is what a trap does and for
 * the same reason (see docs/coop.md on who decides what): the cloud hurts
 * whoever is standing in it, and whose machine that is decides.
 *
 * No `from` is passed to playerHurt(), so no shield takes it.
 */
let warned = false;

export function updatePlague(dt: number): void {
  for (const m of state.monsters) {
    if (m.key !== 'plague' || m.hp > 0 || m.burstT === -2) continue;
    if (m.burstT === -1) {
      m.burstT = PLAGUE_BURST.delay;
      // The warning is the swelling: a small cloud for as long as the delay.
      cloud(m.mesh.position.x, m.mesh.position.z, PLAGUE_BURST.radius * 0.45, PLAGUE_BURST.colour, PLAGUE_BURST.delay);
      continue;
    }
    m.burstT -= dt;
    if (m.burstT > 0) continue;
    m.burstT = -2;
    const { x, z } = m.mesh.position;
    cloud(x, z, PLAGUE_BURST.radius, PLAGUE_BURST.colour, 0.9);
    if (state.gameOver || Math.hypot(state.pos.x - x, state.pos.z - z) > PLAGUE_BURST.radius) continue;
    playerHurt(PLAGUE_BURST.dmg);
    // Said once per page load: the first time is the lesson, and the rest are
    // reminders the vignette already gives.
    if (!warned) {
      warned = true;
      showMsg('The corpse burst — step back from the sick ones as they fall');
    }
  }
}
