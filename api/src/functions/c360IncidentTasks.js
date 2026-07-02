// Incident workflow — manual tasks in the app's Cosmos (c360 is read-only), plus
// auto-derived sub-form status + compliance signals from c360.
//   GET    /api/c360/incidents/{id}/tasks           list tasks + derived status   (report.view)
//   POST   /api/c360/incidents/{id}/tasks           create task                    (incident.manage)
//   PUT    /api/c360/incidents/{id}/tasks/{taskId}  update task                    (incident.manage)
//   DELETE /api/c360/incidents/{id}/tasks/{taskId}  delete task                    (incident.manage)
//   GET    /api/c360/incidents/compliance           needs-attention signals        (report.view)
import { app } from '@azure/functions';
import { randomUUID } from 'node:crypto';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { getIncidentWorkflowStatus, incidentComplianceSignals } from '../lib/incidentViews.js';

const LANES = ['alerting', 'rootCause', 'medical', 'clinical', 'operational', 'correctiveAction', 'qa'];
const STATUSES = ['open', 'inProgress', 'done'];
const pkFor = (incidentId) => `incident:${incidentId}`;
const actorOf = (p) => (p && (p.userDetails || p.email || p.userId)) || 'unknown';
const tasksRepo = () => repo('incidentTasks');

app.http('incidentTasksList', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/{id}/tasks',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    const id = request.params.id;
    try {
      const tasks = await tasksRepo().list({ query: 'SELECT * FROM c WHERE c.pk = @pk ORDER BY c.createdOn DESC', parameters: [{ name: '@pk', value: pkFor(id) }] });
      let derived = {};
      try { derived = await getIncidentWorkflowStatus(id); } catch (err) { context.warn(`workflow status failed: ${err.message}`); }
      return { status: 200, jsonBody: { tasks, derived, lanes: LANES } };
    } catch (err) { context.warn(`tasks list failed: ${err.message}`); return { status: 502, jsonBody: { error: 'tasks unavailable', detail: err.message } }; }
  }
});

app.http('incidentTaskCreate', {
  methods: ['POST'], authLevel: 'anonymous', route: 'c360/incidents/{id}/tasks',
  handler: async (request) => {
    const { principal } = await authorize(request, 'incident.manage');
    const id = request.params.id;
    const body = await request.json().catch(() => ({}));
    if (!LANES.includes(body.lane)) return { status: 400, jsonBody: { error: 'invalid lane' } };
    if (!body.title || !String(body.title).trim()) return { status: 400, jsonBody: { error: 'title required' } };
    const now = new Date().toISOString();
    const doc = {
      id: randomUUID(), pk: pkFor(id), incidentId: String(id), lane: body.lane,
      title: String(body.title).trim(), status: STATUSES.includes(body.status) ? body.status : 'open',
      assignee: body.assignee || null, dueDate: body.dueDate || null, notes: body.notes || null,
      createdBy: actorOf(principal), createdOn: now, updatedOn: now
    };
    const saved = await tasksRepo().upsert(doc);
    return { status: 201, jsonBody: saved };
  }
});

app.http('incidentTaskUpdate', {
  methods: ['PUT'], authLevel: 'anonymous', route: 'c360/incidents/{id}/tasks/{taskId}',
  handler: async (request) => {
    const { principal } = await authorize(request, 'incident.manage');
    const { id, taskId } = request.params;
    const existing = await tasksRepo().get(taskId, pkFor(id));
    if (!existing) return { status: 404, jsonBody: { error: 'task not found' } };
    const body = await request.json().catch(() => ({}));
    const merged = {
      ...existing,
      title: body.title !== undefined ? String(body.title).trim() : existing.title,
      status: STATUSES.includes(body.status) ? body.status : existing.status,
      assignee: body.assignee !== undefined ? body.assignee : existing.assignee,
      dueDate: body.dueDate !== undefined ? body.dueDate : existing.dueDate,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      updatedBy: actorOf(principal), updatedOn: new Date().toISOString(),
      completedOn: body.status === 'done' && existing.status !== 'done' ? new Date().toISOString() : existing.completedOn || null
    };
    return { status: 200, jsonBody: await tasksRepo().upsert(merged) };
  }
});

app.http('incidentTaskDelete', {
  methods: ['DELETE'], authLevel: 'anonymous', route: 'c360/incidents/{id}/tasks/{taskId}',
  handler: async (request) => {
    await authorize(request, 'incident.manage');
    const { id, taskId } = request.params;
    await tasksRepo().delete(taskId, pkFor(id));
    return { status: 200, jsonBody: { ok: true } };
  }
});

app.http('incidentCompliance', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/compliance',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    const out = {};
    try { Object.assign(out, await incidentComplianceSignals()); } catch (err) { context.warn(`compliance signals failed: ${err.message}`); }
    try {
      const today = new Date().toISOString().slice(0, 10);
      out.overdueTasks = await tasksRepo().list({
        query: 'SELECT * FROM c WHERE c.status != @done AND IS_DEFINED(c.dueDate) AND c.dueDate != null AND c.dueDate < @today ORDER BY c.dueDate ASC',
        parameters: [{ name: '@done', value: 'done' }, { name: '@today', value: today }]
      });
    } catch (err) { context.warn(`overdue tasks failed: ${err.message}`); out.overdueTasks = []; }
    return { status: 200, jsonBody: out };
  }
});
