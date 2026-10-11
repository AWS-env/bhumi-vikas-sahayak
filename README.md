# Bhumi Vikas Sahayak

Ask the Bhopal building rulebook (MP Bhumi Vikas Rules, 2012) in English or Hindi and get an answer with the rule number and source text.

## Run (two terminals)

1. `npm install`, then in `apps/api`: `uv sync`
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/api/.env.example` to `apps/api/.env`; use the same `BFF_SHARED_SECRET` in both.
3. Terminal 1: `npm run dev:api`
4. Terminal 2: `npm run dev:web`
