# Live Video Query — Vaidio Plugin

A standalone Vaidio AI Vision plugin exported from the Vaidio AI Suite.

## Quick Start

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL & anon key
npm run dev
```

## Edge Functions

This plugin requires the following Supabase Edge Functions to be deployed:

- `query-scene` — sends camera snapshots to a VLM for analysis
- `vaidio-proxy` — authenticates and proxies requests to your Vaidio server

Deploy them with:

```bash
supabase functions deploy query-scene
supabase functions deploy vaidio-proxy
```

### Required Secrets

Set these in your Supabase project:

| Secret | Description |
|--------|-------------|
| `LOVABLE_API_KEY` | API key for the AI gateway (VLM) |
| `VAIDIO_URL` | Your Vaidio server URL (e.g. `http://192.168.1.100:8380`) |
| `VAIDIO_USERNAME` | Vaidio login username |
| `VAIDIO_PASSWORD` | Vaidio login password |

## Structure

```
src/
  App.tsx                          # Minimal app shell
  pages/apps/LiveVideoQuery.tsx    # Main UI
  hooks/useVaidioApi.ts            # Camera & snapshot API
  hooks/useSceneQuery.ts           # VLM chat hook
  lib/vaidio.ts                    # Vaidio API adapter
  lib/utils.ts                     # Tailwind merge utility
  components/ui/                   # shadcn/ui primitives
  index.css                        # Design tokens
supabase/functions/
  query-scene/                     # VLM edge function
  vaidio-proxy/                    # Vaidio API proxy
```
