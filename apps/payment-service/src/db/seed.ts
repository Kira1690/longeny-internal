// ─────────────────────────────────────────────────────────────
// Payment Service Seed
// ─────────────────────────────────────────────────────────────
// No default seed data required for the payment service.
// All payment records (orders, payments, subscriptions, invoices,
// refunds, gateway customers) are created at runtime through
// user-initiated transactions and webhook events.
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log('Payment service seed: no default data to seed.');
  console.log('Payment records are created at runtime via transactions and webhooks.');
}

main().catch((e) => {
  console.error('Seed error:', e);
  process.exit(1);
});
