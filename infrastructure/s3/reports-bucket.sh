#!/usr/bin/env bash
#
# The patient-reports bucket, as code (M-W8-2).
#
# The bucket holds patient lab reports. Every setting that makes that safe is
# applied here and checked here, so it is reproducible and reviewable rather
# than clicked in a console and forgotten.
#
#   reports-bucket.sh verify <bucket>                         read-only; exits 1 on any FAIL
#   reports-bucket.sh apply  <bucket> <cors-origins> [role]   idempotent
#
#   cors-origins  comma separated, e.g. https://app.longeny.com,http://localhost:5173
#   role          IAM role the service runs as; granted Put/Get/Delete on this bucket only
#
# Run with project credentials, never the machine's default profile:
#   source internal-notes/aws/env.sh
#
# What it does NOT do: expire current reports. How long a report is kept has to
# match what the consent text promises the patient, and that number has not been
# decided. Until it is, reports are kept; only superseded versions and abandoned
# uploads are cleaned up. See RETENTION below.

set -euo pipefail

MODE=${1:-}
BUCKET=${2:-}
[[ -z "$MODE" || -z "$BUCKET" ]] && { sed -n '8,13p' "$0"; exit 2; }

REGION=${AWS_REGION:-ap-south-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
LOG_BUCKET="longeny-access-logs-${ACCOUNT}"

# Superseded versions of a report are kept this long so an accidental overwrite
# or delete can be undone, then removed.
NONCURRENT_DAYS=30
# RETENTION: current reports are not expired. Set this when the consent text
# names a period, and write the reason next to the number.
CURRENT_EXPIRY_DAYS=""

pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL  $1"; fail=$((fail + 1)); }

verify() {
  local b=$1
  echo "── verify s3://$b"
  if ! aws s3api head-bucket --bucket "$b" >/dev/null 2>&1; then
    bad "bucket exists and is ours"; return
  fi
  ok "bucket exists and is ours"

  local loc; loc=$(aws s3api get-bucket-location --bucket "$b" --query LocationConstraint --output text)
  [[ "$loc" == "$REGION" ]] && ok "region $REGION (data stays in India)" || bad "region is $loc, expected $REGION"

  local pab; pab=$(aws s3api get-public-access-block --bucket "$b" --output text \
    --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' 2>/dev/null || echo none)
  [[ "$pab" == $'True\tTrue\tTrue\tTrue' ]] && ok "public access blocked (bucket)" || bad "public access block: $pab"

  local own; own=$(aws s3api get-bucket-ownership-controls --bucket "$b" --output text \
    --query 'OwnershipControls.Rules[0].ObjectOwnership' 2>/dev/null || echo none)
  [[ "$own" == "BucketOwnerEnforced" ]] && ok "ACLs disabled (BucketOwnerEnforced)" || bad "object ownership: $own"

  local sse; sse=$(aws s3api get-bucket-encryption --bucket "$b" --output text \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' 2>/dev/null || echo none)
  [[ "$sse" == "aws:kms" ]] && ok "default encryption SSE-KMS" || bad "default encryption: $sse"

  local ver; ver=$(aws s3api get-bucket-versioning --bucket "$b" --query Status --output text)
  [[ "$ver" == "Enabled" ]] && ok "versioning on" || bad "versioning: $ver"

  local tls; tls=$(aws s3api get-bucket-policy --bucket "$b" --query Policy --output text 2>/dev/null || echo "")
  grep -q '"aws:SecureTransport":"false"' <<< "${tls//[[:space:]]/}" && ok "plain-HTTP access denied by policy" || bad "no deny-insecure-transport policy"

  local log; log=$(aws s3api get-bucket-logging --bucket "$b" --query 'LoggingEnabled.TargetBucket' --output text 2>/dev/null || echo None)
  [[ "$log" == "$LOG_BUCKET" ]] && ok "access logging to $LOG_BUCKET" || bad "access logging: $log"

  local lc; lc=$(aws s3api get-bucket-lifecycle-configuration --bucket "$b" --output json 2>/dev/null || echo "{}")
  grep -q '"NoncurrentDays": '"$NONCURRENT_DAYS" <<< "$lc" && ok "superseded versions expire after ${NONCURRENT_DAYS}d" || bad "no noncurrent-version expiry"
  grep -q 'AbortIncompleteMultipartUpload' <<< "$lc" && ok "abandoned uploads cleaned up" || bad "no abort-incomplete-multipart rule"

  local cors; cors=$(aws s3api get-bucket-cors --bucket "$b" --query 'CORSRules[0].AllowedMethods' --output text 2>/dev/null || echo none)
  grep -q PUT <<< "$cors" && ok "CORS allows browser PUT" || bad "CORS: $cors (browsers cannot upload)"
}

apply_bucket() {
  local b=$1 origins=$2 role=${3:-}
  echo "── apply s3://$b"

  if ! aws s3api head-bucket --bucket "$b" >/dev/null 2>&1; then
    aws s3api create-bucket --bucket "$b" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
    echo "  created $b"
  fi

  aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-ownership-controls --bucket "$b" \
    --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
  # SSE-KMS with the account's S3 key and a bucket key (fewer KMS calls, lower
  # cost). A customer-managed key is a later decision; this is not unencrypted.
  aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"},"BucketKeyEnabled":true}]}'
  aws s3api put-bucket-versioning --bucket "$b" --versioning-configuration Status=Enabled

  aws s3api put-bucket-policy --bucket "$b" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*",
 "Action":"s3:*","Resource":["arn:aws:s3:::$b","arn:aws:s3:::$b/*"],
 "Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}
JSON
)"

  local expire=""
  [[ -n "$CURRENT_EXPIRY_DAYS" ]] && expire=",\"Expiration\":{\"Days\":$CURRENT_EXPIRY_DAYS}"
  aws s3api put-bucket-lifecycle-configuration --bucket "$b" --lifecycle-configuration "$(cat <<JSON
{"Rules":[{"ID":"reports-housekeeping","Status":"Enabled","Filter":{"Prefix":""},
 "NoncurrentVersionExpiration":{"NoncurrentDays":$NONCURRENT_DAYS},
 "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}$expire}]}
JSON
)"

  local origins_json; origins_json=$(tr ',' '\n' <<< "$origins" | sed 's/.*/"&"/' | paste -sd,)
  aws s3api put-bucket-cors --bucket "$b" --cors-configuration "$(cat <<JSON
{"CORSRules":[{"AllowedOrigins":[$origins_json],"AllowedMethods":["PUT","GET"],
 "AllowedHeaders":["content-type","content-length"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]}
JSON
)"

  # Access logs go to their own bucket, which is locked down the same way and
  # accepts writes only from the S3 logging service for this account.
  if ! aws s3api head-bucket --bucket "$LOG_BUCKET" >/dev/null 2>&1; then
    aws s3api create-bucket --bucket "$LOG_BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
    echo "  created $LOG_BUCKET"
  fi
  aws s3api put-public-access-block --bucket "$LOG_BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-ownership-controls --bucket "$LOG_BUCKET" \
    --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
  aws s3api put-bucket-encryption --bucket "$LOG_BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-bucket-policy --bucket "$LOG_BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"S3ServerAccessLogs","Effect":"Allow",
 "Principal":{"Service":"logging.s3.amazonaws.com"},"Action":"s3:PutObject",
 "Resource":"arn:aws:s3:::$LOG_BUCKET/*",
 "Condition":{"StringEquals":{"aws:SourceAccount":"$ACCOUNT"}}}]}
JSON
)"
  aws s3api put-bucket-logging --bucket "$b" --bucket-logging-status \
    "{\"LoggingEnabled\":{\"TargetBucket\":\"$LOG_BUCKET\",\"TargetPrefix\":\"$b/\"}}"

  if [[ -n "$role" ]]; then
    aws iam put-role-policy --role-name "$role" --policy-name "reports-bucket-$b" --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Action":["s3:PutObject","s3:GetObject","s3:DeleteObject"],
 "Resource":"arn:aws:s3:::$b/*"}]}
JSON
)"
    echo "  granted $role Put/Get/Delete on $b/* only"
  fi
}

case "$MODE" in
  verify) verify "$BUCKET" ;;
  apply)
    [[ -z "${3:-}" ]] && { echo "apply needs <cors-origins>"; exit 2; }
    apply_bucket "$BUCKET" "$3" "${4:-}"
    verify "$BUCKET"
    ;;
  *) echo "unknown mode: $MODE"; exit 2 ;;
esac

echo "── $pass passed, $fail failed"
[[ $fail -eq 0 ]]
