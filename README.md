# Nightwatch Cubesat

Receive-only ground station software for **cubesat telemetry on the 2m amateur band
(144–146 MHz)**, built to run on a Raspberry Pi with an RTL-SDR dongle and an
omnidirectional antenna (a Diamond X30 in the author's case).

It started as a fork of [night-watch](https://github.com/milesburton/night-watch), which
captured NOAA and METEOR weather imagery. Those satellites are gone or unreliable, so this
project keeps the useful machinery (orbit prediction, Doppler, scheduling, the SDR pipeline,
the web dashboard) and points it at something else: listening to small satellites that
beam their health data back to Earth.

> **Status: early development.** The pieces below marked "working" have tests. The full
> automatic "predict a pass, record it, decode it" loop for cubesats is **not wired up yet**.

## What works today

| Area | State |
|---|---|
| Candidate list from [SatNOGS](https://db.satnogs.org): active 2m transmitters on in-orbit satellites, ranked by recent signal reports | Working (`npm run candidates`) |
| Telemetry decoder: runs [gr-satellites](https://github.com/daniestevez/gr-satellites) on an IQ recording and stores the frames | Working, tested against the real tool |
| Docker base image (Debian 13, gr-satellites, GNU Radio, Direwolf, rtl-sdr, Node 22) | Working on amd64; arm64 untested |
| Orbit prediction, Doppler, FFT waterfall, web dashboard, ISS SSTV | Inherited from night-watch |
| Pi Wi-Fi watchdog (escalating reconnect / reboot) | Written and tested, not yet installed |
| Pass ranking for your station, scheduler recording cubesat passes | Planned |
| Newer satellites missing from the packaged gr-satellites | Planned (pin a newer release) |

## How it fits together

```
SatNOGS DB ──► candidates (SQLite) ──► scheduler ──► rtl_sdr (IQ, 250 kS/s)
                                            ▲                │
                          TLEs + station    │                ▼
                          (CelesTrak)       │      gr_satellites ──► frames (JSON/KISS) ──► dashboard
```

- **Language:** TypeScript on Node.js, in a functional style (pure functions, immutable data,
  side effects at the edges). External tools (`rtl_sdr`, `gr_satellites`) run as subprocesses.
- **Signal type:** `telemetry` is raw IQ at 250 kS/s, wide enough for BPSK 1k2 up to GMSK 19k2
  with Doppler margin. `sstv` (the ISS) is inherited.
- **Candidates:** `src/backend/satnogs/` selects 2m transmitters from SatNOGS and checks
  Network observations for evidence a satellite is really on air (SatNOGS "alive" flags are
  optimistic). Your enable/disable choices survive re-syncs.
- **Decoding:** `src/backend/capture/decoders/telemetry-decoder.ts` calls `gr_satellites` with the
  satellite's NORAD id and parses its KISS output.

## Hardware

- Raspberry Pi 4 (2 GB is enough; 64-bit Raspberry Pi OS or Debian)
- RTL-SDR dongle (v3 or v4)
- A 2m antenna with a clear view of the sky. An omnidirectional vertical works for strong
  beacons on high passes; expect little below about 15° elevation.
- Strongly advised: a 2m bandpass (or at least FM-broadcast) filter and a short, good coax run.
  A bare dongle on 2m is easily overloaded by broadcast FM.
- A stable power supply. Under-voltage on a Pi degrades USB devices.

This is a receive-only station. Nothing here transmits.

## Getting started

```bash
git clone git@github.com:milesburton/nightwatch-cubesat.git
cd nightwatch-cubesat
npm ci
cp .env.example .env     # set STATION_LATITUDE / STATION_LONGITUDE / STATION_ALTITUDE
```

Your `.env` is gitignored; keep your coordinates there and nowhere else in the repo.

### Build the candidate list

```bash
npm run candidates sync       # about a minute; SatNOGS rate-limits, so it paces itself
npm run candidates list       # enabled candidates, most active first
npm run candidates list --all
npm run candidates enable <transmitterId>
npm run candidates disable <transmitterId>
```

`SATNOGS_API_TOKEN` in `.env` is optional today. It is reserved for the telemetry endpoints.

### Run the decoder tests against the real tool

The integration test needs `gr_satellites` and Direwolf's `gen_packets`, which the Docker
base image provides:

```bash
docker build -f docker/Dockerfile.base -t nightwatch-cubesat-base:test .
docker run --rm -v "$PWD":/app -w /app nightwatch-cubesat-base:test \
  npx vitest run src/backend/capture/decoders/telemetry-decoder.integration.spec.ts
```

Elsewhere the integration test is skipped.

### Install the Wi-Fi watchdog on a Pi

For a headless Pi on poor Wi-Fi. Pings the gateway every minute and escalates through
reconnect, NetworkManager restart, driver reload and finally a guarded reboot.

```bash
sudo deploy/pi/install-wifi-watchdog.sh
```

## Satellite support

Decoding is delegated to gr-satellites. The version packaged in Debian 13 (5.5.0) knows 9 of the
45 in-orbit 2m satellites SatNOGS lists: FUNcube-1 (AO-73), ITASAT-1, JY1-Sat, DELFI-n3Xt,
NanoSatC-BR1, CAS-6, ESEO, UKube-1 and FloripaSat-1. Newer satellites need a newer gr-satellites.

## Development

```bash
npm test               # Vitest
npm run lint           # Biome
npm run typecheck      # tsc --noEmit
npm run format
```

Conventional commits are enforced (commitlint). New code is tested alongside the module it
belongs to, and external commands are injected or mocked so tests need no radio.

## Documentation

See [docs/](docs/README.md): scheduling and decoding, deployment, the API and every setting.
Details of the Pi it runs on (address, Wi-Fi, SDR, recovery) are in the homelab-docs site.

## Licence and credits

MIT. Orbit and Doppler code and the dashboard come from
[night-watch](https://github.com/milesburton/night-watch). Telemetry decoding is by
[gr-satellites](https://github.com/daniestevez/gr-satellites) (Daniel Estévez). Satellite and
transmitter data from [SatNOGS](https://satnogs.org).
