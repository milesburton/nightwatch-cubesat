# Deployment

The station runs as a Docker container on a Raspberry Pi with an RTL-SDR dongle. Everything the
software needs (GNU Radio, gr-satellites, Direwolf, rtl-sdr, Node.js) is in the image, so the Pi
needs only Docker and the RTL-SDR udev rules.

## Images

- **Base** (`docker/Dockerfile.base`): Debian 13, GNU Radio, Direwolf and gr-satellites built from a
  pinned upstream commit. Rebuilt rarely.
- **App** (`docker/Dockerfile.app`): the code, on top of the base.

## Getting the arm64 image onto the Pi

Without a registry login, from a machine with Docker and QEMU binfmt for arm64:

```bash
scripts/build-arm64-for-pi.sh user@pi              # base + app
scripts/build-arm64-for-pi.sh user@pi --base-only  # only the base image
scripts/build-arm64-for-pi.sh user@pi --app-only
```

It builds under emulation (the first base build compiles gr-satellites and is slow), saves the
image, copies it with `rsync --partial` so a dropped link resumes, and runs `docker load` on the Pi.

Alternatively `.github/workflows/docker-build.yml` builds and pushes to ghcr.io on every push to
`main`. The repository is private, so the Pi then needs `docker login ghcr.io` with a token that has
`read:packages`.

## Running

```bash
cp .env.example .env     # station coordinates, SATNOGS_API_TOKEN
docker compose -f docker/compose.yaml up -d
```

The compose file references `ghcr.io/milesburton/nightwatch-cubesat:latest`; after loading a local
image, tag it to match (`docker tag nightwatch-cubesat:arm64 ghcr.io/milesburton/nightwatch-cubesat:latest`).
The container runs privileged with `/dev/bus/usb` mounted so it can reach the dongle.

Settings are listed in [reference/ENVIRONMENT-VARS.md](reference/ENVIRONMENT-VARS.md).

## Wi-Fi watchdog

For a Pi on poor Wi-Fi, see `deploy/pi/` and the top-level README.
