# Candidates, scheduling and decoding

## Where targets come from

`npm run candidates sync` reads 2 m (144-146 MHz) transmitters from SatNOGS DB, keeps those on
satellites still in orbit, and counts recent *good* observations for each. The result is stored in
the `candidates` table of the SQLite database. A candidate starts enabled only if it was heard
recently; `enable` / `disable` override that and the choice survives later syncs.

At run time (`src/backend/satellites/targets.ts`) the targets are:

1. the built-in satellites (the ISS, for SSTV), plus
2. every enabled candidate that the installed `gr_satellites` can decode (its NORAD id appears in
   `gr_satellites --list_satellites`).

If `gr_satellites` cannot be run, the decodability filter is skipped.

## Passes

Passes are predicted from CelesTrak TLEs (one fetch per NORAD id, cached). Several transmitters on
one satellite give several targets with the same pass.

Because there is one SDR, `src/backend/prediction/ranking.ts` picks which passes to record:

- score = 0.5 x max elevation (0-90 degrees) + 0.2 x duration (capped at 15 min) + 0.3 x recent
  activity (good SatNOGS observations, capped at 10; built-in targets count as 0.5)
- passes are taken best-first and skipped if their capture window (pass plus the 60 s buffer on
  each side) overlaps one already taken
- the chosen passes are recorded in time order

`npm run predict` prints the plan with scores.

## Recording and decoding

Telemetry passes record raw IQ at 250 kS/s. `gr_satellites` decodes it to KISS frames
(`src/backend/capture/decoders/telemetry-decoder.ts`), which are stored alongside the recording.
The gr-satellites version is pinned in `docker/Dockerfile.base`; a newer version decodes more
satellites.
