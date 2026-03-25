// Re-export everything from the split webhooks modules for backwards compatibility.
// Any file importing from './webhooks' or './webhooks.js' will continue to work.
export { registerRoutes } from './webhooks/index.js';
