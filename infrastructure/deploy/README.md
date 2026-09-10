# Dev box deploys

The dev EC2 (`13.126.33.146`) is deployed by **pushing to it**, not by pulling from
GitHub. Both scripts here are the ones actually installed on the box; keep them in step.

```
git remote add production ubuntu@13.126.33.146:/home/ubuntu/longeny-repo.git
git push production main
```

That runs `post-receive`, which checks out the pushed commit, installs, migrates, seeds
roles, restarts the four services and health-gates the result. A failed health check
leaves the deploy in place and tells you to roll back — it does not roll back on its own,
because a half-understood automatic rollback during a demo is worse than a clear stop.

```
deploy-rollback              # back to whatever was running before the last push
deploy-rollback <sha>        # any commit in the deploy history
```

## Why push and not pull

The box has no GitHub credentials and the client repository is not ours to add a deploy
key to. We already have SSH to the box, so a bare repo there needs no new secret and no
new access. It also means the deploy history *is* the push history.

## Things that were wrong before this existed

- **No git at all.** `~/longeny` was a file copy. A bad deploy meant restoring a tarball
  and guessing what had changed. There was no answer to "what is actually running?".
- **The gateway health check.** `curl -sf` calls the gateway dead, because it answers
  503 whenever a downstream is missing — and booking and payment are deliberately not
  deployed here. An expected 503 and a real outage looked identical. The hook now reads
  the gateway's own status out of the body and prints which downstreams are unreachable.
- **Roles and permissions are seeded, not migrated.** A release that adds a permission
  ships code that every real user is refused by. `intake:write` did exactly that on the
  first Week 7 deploy: the seed had it, the database did not, and the API answered 403 to
  a correctly built request. The E2E suites cannot catch this — they mint their own tokens
  with the permission list hard-coded, so they never read the role map. The seed now runs
  on every deploy; it is idempotent, and it is wrapped in a timeout because it does not
  close its database pool.

## What is deliberately not deployed

`booking-service` and `payment-service`. The gateway reports them unreachable and that is
expected. See the calendar-invite descope in `plan/rro/CARRY-FORWARD.md`.

## Secrets

`.env` lives in the work tree, is untracked, and survives every deploy — `checkout -f`
only touches tracked files. It is never in either repository.
