import { loadAssets } from './assets';
import { el } from './dom';
import { animate } from './loop';
import { buildWorld } from './world';
// 부작용 등록용: 키보드/마우스/터치 리스너와 오디오 잠금 해제.
import './input';

const loadingEl = el('loading');

el('restart').addEventListener('click', buildWorld);

loadAssets((msg) => {
  loadingEl.textContent = msg + '...';
})
  .then(() => {
    loadingEl.style.display = 'none';
    buildWorld();
    animate();
  })
  .catch((err: unknown) => {
    console.error(err);
    loadingEl.textContent = '로딩 오류: 콘솔(F12) 확인';
  });
