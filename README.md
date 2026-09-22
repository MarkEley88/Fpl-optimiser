# FPL Optimiser — connected foundation

This is source code for the FPL Optimiser, not a normal Android app/APK.

## What is already connected

1. Public FPL game data is fetched server-side from:
   https://fantasy.premierleague.com/api/bootstrap-static/
2. If FPL_TEAM_ID is supplied, the app can fetch the manager entry, history and current/next-gameweek picks.
3. Official club news is read from a maintained list of Premier League club websites and searched for the player's name.
4. News signals are fed into starting-probability adjustments.
5. The current squad from the user's screenshot is included as the fallback until an FPL team ID is supplied.

## Run locally

Requires Node.js 20+.

    npm install
    npm run dev

Then open http://localhost:3000

To connect your own FPL team, copy .env.example to .env.local and put your FPL manager ID in FPL_TEAM_ID.

The manager ID is the number in your FPL team URL, for example:
fantasy.premierleague.com/entry/1234567/history
The app only uses the public read endpoints; it does not ask for your FPL password.

## Important

The FPL endpoints are public endpoints used by the FPL website but are not a formally documented developer API. Build defensively because response shapes can change.

Official-news ingestion is deliberately source-restricted: it does not treat Reddit or generic FPL blogs as official club evidence. Those can be added later as lower-confidence supporting signals.

<!-- Deployment sync: keep Vercel aligned with the latest main branch. -->
