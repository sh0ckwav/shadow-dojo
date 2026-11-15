# Shadow Dojo — competition plan

**Competition:** Meta VR Start Developer Competition 2026 (Devpost)
**Deadline:** **Wed Nov 18, 2026, 12:00 PM PT** (no changes after this; judging runs to ~Dec 9)
**Track / Division:** Gaming · New Experience (codebase started Nov 2, 2026, inside the window)
**Stack:** Immersive Web SDK 1.1.0-rc.2 (WebXR, `immersive-ar` passthrough), TypeScript, Vite, GitHub Pages
**Target devices:** Quest 2 (minimum: grayscale passthrough, no depth or mesh) and Quest 3/3S

## Pitch

Your room is set down in the middle of an ink-wash bamboo forest. Stalks rise all around, beyond every
real wall; a band of mist pools along the floor and the walls up to ninja height, and above it the room
stays plain passthrough under a single vermilion sun. Ninjas sprint through the bamboo hidden in that mist
and only resolve once they are nearly inside the room, then leap when they're in striking range.
After every third wave a samurai steps out of the mist and circles the room, weaving in and out of
it; he takes several stars to bring down, and if he's still standing when his time runs out he raises
his sword and cuts you down, ending the run. Point a hand and pinch to
throw shuriken before they land. One round takes 3–5 minutes, you play seated with no controllers, and
the room you're sitting in is the level.

### Inspiration and IP boundary

The core loop is inspired by the first-person bonus stages of classic arcade ninja games: enemies leap
toward the camera and you throw stars to stop them. We take only that general **mechanic**. Rule 4 bans
infringing content and recognizable brands, so the project uses no names, characters, art, music, sound
effects or level layouts from any existing game, and the submission text describes the inspiration in
general terms. All art and audio are original. All art in the repo is procedural.

## How it scores against the rules

| Requirement or criterion | How Shadow Dojo meets it |
| --- | --- |
| Hands-first, required ("can you finish without a controller?") | Point and pinch throws along the hand's target ray. Menus use hand-ray pinch. Controllers work through the same select path but are optional. |
| Seated (the "airplane seat test", 2 ft radius) | Ninjas come to you. The only body movement is aiming plus an optional small lean to dodge, because the strike point locks at takeoff. |
| Easy in and out (≤10 min, clean pause and resume) | Instant Start, waves of about 30 s, a game-over in 3–5 min. The simulation pauses when the session is blurred (Quest menu). |
| Passthrough must be purposeful | The forest and mist are shaped to the **detected walls** all the way around, so the real room stays visible inside them and everything above ninja height is passthrough except the sun. Ninjas finish their charge inside the real room. |
| Holds up in untested rooms | Walls within 8 m are traced per direction; the outline is clamped to 1.2–8 m with a 3 m circle where no wall is found. Test in 3+ real rooms. |
| FoV-aware design | Ninjas spawn within ±35° of where you face at round start. The in-round HUD is a head-locked strip about 20° up, ~66° wide. The glasses-FoV check is a stretch goal. |
| ≥60 fps on Quest hardware | Low-poly procedural meshes with shared materials, no shadows, no per-frame allocation, swept-sphere hit tests (no raycasters). Profile on **Quest 2** first. |
| Innovation (25%) | Your room becomes a clearing in a misty bamboo forest; ninjas materialize out of the mist at full sprint, like an anime cut-in. |
| Polish (25%) | Art pass, spatial audio, hit-stop, a trailer under 3 minutes captured on device. |

**Special prizes worth aiming at:** *Best First Five Minutes* (a wordless tutorial ninja that you must
hit to start) and *Best Reason to Come Back* (daily seeded challenge, ranks and unlockable star
types).

## What exists today (bootstrap)

The playable vertical slice was verified in IWER, IWSDK's browser XR emulator (Quest 3 profile, living-room environment):

- `src/game-system.ts`: round loop (Menu → Waves → Intermission → GameOver), wall footprints from
  plane detection, placing and fading in the forest, spawning at its back, HUD wiring, best score.
- `src/ninja-system.ts`: two-frame limited-animation sprint along the floor → attack leap inside
  2.4 m → strike, plus the defeat tumble.
- `src/throw-system.ts`: pinch or trigger on either hand throws along that hand's ray. An 8° aim
  assist leads moving runners. A click throws in the 2D browser view. Swept hit tests.
- `src/scene-assets/ninja-model.ts`: faceted low-poly ninja in three key frames (RunA, RunB, Leap),
  one merged vertex-coloured mesh per frame.
- `src/bamboo-forest.ts`: the 360° forest built from seeded geometry around the room outline (200 ink
  bamboo stalks with clear runner paths, fading out by distance), a noisy mist bank along the walls and a
  floor mist, plus the sun. No scene fog.
- `src/boss-system.ts` + `src/scene-assets/samurai-model.ts`: the samurai boss after every 3rd wave.
  A faceted armoured samurai (lacquered iron with red lacing, crescent crest, red face mask, katana)
  in four key frames: two side-step frames, an overhead windup, and a lunging cut. He circles the
  player at about the room radius, reverses and speeds up when hit, needs 8 hits (+2 per later boss),
  and after 30 s (−3 s per later boss, min 20 s) winds up for 1.4 s and cuts: all lives lost. Throws
  get a 15° aim assist on him. In dev builds, B during a ninja wave skips to him.
- `src/lightning.ts`: death strikes. A pooled, allocation-free reverse lightning bolt (crossed-ribbon
  geometry, white core with a violet edge so it reads on bright ceilings) that climbs from the body
  into the sky. A struck ninja burns white and is pulled up one bolt; the samurai shudders under a
  barrage of seven, then evaporates up a final heavy bolt before the next wave's mist rolls in. When
  the player falls, the mist surges over everything and turns blood red, then sinks back to a red ring
  around the room behind the game-over panel.
- `src/hud.ts`: head-locked arcade strip across the top of the view (score digits left, wave seal
  centre, ninja-head life icons right) in the Shojumaru display face, the wave banner, and the
  full-view mist veil. Between waves the mist rolls over everything, announces the next wave, then sinks
  back to the walls.
- `src/mist.ts`: a shader patch shared by the ninjas and bamboo that sinks anything below ninja height
  into the mist colour once it is past the walls.
- `public/ui/hud.uikitml`: menu and game-over panel (hidden during a round).
- `.github/workflows/deploy.yml`: typecheck, build and deploy to GitHub Pages on push to `main`.

Emulator checks that passed: the panel appears in front of the player on entering XR, pinching Begin
starts wave 1, the forest fades in around the room, runners are hidden at ~9 m and only start to show
at ~4.5 m, an aim-assisted throw drops a runner ~5.5 m out, and leaps that land cost a life.

## Milestones

| Dates | Milestone | Exit criteria |
| --- | --- | --- |
| Nov 2 | **M0 Bootstrap** ✅ | Slice runs in IWER; production build passes |
| Nov 3 | **M1 Live on device** | Repo pushed, Pages live over HTTPS, slice playable on Quest 2 and Quest 3 with hands; first fps reading |
| Nov 4–7 | **M2 Feel** | Throw feedback (whoosh, trail, hit-stop, ink-burst particles), a takeoff tell before the leap, dodge-by-lean readout, damage vignette, optional flick-to-throw gesture using hand velocity |
| Nov 8–10 | **M3 Room as level** | Painting polish (ink-bleed reveal, drifting mist bands, falling leaves, brush-texture paper), Space Setup prompt when no wall qualifies, depth occlusion on Quest 3 (skill `iwsdk-depth-occlusion`), fill-rate check of the fog shader on Quest 2 |
| Nov 11–13 | **M4 Content and retention** | 5-wave run with a final "shadow master" boss, combo multiplier, daily seeded run, local best and ranks, wordless first-time tutorial |
| Nov 14–15 | **M5 Art and audio** | Final ninja model (`iwsdk-build-model`), stylized ink shader, original SFX and music (commissioned or self-made; licenses recorded) |
| Nov 16 | **M6 Freeze** | Bug bash in 3+ rooms, Quest 2 at ≥72 fps target (60 fps minimum), cold start <5 s |
| Nov 17 | **M7 Submission assets** | Trailer under 3 min captured on device (lead with the room turning into a bamboo clearing), screenshots, ≤500-word description, hand-interaction write-up, target launch date |
| Nov 18 (AM) | **Submit** | Devpost form complete well before 12:00 PM PT; Pages URL stays unchanged through Dec 11 |

## Risks and mitigations

- **Quest 2 performance:** it is the weakest target, so profile there first. Each ninja is one draw call
  (~1k triangles per frame mesh); cap concurrent ninjas at 5. The forest is 4 draw calls of unlit geometry (200 bamboo stalks); check fill rate of the transparent mist bank and floor mist on Quest 2.
- **No room setup:** without detected walls the forest rings a 3 m circle. Show a one-line prompt
  to run Space Setup, but never block play.
- **No occlusion on Quest 2:** virtual content always draws over the real room, so the forest
  is drawn see-through and fogged where it overlaps the room's walls rather than as solid objects behind them.
- **Hand-ray jitter:** aim assist and firing on the pinch *start* edge are done. Consider
  stabilizing the ray with the wrist instead of the index.
- **Pinch collisions:** a Start pinch could also throw a star, so there is a 0.4 s grace window (already done).
- **Grayscale passthrough on Quest 2:** the forest is virtual, so it keeps its colour; check that the
  pale ninjas still read against the real floor for the last few meters.
- **IP:** the name, art and audio are original. Never name other games or publishers in the store copy,
  title or assets; describe the inspiration generically.
- **Eligibility:** the submitter must be a Meta VR Start member with a developer-enabled Meta account
  **before submitting**. Confirm this now.

## Submission checklist

- [ ] Meta VR Start membership and developer access confirmed
- [ ] Devpost registration ("Join Hackathon")
- [ ] GitHub repo `sh0ckwav/shadow-dojo` public; Pages source set to **GitHub Actions**
- [ ] Live URL `https://sh0ckwav.github.io/shadow-dojo/` tested on Quest 2 and Quest 3
- [ ] Video under 3 minutes, public on YouTube or Vimeo, real on-device footage (no AI video)
- [ ] Description: inspiration, how it was built, future plans, target launch date
- [ ] Hand interaction write-up
- [ ] Track: Gaming · Division: New Experience
- [ ] All third-party assets licensed and listed in `CREDITS.md` (so far: Shojumaru font, SIL OFL 1.1, via Fontsource)
