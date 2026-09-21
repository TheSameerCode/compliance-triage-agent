import { loadEnvironment } from './config/env.js';

const serviceName = 'compliance-triage-agent';
const environment = loadEnvironment();

console.info(`${serviceName} initialized on port ${environment.PORT}`);
