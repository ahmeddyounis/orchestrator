# Dependency Update Policy

This document outlines the policy for managing dependencies in the orchestrator monorepo.

## Overview

Dependencies are categorized by their criticality and update frequency requirements.

## Dependency Categories

### Critical Dependencies (Provider SDKs)

These dependencies directly interact with external APIs and require careful version management:

| Package | Min Version | Update Policy |
|---------|-------------|---------------|
| `@anthropic-ai/sdk` | ^0.71.0 | Review changelogs for breaking changes before updating. Test adapter compatibility. |
| `openai` | ^6.17.0 | Review changelogs for breaking changes before updating. Test adapter compatibility. |

**Update Process for Provider SDKs:**
1. Review the SDK changelog for breaking changes
2. Check for API compatibility changes
3. Run adapter smoke tests (`pnpm adapters:smoke`)
4. Run full test suite
5. Update version in `packages/adapters/package.json`

### Schema Validation (Zod)

| Package | Version | Notes |
|---------|---------|-------|
| `zod` | ^4.3.6 | Used across multiple packages. Must be consistent. |

**Important:** All packages using Zod must use the same major version to ensure schema compatibility.

### Development Dependencies

Development dependencies are managed via Dependabot with automatic minor/patch updates:

- `typescript`: ^5.x (minor updates only)
- `vitest`: ^4.x (minor updates only)
- `eslint`: ^9.x (minor updates only)
- `prettier`: ^3.x (minor updates only)

### Build Tools

| Package | Version | Update Policy |
|---------|---------|---------------|
| `turbo` | ^2.x | Major updates require review |
| `esbuild` | ^0.x | Minor updates allowed |
| `husky` | ^9.x | Minor updates allowed |

## Automated Dependency Management

### Dependabot

Dependabot is configured to:
- Run weekly on Mondays
- Group dev dependencies together
- Ignore major version updates (require manual review)
- Cover all packages in the monorepo

### Security Audits

Run security audits regularly:

```bash
# Run pnpm audit
pnpm audit

# Run audit with fix suggestions
pnpm audit --fix
```

## Manual Update Process

### Minor/Patch Updates

```bash
# Check for outdated packages
pnpm outdated

# Update specific package
pnpm update <package-name>

# Update all packages (minor/patch only)
pnpm update
```

### Major Updates

1. Review changelog for breaking changes
2. Create a feature branch
3. Update the dependency
4. Run full test suite: `pnpm check`
5. Update any affected code
6. Submit PR for review

## Version Pinning

- Use caret (`^`) for most dependencies to allow minor/patch updates
- Use exact versions only for known problematic packages
- Never use `*` or `latest` specifiers

## Audit Schedule

- **Weekly**: Dependabot PRs reviewed
- **Monthly**: Manual audit of critical dependencies
- **Quarterly**: Review and update this policy
