# Deploy

Static Vite site in `app/`. No backend, no environment variables, no API keys.
Nothing below has been run by the builder agent; the orchestrator runs it after review.

## 1. Public GitHub repo

From the repo root (`/Users/arjun/general-machines-assignment`):

```bash
git init -b main                     # skip if .git already exists
git add -A
git commit -m "Scaffold Bangkok plot feasibility tool"

# Requires `gh auth login` once. Creates a PUBLIC repo and pushes main.
gh repo create bangkok-plot-envelope --public --source=. --remote=origin --push
```

Verify: `gh repo view --web` opens without sign-in in a private window.

## 2. Vercel (static Vite, root directory `app`)

Option A, CLI (installs the Vercel CLI once):

```bash
npm i -g vercel
cd app
vercel login
# First deploy: answer the prompts
#   Set up and deploy?            Y
#   Scope                         <your account>
#   Link to existing project?     N
#   Project name                  bangkok-plot-envelope
#   In which directory is code?   ./          (we are already inside app/)
#   Framework preset              Vite        (auto-detected)
#   Build command                 npm run build
#   Output directory              dist
vercel --prod
```

Option B, Git integration (recommended for continuous deploys):

1. https://vercel.com/new -> Import the GitHub repo.
2. **Root Directory**: `app` (click Edit next to Root Directory).
3. Framework preset: **Vite**. Build command `npm run build`, output `dist`, install `npm install`.
4. Deploy. Every push to `main` redeploys.

`app/vercel.json` makes SPA routing explicit and is picked up automatically:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

## 3. Check the live URL

- Open the production URL in a private window: it must load with no sign-in.
- The map must show 3D buildings around Sukhumvit / Asok within a few seconds.
- Draw a plot, pick the front edge, copy the link, open it in a new private window:
  the plot, front edge, road width and camera must come back.

## Alternative: Netlify

```bash
npm i -g netlify-cli
cd app && npm run build
netlify deploy --prod --dir=dist
```

## 4. Deployed (2026-11-21 14:35 UTC)

- Repo (public): https://github.com/arjun-kshirsagar/bangkok-plot-envelope
- Live (Vercel production, deployed by CLI from `app/`): https://bangkok-plot-envelope.vercel.app
- Anonymous GET returns 200 with the app title; no deployment protection.
- Redeploy after a change: `cd app && npm test && vercel --prod --yes`
