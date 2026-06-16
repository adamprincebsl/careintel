// /api/assistant/ask — the NL chat / Q&A assistant (SKELETON).
//
// This is a single-shot stub that proves the AOAI seam end-to-end. The full
// tool-calling agent (live queries against capData.js, multi-turn sessions
// persisted to the `chatSessions` container, citations back to source CAPs/
// risks) is specified in PLAN.md §"AI assistant".
//
// In mock mode (no AOAI provisioned) completeText returns a deterministic
// stub so the chat UI works locally without any Azure OpenAI resource.

import { app } from '@azure/functions';
import { requireAuth } from '../lib/auth.js';
import { completeText, isMockMode } from '../lib/aoai.js';

const SYSTEM = `You are Beacon Care Intelligence, an analyst assistant for a
multi-state IDD/SMI residential care provider. You answer questions about
corrective action plans (CAPs), risks, audits, and program performance.
Be concise, cite the data you used, and never invent figures. When you lack
data, say so. (Skeleton: live data tools are wired in a later phase.)`;

app.http('assistantAsk', {
  methods: ['POST'],
  authLevel: 'anonymous', // SWA enforces auth at the edge
  route: 'assistant/ask',
  handler: async (request) => {
    requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const question = (body.question || '').toString().trim();
    if (!question) {
      return { status: 400, jsonBody: { error: 'question is required' } };
    }

    const { text, mock, tokens } = await completeText({
      system: SYSTEM,
      user: question,
      maxTokens: 500,
      mockFallback: `[MOCK ASSISTANT] You asked: "${question}". Azure OpenAI is not provisioned in this environment, so this is a stubbed reply. Once AOAI_ENDPOINT/AOAI_DEPLOYMENT are set and the live-data tools land (PLAN.md), this endpoint will query CAPs/Risks/Audits and answer with citations.`
    });

    return {
      status: 200,
      jsonBody: { answer: text, mock, tokens, mode: isMockMode() ? 'mock' : 'live' }
    };
  }
});
