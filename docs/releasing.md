# Release Checklist

This document outlines the steps to cut a new release of the Orchestrator CLI.

## Prerequisities

- Ensure all tests pass: `pnpm test`
- Ensure the build is clean: `pnpm build`
- Ensure linting passes: `pnpm lint`

## Release Steps

1.  **Update Changelog**:
    - Move entries from `[Unreleased]` to a new version section (e.g., `## [0.1.0] - YYYY-MM-DD`).
    - Ensure `CHANGELOG.md` is up to date.

2.  **Bump Version**:
    - Update the version in `package.json` (and `packages/cli/package.json` if necessary).
    - You can use `npm version` or manually edit.

3.  **Build**:
    - Run `pnpm build` to ensure artifacts are generated.

4.  **Pack CLI (Optional)**:
    - Run `pnpm pack:cli` to generate a tarball for testing or distribution.

5.  **Commit and Tag**:
    - Commit changes: `git commit -m "chore(release): vX.Y.Z"`
    - Tag the release: `git tag vX.Y.Z`

6.  **Push**:
    - `git push origin main --tags`

## Future Improvements

- Automate this process using CI/CD.
- Publish to npm registry.
