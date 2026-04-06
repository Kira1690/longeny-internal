#!/bin/bash
echo "Initializing LocalStack..."

# S3 Buckets
awslocal s3 mb s3://longeny-uploads
awslocal s3 mb s3://longeny-documents

# SQS Queues
awslocal sqs create-queue --queue-name longeny-events-dlq
awslocal sqs create-queue --queue-name longeny-events --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:longeny-events-dlq\",\"maxReceiveCount\":\"3\"}"}'
awslocal sqs create-queue --queue-name longeny-notifications-dlq
awslocal sqs create-queue --queue-name longeny-notifications --attributes '{"RedrivePolicy":"{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:longeny-notifications-dlq\",\"maxReceiveCount\":\"3\"}"}'

# SNS Topics
awslocal sns create-topic --name longeny-user-events
awslocal sns create-topic --name longeny-booking-events
awslocal sns create-topic --name longeny-payment-events
awslocal sns create-topic --name longeny-provider-events
awslocal sns create-topic --name longeny-gdpr-events

# SES (email verification for local)
awslocal ses verify-email-identity --email-address noreply@longeny.com

echo "LocalStack initialization complete."
