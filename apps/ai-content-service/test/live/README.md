# Live report tests — real S3, real Textract, nothing faked

These run **on the dev server** against the deployed client-repo build, through the
gateway. They cost a few cents of Textract per run. Every account, profile, report,
audit row and page they create is removed at the end; the S3 object keys are written to
`/tmp/hier/keys.txt` (or printed as `KEYS=`) and removed afterwards with the project
AWS credentials.

| File | What |
|---|---|
| `make-reports.py` | Builds realistic lab reports from HTML (headless Chromium + Pillow): digital PDFs, screenshots, tilted phone photos, image-only "scanned" PDFs, a TIFF, a dark photo, a DICOM stand-in. Each report carries a unique patient and sample ID. |
| `reports.json` | The 15 reports: which account and family member owns each, the format, and what the reader must produce. |
| `hierarchical.live.ts` | 3 accounts, 7 profiles, 15 reports. Checks each report lands on the right person with that person's care stage, is read the right way (text layer / OCR / mixed / failed / not applicable), its text holds its own values and no other report's sample ID, every timeline holds exactly its own reports, every cross-account read, write and upload is 404, the same PDF from two accounts stays two reports, filters, download, retry, delete, access log, audit rows. |
| `smoke.live.ts` | A shorter pass over the same path. |

## Run

```bash
python3 make-reports.py        # writes ./out (needs Playwright's Chromium + Pillow)
# copy reports.json and out/ to the server as /tmp/hier, the script into
# /home/ubuntu/longeny/apps/ai-content-service/, then on the server:
cd /home/ubuntu/longeny && set -a && . ./.env && set +a
cd apps/ai-content-service && bun run hierarchical.live.ts   # then delete the copy
```

Provider-with-booking paths are not covered here: booking is not deployed on the dev
server. They are covered by `reports.e2e.ts` locally.

Last run 2026-09-18: 170/172 before the fix for audit rows on deleted reports.
