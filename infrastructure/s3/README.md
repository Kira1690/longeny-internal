# Patient reports bucket

`reports-bucket.sh` is the bucket's configuration. Apply it, verify it, and change it
here — not in the console.

```
source internal-notes/aws/env.sh
infrastructure/s3/reports-bucket.sh verify longeny-reports-836533914754
infrastructure/s3/reports-bucket.sh apply  longeny-reports-836533914754 \
  https://<frontend-origin>,http://localhost:5173  longeny-dev-bedrock
```

| Setting | Why |
|---|---|
| ap-south-1 | Patient data stays in India (DPDP). |
| Public access blocked, ACLs disabled | Nothing in here is ever public; access is by presigned link only. |
| SSE-KMS by default, bucket key on | Encrypted at rest without relying on the uploader to ask for it. |
| Versioning, superseded versions kept 30 days | An overwrite or delete can be undone for a month. |
| Deny non-TLS | A report never crosses the network in the clear. |
| Server access logs → `longeny-access-logs-<account>` | "Who read this report" has an answer outside the application. |
| Abandoned multipart uploads removed after 1 day | No half-uploads of patient files lying around. |
| CORS: PUT/GET from named origins only | Browsers upload straight to S3 with the presigned link. |
| Role grant: Put/Get/Delete on this bucket's objects only | The service can sign links for this bucket and nothing else. |

## Retention — not decided

Current reports are **not** expired. How long a lab report is kept has to match what the
consent text tells the patient, and that period has not been set. When it is, set
`CURRENT_EXPIRY_DAYS` in the script, write the reason next to it, and re-apply.

## Enforced by S3, not only by the service

The upload link is presigned with `Content-Length` and `Content-Type` as signed headers.
S3 refuses a `PUT` whose size or type differs from what the service checked
(`report-storage.e2e.ts` proves this against LocalStack with signature validation on).
The type check is on the declared type, not the file's bytes — a PDF-shaped header on a
non-PDF body is not caught here. Content inspection belongs to extraction (P-W8-1).
