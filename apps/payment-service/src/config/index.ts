import { type PaymentConfig, loadConfig, paymentConfigSchema } from '@longeny/config';

/**
 * Single load of the validated payment config. Eight modules each called
 * loadConfig() separately, so a boot-time validation failure could surface from
 * any of them and a change to config resolution had to be made eight times.
 */
export const config: PaymentConfig = loadConfig(paymentConfigSchema);
