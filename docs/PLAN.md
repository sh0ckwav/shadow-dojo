# Shadow Dojo — competition plan

**Competition:** Meta VR Start Developer Competition 2026 (Devpost)
**Deadline:** **Wed Nov 18, 2026, 12:00 PM PT** (no changes after this; judging runs to ~Dec 9)
**Track / Division:** Gaming · New Experience (codebase started Nov 2, 2026, inside the window)
**Stack:** Immersive Web SDK 1.1.0-rc.2 (WebXR, `immersive-ar` passthrough), TypeScript, Vite, GitHub Pages
**Target devices:** Quest 2 (minimum: grayscale passthrough, no depth or mesh) and Quest 3/3S

## Pitch

Shadow ninjas tear ink portals open in *your* walls and leap at you. Point a hand and pinch to throw
shuriken before they land. One round takes 3–5 minutes, you play seated with no controllers, and the
room you're sitting in is the level.

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
| Passthrough must be purposeful | Spawn points come from **detected wall planes**, so a different room gives different spawn geometry. The fallback ring is used only when no walls are found. |
| Holds up in untested rooms | Wall picking rejects small or low or high planes and walls outside the forward cone, then falls back cleanly. Test in 3+ real rooms. |
| FoV-aware design | Spawns are limited to ±65° of the facing direction at round start. The HUD sits low in the view (about 20° down) at 1.1 m. The glasses-FoV check is a stretch goal. |
| ≥60 fps on Quest hardware | Low-poly procedural meshes with shared materials, no shadows, no per-frame allocation, swept-sphere hit tests (no raycasters). Profile on **Quest 2** first. |
| Innovation (25%) | Your real walls become the ninjas' doorways. A short "room scan → portals open" moment opens each session. |
| Polish (25%) | Art pass, spatial audio, hit-stop, a trailer under 3 minutes captured on device. |

**Special prizes worth aiming at:** *Best First Five Minutes* (a wordless tutorial ninja that you must
hit to start) and *Best Reason to Come Back* (daily seeded challenge, ranks and unlockable star
types).

## What exists today (bootstrap)

The playable vertical slice was verified in IWER, IWSDK's browser XR emulator (Quest 3 profile, living-room environment):

- `src/game-system.ts`: round loop (Menu → Waves → Intermission → GameOver), wall-plane spawn
  selection with a fallback ring, HUD wiring, best score in `localStorage`.
- `src/ninja-system.ts`: portal open and close, then emerge → crouch → arc leap → strike or defeat
  animation.
- `src/throw-system.ts`: pinch or trigger on either hand throws along that hand's ray. A click
  throws in the 2D browser view. Swept hit tests.
- `src/scene-assets/ninja.scene-asset.ts`: placeholder procedural ninja, shuriken and portal.
- `public/ui/hud.uikitml`: menu, HUD and game-over panel.
- `.github/workflows/deploy.yml`: typecheck, build and deploy to GitHub Pages on push to `main`.

Emulator checks that passed: the panel appears in front of the player on entering XR, pinching Begin
starts wave 1, ninjas emerge from the room's detected front and side walls, leaps that land cost a life
and end the game at 0, and a pinch throw aimed at a leaping ninja hits it (score 100).

## Milestones

| Dates | Milestone | Exit criteria |
| --- | --- | --- |
| Nov 2 | **M0 Bootstrap** ✅ | Slice runs in IWER; production build passes |
| Nov 3 | **M1 Live on device** | Repo pushed, Pages live over HTTPS, slice playable on Quest 2 and Quest 3 with hands; first fps reading |
| Nov 4–7 | **M2 Feel** | Aim assist (cone snap within ~6°), throw feedback (whoosh, trail, hit-stop, ink-burst particles), a ninja that "telegraphs" before leaping, dodge-by-lean readout, damage vignette, optional flick-to-throw gesture using hand velocity |
| Nov 8–10 | **M3 Room as level** | Portal crack-open VFX anchored to wall planes, a "your walls are being scanned" intro, Space Setup prompt when no planes, floor and table planes for ground-runner ninjas, depth occlusion on Quest 3 (skill `iwsdk-depth-occlusion`) |
| Nov 11–13 | **M4 Content and retention** | 5-wave run with a final "shadow master" boss, combo multiplier, daily seeded run, local best and ranks, wordless first-time tutorial |
| Nov 14–15 | **M5 Art and audio** | Final ninja model (`iwsdk-build-model`), stylized ink shader, original SFX and music (commissioned or self-made; licenses recorded) |
| Nov 16 | **M6 Freeze** | Bug bash in 3+ rooms, Quest 2 at ≥72 fps target (60 fps minimum), cold start <5 s |
| Nov 17 | **M7 Submission assets** | Trailer under 3 min captured on device (lead with the walls-break-open moment), screenshots, ≤500-word description, hand-interaction write-up, target launch date |
| Nov 18 (AM) | **Submit** | Devpost form complete well before 12:00 PM PT; Pages URL stays unchanged through Dec 11 |

## Risks and mitigations

- **Quest 2 performance:** it is the weakest target, so profile there first. Keep draw calls low (merge
  ninja parts into one mesh for the final art) and cap concurrent ninjas at 5.
- **No room setup:** without walls the game falls back to the ring. Show a one-line prompt to run Space
  Setup, but never block play.
- **Hand-ray jitter:** add aim assist and fire on the pinch *start* edge (already done). Consider
  stabilizing the ray with the wrist instead of the index.
- **Pinch collisions:** a Start pinch could also throw a star, so there is a 0.4 s grace window (already done).
- **Grayscale passthrough on Quest 2:** design for contrast. The red scarf and purple rim must read on
  gray, so check silhouettes in grayscale.
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
