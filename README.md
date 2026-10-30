# Baby Names

A swipe app for picking a baby name together. You and your partner each swipe through names on your own phone (right = like, left = pass, up = love), then see the names you both like, the ones only one of you likes, and the ones your partner hasn't seen yet. You can add your own names, which go to the front of both decks.

The Rank tab keeps asking each of you to rate liked names from 1 to 5, picked at random, and names come back to be rated again over time. Each person's score is the average of their last three ratings, and the rank list sorts by both of you combined, just you, or just your partner.

Names come from the US Social Security Administration's baby name records (public domain): about 24,000 names that were given to at least 100 babies in the last 20 years of data, or 500 in any single year.

## Deploy on Render

The repo includes a Render Blueprint (`render.yaml`) that creates a web service and a Postgres database.

1. In the Render dashboard, choose **New > Blueprint** and pick this repository.
2. Check the plans it proposes (web service `starter`, database `basic-256mb`), change them if you like, and click **Apply**.
3. When the deploy finishes, open the service URL on your phone. The first request creates the tables and loads the names, which takes a few seconds.
4. Tap **Start a family**, then share the invite link from the Family tab with your partner.
5. On iPhone, open the site in Safari, tap Share, then **Add to Home Screen** so it opens like an app.

Every push to `main` redeploys automatically.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173, uses an in-memory database unless DATABASE_URL is set
npm test        # API tests against an in-memory Postgres
```

## Updating the name list

The bundled data runs through 2025. The SSA publishes each year's names around May, but ssa.gov blocks automated downloads (including GitHub Actions), so updating is a manual step:

1. Download [names.zip](https://www.ssa.gov/oact/babynames/names.zip) in a regular browser and unzip it.
2. Run `npm run build-names -- path/to/unzipped/names` and commit `server/namesData.ts`.

The next deploy reloads the names automatically. Votes and ratings are kept.

## How it's built

- `src/`: React + Vite app (installable to the home screen)
- `server/api.ts`: the API (families, deck, votes, added names, results)
- `server/db.ts`: schema and name seeding, run automatically on first request
- `server/serve.ts`: Node server that serves the app and API on Render
- `scripts/build-names.ts`: turns SSA files into `server/namesData.ts`
