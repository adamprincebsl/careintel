// Shared Azure OpenAI client + completion helpers.
//
// Beacon Care Intelligence uses AOAI for four things (see PLAN.md):
//   1. NL chat / Q&A over the care data (tool-calling agent — chat.js).
//   2. AI narrative insights layered on reports (completeText).
//   3. AI-drafted reports (completeText / completeJson, longer outputs).
//   4. Predictive / risk-scoring signal narration (completeJson).
//
// For single-shot completions use the helpers here. The multi-turn tool-calling
// agent (chat.js) builds its own client because it streams + uses tool calls.
//
// Auth: managed identity via DefaultAzureCredential against the AOAI resource's
// "Cognitive Services OpenAI User" role assignment (provisioned in Bicep).
//
// Mock mode: when AOAI_ENDPOINT or AOAI_DEPLOYMENT is unset (Bicep ran with the
// AOAI params empty, or you're working locally without AOAI), the helpers
// return a deterministic mock instead of throwing — the whole app runs locally
// with no AOAI provisioning. This is the default dev experience.

import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureOpenAI } from 'openai';

let _client = null;
let _mockMode = null;

export function isMockMode() {
  if (_mockMode !== null) return _mockMode;
  _mockMode = !process.env.AOAI_ENDPOINT || !process.env.AOAI_DEPLOYMENT;
  return _mockMode;
}

export function client() {
  if (_client) return _client;
  if (isMockMode()) return null;
  const tokenProvider = getBearerTokenProvider(
    new DefaultAzureCredential(),
    'https://cognitiveservices.azure.com/.default'
  );
  _client = new AzureOpenAI({
    endpoint: process.env.AOAI_ENDPOINT,
    apiVersion: '2024-10-21',
    azureADTokenProvider: tokenProvider,
    deployment: process.env.AOAI_DEPLOYMENT
  });
  return _client;
}

/**
 * Plain-text completion. Returns the model's reply as a string.
 * @returns {Promise<{ text: string, mock: boolean, tokens: number }>}
 */
export async function completeText(opts) {
  const { system, user, maxTokens = 600, temperature = 0.2, mockFallback = '[MOCK] AOAI not provisioned — narrative unavailable in local/mock mode.' } = opts;
  if (isMockMode()) return { text: mockFallback, mock: true, tokens: 0 };

  const c = client();
  const res = await c.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user }
    ],
    max_tokens: maxTokens,
    temperature
  });
  return {
    text: res.choices?.[0]?.message?.content?.trim() || '',
    mock: false,
    tokens: res.usage?.total_tokens || 0
  };
}

/**
 * JSON-mode completion — instructs the model to reply with valid JSON.
 * Returns the parsed object. Throws 502 if the response isn't valid JSON.
 * @returns {Promise<{ data: object, mock: boolean, tokens: number }>}
 */
export async function completeJson(opts) {
  const { system, user, maxTokens = 800, temperature = 0.1, mockResponse = {} } = opts;
  if (isMockMode()) return { data: mockResponse, mock: true, tokens: 0 };

  const c = client();
  const res = await c.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user }
    ],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    temperature
  });
  const raw = res.choices?.[0]?.message?.content || '{}';
  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    const err = new Error(`AOAI JSON parse failed: ${e.message}`);
    err.statusCode = 502;
    throw err;
  }
  return { data, mock: false, tokens: res.usage?.total_tokens || 0 };
}
