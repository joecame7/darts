Play now:

https://joecame7.github.io/darts/

Cricket scoreboard:

https://joecame7.github.io/darts/cricket/

Guest Cricket scoreboard (no game data is saved):

https://joecame7.github.io/darts/cricket_legacy/

Instructions:

- Add scores by clicking the box corresponding to
  the number you have hit.
- If you made a mistake and you need to undo, click
  the undo icon (may look like refresh) to undo your
  change.
- Guest games are not sent to Supabase and disappear when the page refreshes.
- Accounts are optional. Signed-in users can access their private game-history
  area as tracked game modes are added.


Account data:

- Supabase provides email/password authentication and the Postgres database.
- `supabase/schema.sql` contains the complete database schema and Row Level
  Security policies.
- `.env` is local-only and ignored by Git.
- `supabase-config.js` contains only the browser-safe Supabase project URL and
  publishable key. Never add a secret or service-role key to frontend code.


I usually play darts quite often for fun, there is a game I sometimes play called cricket, and usually we use an app or website to keep track of our cricket progress like a scoreboard. However, for every scoreboard I've seen, there was always something non-ideal about it. Therefore, I decided to create my own version which is made as simple as possible for mobile devices so I can quickly whip it up on my phone and enjoy the game.

It is not perfect, but it works well. I wanted to add some extra features like changing the player name, and fix some small bugs I've found, but my web design skills ain't the best and was unsuccessful. Maybe in the future, I will have the skills necessary to sort this out and I definitely will as it was fustrating to fix. But for now, I am going to use this as it pretty much works flawlessly.
