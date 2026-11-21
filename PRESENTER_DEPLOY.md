# Presenter pairing deployment

This branch is intentionally separate from production. Do **not** merge the page before deploying and testing the Worker.

1. In Cloudflare, use the same account as `straindiary-competition-live`. Install/login to Wrangler locally, then from this repository run:
   `npx wrangler deploy --config competition-wrangler.toml`
   This creates the SQLite-backed `CompetitionState` Durable Object and binds it as `COMPETITION_STATE` to the existing Worker. Confirm the `CK_API_TOKEN` secret still exists for that Worker; do not put its value in the repository.
2. Verify the production Worker with a real closed test competition. `GET /?code=CODE` must return no `total`, `name`, `criteria`, or `checklist` in any unrevealed entry and must list entries by internal number. `GET /ceremony?code=CODE` must say `false` unless the host set `resultsPublic`.
3. On the test computer, open the branch preview of `live.html#CODE`, choose Display settings → Request pairing code, then enter the separate six-digit code in the host's app. Verify the app sees the same title/device, approval succeeds, and the computer unlocks. Verify an incorrect iCloud account cannot approve.
4. Reveal an award and confirm a separate public viewer sees only that award. Finish the ceremony and confirm the viewer then sees the full leaderboard. Delete the host's approval record and confirm the presenter session is rejected after re-check. Test reload, expiry and a second presenter computer.
5. Only after the Worker and app pass these tests, merge the `presenter-pairing` branch into `main` to publish the page through GitHub Pages.

The app contract sends `code` with `/presenter/approve` and `/presenter/status`. The request ID is 16 random bytes in base64url and stays opaque. The Worker cannot authenticate a host from the six-digit pairing code alone.

Known limit: the scorecards remain in CloudKit's public database. This prevents website/API spoilers, not determined direct CloudKit access.
