// ─────────────────────────────────────────────────────────────
// AI Content Service Seed
// ─────────────────────────────────────────────────────────────
// No default seed data required for the ai-content service.
// Content and embeddings are created at runtime through
// user interactions and AI generation requests.
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log('AI content service seed: no default data to seed.');
  console.log('Content and embeddings are created at runtime.');
}

main().catch((e) => {
  console.error('Seed error:', e);
  process.exit(1);
});
