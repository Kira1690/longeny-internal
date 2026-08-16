import { type GatewayConfig, gatewayConfigSchema, loadConfig } from '@longeny/config';

let _config: GatewayConfig | undefined;

export function getConfig(): GatewayConfig {
  if (!_config) {
    _config = loadConfig(gatewayConfigSchema) as GatewayConfig;
  }
  return _config as GatewayConfig;
}
