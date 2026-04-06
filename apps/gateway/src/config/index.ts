import { loadConfig, gatewayConfigSchema, type GatewayConfig } from '@longeny/config';

let _config: GatewayConfig | undefined;

export function getConfig(): GatewayConfig {
  if (!_config) {
    _config = loadConfig(gatewayConfigSchema);
  }
  return _config;
}
