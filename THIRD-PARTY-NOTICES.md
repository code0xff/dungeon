# Third-party notices

The `LICENSE` at the root covers **the source code of this repository only**.

Everything under `assets/` was made by someone else. It is redistributed here
under the terms below, and the Business Source License grants you no rights in
any of it. If you fork this project, these terms come with the files — check
them before you redistribute, and re-fetch or replace anything you are unsure
about.

## Textures, weapons and props — Poly Haven (CC0 1.0)

Public-domain dedication. No attribution required, no restrictions on reuse.
Listed here as a courtesy, and because `scripts/fetch-assets.mjs` can re-download
every one of them from the ids in its `PICKS` table.

| File | Poly Haven id |
|---|---|
| `assets/textures/wall/*` | `medieval_blocks_05` |
| `assets/textures/floor/*` | `cobblestone_floor_08` |
| `assets/weapons/sword.glb` | `wooden_handle_saber` |
| `assets/weapons/musket.glb` | `bolt_action_rifle_7_62` |
| `assets/props/chest.glb` | `treasure_chest` |
| `assets/props/lantern.glb` | `Lantern_01` |

<https://polyhaven.com> · <https://creativecommons.org/publicdomain/zero/1.0/>

## Fonts — SIL Open Font License 1.1

| File | Face | Licence text |
|---|---|---|
| `assets/fonts/cinzel-600.woff2` | Cinzel | `assets/fonts/cinzel-OFL.txt` |
| `assets/fonts/eb-garamond.woff2` | EB Garamond | `assets/fonts/eb-garamond-OFL.txt` |

The OFL explicitly permits bundling fonts with software under any licence, so
shipping them alongside a BSL codebase is fine — but the font files themselves
stay under the OFL, and its text must travel with them. Both licence files are
in the repository for that reason. The OFL also forbids selling the fonts on
their own.

## Creatures — Mixamo (Adobe)

`assets/creatures/{zombie,brute,lunatic}/{idle,walk,attack,death}.glb`

Baked from Mixamo characters and animations. Adobe's terms let the account
holder use these in their own projects, including commercially, but **do not
allow redistributing them as assets or sublicensing them to anyone else**.

This is why the `LICENSE` scopes itself to source code: a licence that appeared
to hand these on to third parties would be granting rights the Licensor does not
hold. The `raw/` FBX sources are git-ignored and never published, per
`AGENTS.md`.

If you fork this repository, you are expected to supply your own creature models
rather than rely on these. `docs/assets.md` documents the pipeline for doing so.

<https://www.mixamo.com>
