import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로로 빌드해서 dist/를 아무 하위 경로에서나 서빙할 수 있게 한다.
  base: './',
  // assets/ 를 그대로 정적 디렉터리로 쓴다. README에 적힌 폴더 구조
  // (assets/creatures/..., assets/textures/...) 를 바꾸지 않기 위한 선택.
  // 대신 런타임 URL에서는 앞의 'assets/' 가 빠진다 → 'creatures/zombie/idle.fbx'.
  publicDir: 'assets',
  // host: true → 0.0.0.0 바인딩. 같은 네트워크의 폰·태블릿에서도 접속할 수 있다.
  server: { host: true, open: false },
  build: { outDir: 'dist', target: 'es2022' },
});
