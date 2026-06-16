// /api/health — liveness check used by verify.sh and uptime monitors.
// Returns 200 with the app slug and a timestamp. No auth required so the
// SWA proxy and load balancer can reach it.

import { app } from '@azure/functions';
import { isMockMode } from '../lib/aoai.js';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async () => {
    return {
      status: 200,
      jsonBody: {
        status: 'ok',
        app: process.env.APP_NAME || 'care-intelligence',
        aiMode: isMockMode() ? 'mock' : 'live',
        timestamp: new Date().toISOString()
      }
    };
  }
});
