## Related issue
Closes #

## Summary
- 

## Validation
- [ ] `npm run test:unit`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npx supabase db reset --no-seed` and `npx supabase test db` (schema/auth changes; disposable local Supabase only)
- [ ] Relevant Playwright/browser tests (list below)
- [ ] Browser/manual checks (list below)

### Test results / limitations
Provide actual results, not assumptions.

## Screenshots and browser evidence
For UI changes, attach real screenshots or credential-safe GitHub Actions evidence. For docs-only changes, state “not applicable” for changed-UI screenshots; link actual CI evidence where available. Never invent screenshots or upload arbitrary DOM, traces, or logs. Drafts are marked ready by a human after a successful CI run on the current head SHA.

## Preview deployment
Verified Vercel preview URL (or explain why unavailable). A preview is not a production deployment:

## Risks, dependencies, and migration notes

## Human verification steps
1. 
2. 

## Safety review
- [ ] No secrets committed
- [ ] No production data or schema changes performed by the agent
- [ ] No automatic merge enabled
