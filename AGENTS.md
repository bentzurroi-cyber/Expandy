# Expandy

Hebrew-language (RTL) household expense & income tracker PWA built with React 18 + TypeScript + Vite + Tailwind CSS + Supabase.

## Cursor Cloud specific instructions

### Services

| Service | How to run | Notes |
|---|---|---|
| Vite dev server | `npm run dev` | Serves on `http://localhost:5173/` |

### Available npm scripts

See `package.json` — `dev`, `build`, `lint`, `preview`.

### Supabase backend

The app connects to a **remote hosted Supabase** instance (URL and anon key have hardcoded fallbacks in `src/lib/supabase.ts`). There is no local Supabase setup (`supabase/config.toml` does not exist). Override via env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in a `.env` file if needed.

Authentication requires a real email that Supabase can validate. Registration with non-real email domains (e.g. `@example.com`) will be rejected by Supabase's email validation.

### Lint

`npm run lint` — runs ESLint. The codebase has pre-existing warnings (mostly `react-hooks/exhaustive-deps` and `react-refresh/only-export-components`) and a few pre-existing errors (`@typescript-eslint/no-empty-object-type`, `no-useless-escape`). These are not blocking.

### Build

`npm run build` — runs `tsc -b && vite build`. Produces output in `dist/` including PWA service worker.

### Notes

- No `.env` file is committed; the app works without one due to hardcoded Supabase fallbacks (a console warning is logged).
- No test framework is configured (no unit/integration tests).
- No git hooks, pre-commit hooks, or lint-staged configuration exists.
