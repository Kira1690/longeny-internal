import { app } from './app.js';
import { getConfig } from './config/index.js';

const config = getConfig();
const port = config.GATEWAY_PORT;

console.log(`Gateway starting on port ${port}`);

app.listen(port);
