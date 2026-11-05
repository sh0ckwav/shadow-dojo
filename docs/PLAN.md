# Shadow Dojo — competition plan

**Competition:** Meta VR Start Developer Competition 2026 (Devpost)
**Deadline:** **Wed Nov 18, 2026, 12:00 PM PT** (no changes after this; judging runs to ~Dec 9)
**Track / Division:** Gaming · New Experience (codebase started Nov 2, 2026, inside the window)
**Stack:** Immersive Web SDK 1.1.0-rc.2 (WebXR, `immersive-ar` passthrough), TypeScript, Vite, GitHub Pages
**Target devices:** Quest 2 (minimum: grayscale passthrough, no depth or mesh) and Quest 3/3S

## Pitch

A 180° sumi-e (ink-wash) painting opens beyond your front wall: bamboo groves, layered mountains
and a vermilion sun on rice paper. The bamboo is dense and the mist thick, so ninjas sprinting down hidden paths
through it only resolve in the last 10 m or so, then leap when they're in striking range. Point a hand and pinch to
throw shuriken before they land. One round takes 3–5 minutes, you play seated with no controllers, and
the room you're sitting in is the level.

### Inspiration and IP boundary

The core loop is inspired by the first-person bonus stage of classic arcade ninja games (seen in the
SEGA AGES *Shinobi* trailer around 0:31–0:34): enemies leap toward the camera and you throw stars to
stop them. We take only that **mechanic**. Rule 4 bans infringing content and recognizable brands, so the
project must never use the *Shinobi* name, its characters, sprites, music, sound effects or level
layouts, and the submission text should describe the inspiration in general terms. All art and audio are
original. Placeholder art in the repo is procedural.

## How it scores against the rules

| Requirement or criterion | How Shadow Dojo meets it |
| --- | --- |
| Hands-first, required ("can you finish without a controller?") | Point and pinch throws along the hand's target ray. Menus use hand-ray pinch. Controllers work through the same select path but are optional. |
| Seated (the "airplane seat test", 2 ft radius) | Ninjas come to you. The only body movement is aiming plus an optional small lean to dodge, because the strike point locks at takeoff. |
| Easy in and out (≤10 min, clean pause and resume) | Instant Start, waves of about 30 s, a game-over in 3–5 min. The simulation pauses when the session is blurred (Quest menu). |
| Passthrough must be purposeful | The painting's ground begins at the **detected wall you face**, so your real floor stays visible up to it, and the panorama's edges fade into your room at about ±75°. Ninjas finish their charge inside the real room. |
| Holds up in untested rooms | The front wall must be 1–8 m away and within 50° of your facing; the start of the painted ground is clamped to 1.8–5 m, with a 2.6 m default when no wall qualifies. Test in 3+ real rooms. |
| FoV-aware design | Ninjas spawn within ±35° of where you face at round start. The HUD sits low in the view (about 20° down) at 1.1 m. The glasses-FoV check is a stretch goal. |
| ≥60 fps on Quest hardware | Low-poly procedural meshes with shared materials, no shadows, no per-frame allocation, swept-sphere hit tests (no raycasters). Profile on **Quest 2** first. |
| Innovation (25%) | Your room opens onto a living ink painting; ninjas materialize out of its mist at full sprint, like an anime cut-in. |
| Polish (25%) | Art pass, spatial audio, hit-stop, a trailer under 3 minutes captured on device. |

**Special prizes worth aiming at:** *Best First Five Minutes* (a wordless tutorial ninja that you must
hit to start) and *Best Reason to Come Back* (daily seeded challenge, ranks and unlockable star
types).

## What exists today (bootstrap)

The playable vertical slice was verified in IWER, IWSDK's browser XR emulator (Quest 3 profile, living-room environment):

- `src/game-system.ts`: round loop (Menu → Waves → Intermission → GameOver), front-wall detection,
  placing and fading in the painting, spawning deep in its mist, HUD wiring, best score.
- `src/ninja-system.ts`: two-frame limited-animation sprint along the floor → attack leap inside
  2.4 m → strike, plus the defeat tumble.
- `src/throw-system.ts`: pinch or trigger on either hand throws along that hand's ray. An 8° aim
  assist leads moving runners. A click throws in the 2D browser view. Swept hit tests.
- `src/scene-assets/ninja-model.ts`: faceted low-poly ninja in three key frames (RunA, RunB, Leap),
  one merged vertex-coloured mesh per frame.
- `src/ink-environment.ts`: the 180° painting (paper sky and ground with edge fades, three faint ridge
  washes, sun, a dense bamboo stand with clear runner paths) built from seeded geometry; one heavy scene
  fog in the paper colour.
- `public/ui/hud.uikitml`: menu, HUD and game-over panel.
- `.github/workflows/deploy.yml`: typecheck, build and deploy to GitHub Pages on push to `main`.

Emulator checks that passed: the panel appears in front of the player on entering XR, pinching Begin
starts wave 1, the painting fades in beyond the room, runners stay hidden until ~13 m, are plain by ~7 m,
an aim-assisted throw drops a runner ~5.5 m out, and leaps that land cost a life.

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
| Nov 17 | **M7 Submission assets** | Trailer under 3 min captured on device (lead with the room opening onto the painting), screenshots, ≤500-word description, hand-interaction write-up, target launch date |
| Nov 18 (AM) | **Submit** | Devpost form complete well before 12:00 PM PT; Pages URL stays unchanged through Dec 11 |

## Risks and mitigations

- **Quest 2 performance:** it is the weakest target, so profile there first. Each ninja is one draw call
  (~1k triangles per frame mesh); cap concurrent ninjas at 5. The painting is 7 draw calls of unlit geometry (130 bamboo stalks); check fill rate of its large transparent sky on Quest 2.
- **No room setup:** without a usable wall the painted ground starts 2.6 m ahead. Show a one-line prompt
  to run Space Setup, but never block play.
- **No occlusion on Quest 2:** virtual content always draws over the real room, which is why the
  painting is an opaque half-world rather than objects placed behind real walls.
- **Hand-ray jitter:** aim assist and firing on the pinch *start* edge are done. Consider
  stabilizing the ray with the wrist instead of the index.
- **Pinch collisions:** a Start pinch could also throw a star, so there is a 0.4 s grace window (already done).
- **Grayscale passthrough on Quest 2:** the painting is virtual, so it keeps its colour; check that the
  pale ninjas still read against the real floor for the last few meters.
- **IP:** the name, art and audio are original. Do not reference SEGA or *Shinobi* in the store copy, title or
  assets; describe the inspiration generically.
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
- [ ] All third-party assets licensed and listed in `CREDITS.md`
