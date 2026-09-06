import { type BookingConfig, bookingConfigSchema, loadConfig } from '@longeny/config';

/** Single load of the validated booking config. */
export const config: BookingConfig = loadConfig(bookingConfigSchema);
