# Changesets

Every change that should reach npm comes with a changeset: run `pnpm changeset`, pick the bump (patch, minor or major) and describe the change for the changelog. Commit the generated file with the change.

When changesets land on `main`, the release workflow opens (or updates) a "Version Packages" PR that bumps the version and writes `CHANGELOG.md`. Merging that PR publishes to npm.
