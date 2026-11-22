## What changed

<!-- Short description and the why. -->

## Risk and rollback

- Risk level: low / medium / high
- Rollback: revert commit / redeploy previous build / restore backup
- Database migration: yes / no (if yes, name it and state whether it is reversible)

## Checks

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:int` (if data access changed)
- [ ] `pnpm e2e` (if a user journey changed)
- [ ] `pnpm build`
- [ ] Env/deployment docs updated (if commands, variables or ports changed)

## Screenshots / notes

<!-- Only if useful. Do not paste secrets or personal data. -->
