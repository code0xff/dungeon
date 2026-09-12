import { HURT_DIRECTION_TIME, IMPACT_LABEL_TIME, LANDMARK_INFO, CELL, ROOM_TITLE_TIME } from './config';
import { el, queryChild } from './dom';
import { state } from './state';
import { progress } from './progress';
import { coop } from './net/session';
import type { DungeonRoom, ImpactKind } from './types';

let lastRoom: DungeonRoom | undefined;
let roomTime = 0;

export function impact(kind: ImpactKind): void {
  // A cleave can kill its first target then merely wound its second; keep the
  // stronger confirmation until this brief feedback window expires.
  if (state.impactT > 0 && state.impactKind === 'kill' && kind !== 'kill') return;
  state.impactKind = kind;
  state.impactT = IMPACT_LABEL_TIME;
}

export function updateFeedback(dt: number): void {
  const room = state.rooms.find(r => state.pos.x >= (r.x - 0.5) * CELL
    && state.pos.x < (r.x + r.size - 0.5) * CELL
    && state.pos.z >= (r.z - 0.5) * CELL && state.pos.z < (r.z + r.size - 0.5) * CELL);
  const title = el('roomName');
  if (room !== lastRoom) {
    lastRoom = room;
    roomTime = room ? ROOM_TITLE_TIME : 0;
    if (room) {
      queryChild(title, 'strong').textContent = LANDMARK_INFO[room.kind].name;
      const hard = coop.active ? coop.hard : progress.hard;
      queryChild(title, 'small').textContent = hard
        ? room.kind === 'store' ? 'Shelves picked clean' : room.kind === 'chapel' ? 'A silent sanctuary' : 'A sentry waits'
        : LANDMARK_INFO[room.kind].hint;
    }
  }
  if (!state.paused) {
    roomTime = Math.max(0, roomTime - dt);
    state.hurtDirectionT = Math.max(0, state.hurtDirectionT - dt);
    state.impactT = Math.max(0, state.impactT - dt);
  }
  const visible = !state.uiOpen && !state.gameOver && !state.title;
  title.style.opacity = visible && roomTime > 0 ? '1' : '0';
  const direction = el('hurtDirection');
  direction.style.opacity = visible ? String(state.hurtDirectionT / HURT_DIRECTION_TIME) : '0';
  direction.style.transform = `translate(-50%,-50%) rotate(${state.yaw - state.hurtDirection}rad)`;
  const contact = el('impactLabel');
  contact.textContent = state.impactKind === 'kill' ? 'Slain' : state.impactKind === 'blocked' ? 'Blocked' : 'Hit';
  contact.dataset.kind = state.impactKind;
  contact.style.opacity = visible ? String(state.impactT / IMPACT_LABEL_TIME) : '0';
}
