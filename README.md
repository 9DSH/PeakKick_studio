# PeakKick Replay Studio (React + Vite)

## Run it in VS Code
1. Install Node.js LTS from https://nodejs.org (this includes npm).
2. Unzip this folder, then in VS Code use File > Open Folder and pick it.
3. Open the terminal (Terminal > New Terminal) and run:
   - `npm install`   (once)
   - `npm run dev`
4. Open the address it prints (usually http://localhost:5173) in Chrome or Edge.

Your work is saved automatically in the browser (localStorage). Recording gives a .webm file; convert it to MP4 with HandBrake or `ffmpeg -i goal_replay.webm goal_replay.mp4`.

## Where things are
- `src/engine.js`  data model, movement interpolation, all canvas drawing (change the look here)
- `src/App.jsx`    state, toolbar, add/delete/reset keyframes, record
- `src/Board.jsx`  the canvas, animation loop, click logic (select, move, give the ball)
- `src/Timeline.jsx` timeline with draggable keyframes and goal marker
- `src/SidePanel.jsx` players, colors, face photos, text, JSON / AI prompt
- `src/styles.css`

## Using it
- Click a dot, then click the pitch to move it in the selected keyframe.
- Give the ball to a player: click the ball, then click the player. The ball stays glued to him (also between keyframes, so dribbling works). Click the ball again to let it go. The ball always sits on the player's edge, whatever his size (see HOLD_ANGLE and HOLD_GAP at the top of `engine.js`).
- Deselect: right-click the board or press Esc.
- Faces: click a player row in the Players tab, then Upload photo. Size, Zoom and Move sliders adjust it.

## Real match import (API-Football, free plan)
1. Create a free account at https://www.api-football.com and copy your API key from the dashboard (the free plan gives 100 requests a day; one match uses about 3).
2. In the project folder copy `.env.example` to a new file named `.env` and paste your key after `API_FOOTBALL_KEY=`.
3. Stop and restart `npm run dev` (the key is only read when the dev server starts). The key stays on your computer: the dev server adds it to the requests, the browser never sees it.
4. Open the **Import** tab, pick a date, press **Find finished matches**, click a match (or type a fixture ID). The app builds a draft: both lineups at their formation positions, substitutions, goals, cards and a half-time and full-time keyframe.
5. Use **Copy AI prompt** to send the draft plus your own description of the match to Claude, paste the JSON back, then edit the movements by hand.

Notes: lineups, subs, goals, cards and the full-time stats are real. In-play stats are estimates (the API has no per-minute stats), and the third row shows Corners. Not every competition has lineups; the Import tab tells you when one is missing. Check API-Football's terms before using the data in a monetized channel.
