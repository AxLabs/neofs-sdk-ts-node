# Release Flow

## Prerequisites

- `package.json` version is updated (for example `0.0.2`).
- npm Trusted Publishing is configured for `.github/workflows/release.yaml`.
- You have permission to push tags and create releases.
- Workflow runtime must use Node `24.x` and npm `11+`.

## How to release

1. Push your release commit to `main`.
2. Open GitHub Actions and run the `Release` workflow manually.

## What the workflow does

1. Reads version from `package.json` and sets tag `v<version>`.
2. Installs dependencies and runs tests.
3. Fails if that version is already published on npm.
4. Fails if tag `v<version>` already exists.
5. Creates and pushes tag `v<version>` on the current commit.
6. Creates a GitHub Release for that tag.
7. Publishes the package to npm.

## Failure behavior

- Existing tag: workflow fails (no tag overwrite).
- Existing npm version: workflow fails (no duplicate publish).
