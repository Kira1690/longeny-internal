import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { safety_logs } from '../db/schema.js';
import { createLogger, sha256 } from '@longeny/utils';

const logger = createLogger('ai-content:safety');

// ── PII patterns ──
const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  { name: 'phone', pattern: /(\+?\d{1,4}[\s-]?)?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9}/g, replacement: '[PHONE_REDACTED]' },
  { name: 'ssn', pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  { name: 'dob', pattern: /\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}\b/g, replacement: '[DOB_REDACTED]' },
  { name: 'dob_iso', pattern: /\b\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, replacement: '[DOB_REDACTED]' },
  { name: 'address', pattern: /\b\d{1,5}\s+\w+(\s+\w+)*\s+(street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|court|ct|way|place|pl)\b/gi, replacement: '[ADDRESS_REDACTED]' },
];

// ── Prompt injection patterns ──
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior\s+(instructions|prompts|rules)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /system\s*:\s*/i,
  /\<\|?(system|assistant|user)\|?\>/i,
  /jailbreak/i,
  /bypass\s+(safety|content|filter)/i,
  /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limitations|rules)/i,
  /do\s+not\s+follow\s+(your\s+)?(safety|content)\s+(guidelines|rules)/i,
];

// ── Medical diagnosis claim patterns ──
const DIAGNOSIS_PATTERNS = [
  /you\s+(have|are\s+diagnosed\s+with|are\s+suffering\s+from)\s+/i,
  /diagnosis\s*:\s*[A-Z]/i,
  /confirmed\s+(diagnosis|case)\s+of\s+/i,
  /this\s+is\s+(definitely|certainly|clearly)\s+(a\s+case\s+of|)\s*/i,
];

const MEDICAL_DISCLAIMER = '\n\n---\n**DISCLAIMER**: This content is AI-generated and intended for informational purposes only. It does not constitute medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider for medical decisions.';

export class SafetyService {
  constructor(_prismaUnused: unknown) {}

  /**
   * Strip PII from text, replacing with safe placeholders.
   * Converts exact DOB to age range.
   */
  stripPii(text: string, context?: { dateOfBirth?: string }): { cleaned: string; piiFound: string[] } {
    let cleaned = text;
    const piiFound: string[] = [];

    // Replace exact DOB with age range if provided
    if (context?.dateOfBirth) {
      const age = this.calculateAge(context.dateOfBirth);
      const ageRange = this.toAgeRange(age);
      cleaned = cleaned.replace(new RegExp(context.dateOfBirth.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `[AGE_RANGE: ${ageRange}]`);
      piiFound.push('date_of_birth');
    }

    for (const { name, pattern, replacement } of PII_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      if (regex.test(cleaned)) {
        piiFound.push(name);
        cleaned = cleaned.replace(new RegExp(pattern.source, pattern.flags), replacement);
      }
    }

    return { cleaned, piiFound };
  }

  /**
   * Detect prompt injection attempts in user input.
   */
  detectPromptInjection(text: string): { detected: boolean; patterns: string[] } {
    const detected: string[] = [];

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        detected.push(pattern.source);
      }
    }

    return { detected: detected.length > 0, patterns: detected };
  }

  /**
   * Validate AI output for medical diagnosis claims.
   */
  validateOutput(text: string): { flagged: boolean; reasons: string[] } {
    const reasons: string[] = [];

    for (const pattern of DIAGNOSIS_PATTERNS) {
      if (pattern.test(text)) {
        reasons.push(`Medical diagnosis claim detected: ${pattern.source}`);
      }
    }

    return { flagged: reasons.length > 0, reasons };
  }

  /**
   * Inject medical disclaimer into AI output.
   */
  injectDisclaimer(text: string): string {
    return text + MEDICAL_DISCLAIMER;
  }

  /**
   * Full safety pipeline: sanitize input, validate output, log events.
   */
  async processInput(
    text: string,
    userId?: string,
    aiRequestId?: string,
    context?: { dateOfBirth?: string },
  ): Promise<{ sanitized: string; blocked: boolean; safetyLogId?: string }> {
    const { cleaned, piiFound } = this.stripPii(text, context);
    const injection = this.detectPromptInjection(text);

    const inputHash = sha256(text);
    let blocked = false;
    let flagCategory: 'pii_leak' | 'prompt_injection' | null = null;
    let flagReason: string | null = null;

    if (injection.detected) {
      blocked = true;
      flagCategory = 'prompt_injection';
      flagReason = `Prompt injection detected: ${injection.patterns.join(', ')}`;
    }

    // Log safety event
    const [safetyLog] = await db.insert(safety_logs).values({
      ai_request_id: aiRequestId || null,
      user_id: userId || null,
      input_text_hash: inputHash,
      output_flagged: false,
      flag_reason: flagReason,
      flag_category: flagCategory,
      input_filtered: piiFound.length > 0,
      output_modified: false,
      disclaimer_injected: false,
    }).returning();

    if (piiFound.length > 0) {
      logger.info({ piiTypes: piiFound, safetyLogId: safetyLog.id }, 'PII stripped from input');
    }

    if (blocked) {
      logger.warn({ safetyLogId: safetyLog.id, patterns: injection.patterns }, 'Prompt injection blocked');
    }

    return { sanitized: cleaned, blocked, safetyLogId: safetyLog.id };
  }

  /**
   * Process AI output: validate and add disclaimer.
   */
  async processOutput(
    text: string,
    safetyLogId?: string,
  ): Promise<{ processed: string; flagged: boolean }> {
    const validation = this.validateOutput(text);
    const processed = this.injectDisclaimer(text);

    if (safetyLogId) {
      await db
        .update(safety_logs)
        .set({
          output_flagged: validation.flagged,
          flag_reason: validation.flagged ? validation.reasons.join('; ') : undefined,
          flag_category: validation.flagged ? 'harmful_health_advice' : undefined,
          output_modified: true,
          disclaimer_injected: true,
        })
        .where(eq(safety_logs.id, safetyLogId));
    }

    return { processed, flagged: validation.flagged };
  }

  private calculateAge(dateOfBirth: string): number {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  }

  private toAgeRange(age: number): string {
    if (age < 18) return 'under 18';
    if (age < 25) return '18-24';
    if (age < 35) return '25-34';
    if (age < 45) return '35-44';
    if (age < 55) return '45-54';
    if (age < 65) return '55-64';
    return '65+';
  }
}
