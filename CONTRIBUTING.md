# Contributing

## Branches

`main` is protected and always deployable. Never commit directly to it.

```bash
git switch main
git pull --ff-only
git switch -c feat/short-description
```

Use prefixes such as `feat/`, `fix/`, `docs/`, `chore/` or `test/`.

## Pull requests

- Open a PR against `main`; one approval is required.
- CI must pass: lint, typecheck, tests (including integration where relevant), build, and the
  Playwright job.
- Keep PRs small and describe risk, migrations, environment changes and rollback.
- Do not merge with failing checks or unresolved review comments.
- Use the repository PR template.

## Commits

Conventional Commits are enforced by commitlint:

```
feat(provider): add clinic in-charge validation
fix(auth): keep session cookie secure over HTTPS
docs(deploy): document Render migration ordering
```

Husky runs lint-staged on commit. Do not bypass hooks with `--no-verify` unless you have a stated
reason and have run the same checks manually.

## Before pushing

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:int   # data-access changes
pnpm e2e        # journey/UI changes
```

If you changed the Prisma schema:

```bash
pnpm db:generate
pnpm db:migrate   # against your local database
```

Commit the schema, migration and generated client changes together. Never edit a migration that
has already been applied; add a new one.

## Environment and secrets

- Commit `.env.example` and the staging/production example files only.
- Never commit a real `.env`, token, password, key or database dump.
- Share secrets through the team password manager or platform secret store.
- If you suspect a secret was committed, tell the maintainers immediately and rotate it; deleting
  the file in a later commit is not enough.

## Lockfile conflicts

Do not hand-edit `pnpm-lock.yaml`. Choose one side and regenerate:

```bash
git checkout --ours pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml
```

## Documentation

Update `docs/DEPLOYMENT_GUIDE.md` when a command, variable, port, migration or deployment step
changes. Record product/architecture decisions in `docs/decisions.md`, not only in a PR.
