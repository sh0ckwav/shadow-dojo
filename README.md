# Shadow Dojo

A seated, hands-first passthrough game for Meta Quest built with the
[Immersive Web SDK](https://iwsdk.dev). The wall in front of you dissolves into endless fog; shadow ninjas
sprint out of it across your floor and leap at you. Point and pinch to throw shuriken before they land.

The entry is for the Meta VR Start Developer Competition 2026 (Gaming track). See [docs/PLAN.md](docs/PLAN.md).

## Play

- **Quest 2 / 3 / 3S:** open the GitHub Pages URL in the Meta Quest Browser and choose *Enter
  passthrough*. Set down the controllers so hand tracking takes over. For the best experience, run
  Space Setup first so the game can find the wall in front of you.
- **Controls:** point a hand and pinch to throw. Controller triggers also work.

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
