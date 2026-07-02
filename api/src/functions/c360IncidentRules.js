// Incident rules engine — admin-editable rules (app Cosmos) compiled to safe,
// parameterized SQL over read-only c360. Evaluate = run enabled rules to flag incidents.
//   GET    /api/c360/incidents/rules            list rules (+ catalog)   (report.view)
//   POST   /api/c360/incidents/rules            create rule              (admin.manage)
//   PUT    /api/c360/incidents/rules/{id}       update rule              (admin.manage)
//   DELETE /api/c360/incidents/rules/{id}       delete rule             (admin.manage)
//   GET    /api/c360/incidents/rules/evaluate   run enabled rules -> flags (report.view)
import { app } from '@azure/functions';
import { randomUUID } from 'node:crypto';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { RULE_CONDITIONS, evaluateRule } from '../lib/incidentViews.js';

const PK = 'incidentRule';
const PRIORITIES = ['info', 'warning', 'critical'];
const rulesRepo = () => repo('incidentRules');
const listRules = () => rulesRepo().list({ query: 'SELECT * FROM c WHERE c.pk = @pk ORDER BY c.createdOn DESC', parameters: [{ name: '@pk', value: PK }] });
const cleanConditions = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((c) => c && RULE_CONDITIONS[c.type])
  .map((c) => ({ type: c.type, value: c.value ?? null }));

app.http('incidentRulesList', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/rules',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try { return { status: 200, jsonBody: { rules: await listRules(), catalog: RULE_CONDITIONS } }; }
    catch (err) { context.warn(`rules list failed: ${err.message}`); return { status: 502, jsonBody: { error: 'rules unavailable', detail: err.message } }; }
  }
});

app.http('incidentRuleCreate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'c360/incidents/rules',
  handler: async (request) => {
    const { principal } = await authorize(request, 'admin.manage');
    const b = await request.json().catch(() => ({}));
    if (!b.name || !String(b.name).trim()) return { status: 400, jsonBody: { error: 'name required' } };
    const now = new Date().toISOString();
    const doc = {
      id: randomUUID(), pk: PK, name: String(b.name).trim(),
      enabled: b.enabled !== false, priority: PRIORITIES.includes(b.priority) ? b.priority : 'warning',
      message: b.message || null, conditions: cleanConditions(b.conditions),
      createdBy: (principal && (principal.userDetails || principal.email)) || 'unknown', createdOn: now, updatedOn: now
    };
    return { status: 201, jsonBody: await rulesRepo().upsert(doc) };
  }
});

app.http('incidentRuleUpdate', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'c360/incidents/rules/{id}',
  handler: async (request) => {
    await authorize(request, 'admin.manage');
    const existing = await rulesRepo().get(request.params.id, PK);
    if (!existing) return { status: 404, jsonBody: { error: 'rule not found' } };
    const b = await request.json().catch(() => ({}));
    const merged = {
      ...existing,
      name: b.name !== undefined ? String(b.name).trim() : existing.name,
      enabled: b.enabled !== undefined ? !!b.enabled : existing.enabled,
      priority: PRIORITIES.includes(b.priority) ? b.priority : existing.priority,
      message: b.message !== undefined ? b.message : existing.message,
      conditions: b.conditions !== undefined ? cleanConditions(b.conditions) : existing.conditions,
      updatedOn: new Date().toISOString()
    };
    return { status: 200, jsonBody: await rulesRepo().upsert(merged) };
  }
});

app.http('incidentRuleDelete', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'c360/incidents/rules/{id}',
  handler: async (request) => {
    await authorize(request, 'admin.manage');
    await rulesRepo().delete(request.params.id, PK);
    return { status: 200, jsonBody: { ok: true } };
  }
});

app.http('incidentRulesEvaluate', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/rules/evaluate',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    let rules = [];
    try { rules = (await listRules()).filter((r) => r.enabled); }
    catch (err) { context.warn(`rules load failed: ${err.message}`); return { status: 502, jsonBody: { error: 'rules unavailable', detail: err.message } }; }
    const results = [];
    for (const rule of rules) {
      try { const { matchCount, matches } = await evaluateRule(rule); results.push({ id: rule.id, name: rule.name, priority: rule.priority, message: rule.message, matchCount, matches }); }
      catch (err) { results.push({ id: rule.id, name: rule.name, priority: rule.priority, error: err.message, matchCount: 0, matches: [] }); }
    }
    results.sort((a, b) => (b.matchCount || 0) - (a.matchCount || 0));
    return { status: 200, jsonBody: { results } };
  }
});
