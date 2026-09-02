# 던전 익스트랙션 — 로컬 프로젝트

아티팩트 v6 게임을 **TypeScript + Vite** 프로젝트로 옮긴 버전. 크리처(FBX/GLB + 애니메이션)와 벽·바닥 PBR 텍스처를 외부 파일로 불러오고, **파일이 없으면 기존 박스 모델/코드 텍스처로 자동 폴백**한다. 그래서 에셋을 하나씩 넣어가며 확인할 수 있다.

```
dungeon-extraction/
├─ index.html
├─ package.json  tsconfig.json  vite.config.ts
├─ src/
│  ├─ main.ts        부트스트랩 (에셋 로드 → buildWorld → animate)
│  ├─ config.ts      상수 · 크리처 스탯(TYPES) · 에셋 경로
│  ├─ types.ts       Monster / Chest / CreatureRig 등 도메인 타입
│  ├─ state.ts       한 판의 가변 상태
│  ├─ scene.ts       렌더러 · 카메라 · 조명 · 1인칭 무기 모델
│  ├─ textures.ts    절차적 폴백 텍스처 (돌벽 · 자갈 · 나무)
│  ├─ dungeon.ts     미로 생성 + BFS 길찾기
│  ├─ creatures.ts   절차적 폴백 크리처 모델
│  ├─ props.ts       상자 · 뼈무더기 · 통 · 사슬 · 촛대
│  ├─ assets.ts      FBX/GLB · PBR 텍스처 로더 (실패 시 폴백)
│  ├─ audio.ts       WebAudio 앰비언스 + 효과음
│  ├─ input.ts       키보드 · 마우스(포인터 락) · 터치
│  ├─ ui.ts          HUD · 메시지 · 미니맵 · 종료 오버레이
│  ├─ weapons.ts     무기 전환 · 장전
│  ├─ combat.ts      검 · 머스킷 · 피격
│  ├─ loot.ts        상자 열기 · 아이템 획득
│  ├─ world.ts       충돌 판정 · buildWorld
│  └─ loop.ts        크리처 AI/애니메이션 · 프레임 루프
├─ scripts/
│  └─ optimize-assets.mjs   FBX → GLB 변환 · 텍스처 축소
├─ raw/                     에셋 원본 (서빙 안 됨, git 제외)
│  └─ creatures/zombie/     idle.fbx  walk.fbx  attack.fbx  death.fbx
└─ assets/                  서빙되는 에셋
   ├─ creatures/zombie/     idle.glb  walk.glb  attack.glb  death.glb
   └─ textures/
      ├─ wall/              diffuse.jpg  normal.jpg  rough.jpg
      └─ floor/             diffuse.jpg  normal.jpg  rough.jpg
```

크리처는 좀비 하나만 쓴다. 파일이 없으면 코드로 만든 박스 모델로 자동 폴백한다.

---

## 1. 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (HMR) |
| `npm run build` | 타입체크 후 `dist/`로 번들 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run typecheck` | 타입체크만 |

F12 콘솔에 `[assets]` 로그가 찍힌다. 어떤 크리처/텍스처가 로드됐고 어떤 게 폴백됐는지 여기서 확인.

> **에셋 경로**: `vite.config.ts`의 `publicDir: 'assets'` 설정 때문에 `assets/` 폴더가 통째로 사이트 루트로 서빙된다. 그래서 파일은 아래 설명대로 `assets/creatures/...`, `assets/textures/...`에 그대로 넣으면 되지만, 코드(`src/config.ts`)에 적힌 URL에는 `assets/` 접두사가 없다 (`creatures/zombie`). 빌드하면 `dist/`로 자동 복사된다.

---

## 2. 크리처 — Mixamo

https://www.mixamo.com (어도비 계정 필요, 무료)

### 캐릭터 고르기
상단 **Characters** 탭에서 검색해서 하나 선택:

| 폴더 | 검색어 예시 |
|---|---|
| zombie | `zombie` |
| skeleton | `skeleton` |
| brute | `mutant`, `warrok`, `brute` (덩치 큰 것) |
| wraith | `ghost`, `wraith` 없으면 마른 체형 캐릭터 아무거나 |

### 애니메이션 입혀서 내려받기
캐릭터 선택된 상태로 **Animations** 탭. 폴더마다 4개를 받는다:

| 파일명 | 검색어 |
|---|---|
| `idle.fbx` | `zombie idle`, `idle` |
| `walk.fbx` | `zombie walk`, `walk` — **In Place 체크** (안 하면 애니메이션이 캐릭터를 앞으로 밀어서 위치가 어긋남) |
| `attack.fbx` | `zombie attack`, `punch`, `swing` |
| `death.fbx` | `zombie death`, `dying`, `death` |

**Download 설정:**
- Format: **FBX Binary (.fbx)**
- Skin: `idle.fbx`만 **With Skin**, 나머지 3개는 **Without Skin** (용량 1/10, 어차피 모델은 idle에서 가져옴)
- Frames per Second: 30
- Keyframe Reduction: none

> **반드시 Characters 탭에서 캐릭터를 먼저 고를 것.** 캐릭터를 안 고른 채 Animations 탭에서 바로 받으면
> 텍스처가 아예 없는 Mixamo 기본 마네킹(`Beta_Surface`/`Alpha_Surface` = Y Bot·X Bot)이 딸려온다.
> 회색 더미로 보이면 이 경우다 — 콘솔 `[assets]` 로그가 알려준다.
>
> `idle.fbx`를 Without Skin으로 받으면 뼈대만 있고 메시가 없어서 아무것도 안 보인다.
> 이때도 로그에 `메시 없음 (idle을 With Skin으로 다시 받을 것)`으로 찍히고 기본 박스 모델로 폴백한다.

받은 파일을 위 이름으로 바꿔서 해당 폴더에 넣는다. 블렌더 변환 **불필요** — Three.js가 FBX를 바로 읽는다.

### 확인할 것
- 서버 새로고침 → 콘솔에 `zombie: 로드 완료 [idle, walk, attack, death]`
- 크기가 이상하면 `src/config.ts`의 `CREATURE_ASSETS`에서 `height` 값 조정 (미터 단위)
- 캐릭터가 뒤를 보고 걸어오면 그 캐릭터는 원점 방향이 다른 것. 드물지만 그러면 `src/assets.ts`의 `spawnCreature()`에서 `model.rotation.y = Math.PI` 추가

### 라이선스
Mixamo 캐릭터·애니메이션은 게임에 넣어 배포하는 건 무료·상업 가능. 단 **FBX 원본 파일 자체를 재배포하면 안 됨** → `raw/`는 `.gitignore`에 넣고, 게임에 구워 넣은 `assets/creatures/**/*.glb`만 커밋한다.

---

## 3. 벽·바닥 — Poly Haven

https://polyhaven.com/textures (CC0, 계정 불필요)

| 폴더 | 검색어 예시 |
|---|---|
| wall | `stone wall`, `castle brick`, `mossy` |
| floor | `cobblestone`, `stone floor`, `flagstone` |

**1K** 해상도, **JPG**로 받으면 보통 zip 안에 `*_diff_1k.jpg`, `*_nor_gl_1k.jpg`, `*_rough_1k.jpg`가 들어있다. 이걸 각각 `diffuse.jpg`, `normal.jpg`, `rough.jpg`로 이름 바꿔서 폴더에 넣는다.

- `normal.jpg`는 **`nor_gl`** (OpenGL 방식)을 쓸 것. `nor_dx`는 Three.js에서 요철이 뒤집힌다.
- 2K 이상은 모바일에서 버벅일 수 있음. 1K로 충분.
- 색이 너무 밝으면 `src/scene.ts`의 `AmbientLight`나 `toneMappingExposure`를 낮추면 된다.

---

## 4. 그다음

- **무기 모델**: Mixamo엔 무기가 없다. Sketchfab에서 `musket` / `sword` 검색 + Downloadable + CC0 필터로 GLB 받아서 `src/scene.ts`의 `sword`, `musket` 그룹 안 프리미티브를 교체.
- **그림자**: 지금은 꺼져 있다. `src/scene.ts`에서 `renderer.shadowMap.enabled = true` + 횃불 `castShadow = true`로 켤 수 있는데, 벽이 많아서 모바일 성능은 확인 필요.
- **소품 교체**: Poly Haven `Models` 탭이나 Sketchfab CC0에서 barrel, skull, chain 등.

문제 생기면 F12 콘솔 에러 메시지를 그대로 가져오면 된다.
