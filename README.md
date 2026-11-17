# Shadow Dojo

A seated, hands-first passthrough game for Meta Quest built with the
[Immersive Web SDK](https://iwsdk.dev). Your room becomes a clearing in an ink-wash bamboo forest,
with mist pooled along the floor and walls; shadow ninjas sprint out of it and leap into your room. Every third wave a
samurai circles you; bring him down before he draws his sword. Point and pinch to throw shuriken before they land.

- **First run:** a wordless practice round. One ninja walks in and waits under a pointing, pinching hand.
- **Combos:** every 5 kills in a row raises the score multiplier (up to x4); a miss or a hit taken resets it.
  Each run ends with a rank, from Novice to Shadow Master.
- **Daily run:** the same seeded waves for everyone that day, with its own best score.
- **Sound:** all synthesized live with Web Audio: a generative pan-flute ambience, ninjas that arrive
  as spatial whispers, and a growling samurai.

The entry is for the Meta VR Start Developer Competition 2026 (Gaming track). See [docs/PLAN.md](docs/PLAN.md).

## Play

- **Quest 2 / 3 / 3S:** open the GitHub Pages URL in the Meta Quest Browser and choose *Enter
  passthrough*. Set down the controllers so hand tracking takes over. For the best experience, run
  Space Setup first so the game can find your walls.
- **Controls:** point a hand and pinch to throw. Controller triggers also work.
- **No walls found?** The title card offers *Scan* to run room capture, where the browser supports it.

## Develop

Requires Node 20.19+ or 22.12+ (`nvm use`).

```bash
npm install
npm run dev        # HTTPS dev server + managed browser with the IWER XR emulator
npm run typecheck
npm run build      # static site in dist/
```

To test on a headset over Wi-Fi, run `npx @iwsdk/cli dev status` and open the `network` URL on the
Quest.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which typechecks, builds and publishes `dist/`
to GitHub Pages. In the repo, set **Settings → Pages → Source** to **GitHub Actions** once. The Vite
`base` is relative (`./`), so the build works under `/<repo>/`.
