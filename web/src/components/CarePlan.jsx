// Client care-plan popout — ISP (goals → objectives → interventions) + BSP
// objectives + target behaviors. PLAN definitions by ClientID (per-shift
// responses aren't in c360 yet — see DATA_TEAM_ASKS #11-12).
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function CarePlan({ clientId }) {
  const { data, isFetching, error } = useQuery({
    queryKey: ['care-plan', clientId],
    queryFn: () => api.carePlan(clientId),
    enabled: !!clientId
  });

  if (isFetching) return <p className="text-sm text-ink-muted">Loading care plan…</p>;
  if (error) return <p className="text-sm text-danger">{String(error.message)}</p>;
  if (!data) return null;

  // Group the flat ISP rows by goal.
  const goals = {};
  (data.isp || []).forEach((r) => { (goals[r.Goal || '(no goal)'] ||= []).push(r); });
  const goalKeys = Object.keys(goals);

  return (
    <div className="space-y-5 text-sm">
      <p className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-ink-muted">
        Care-plan definitions (current ISP + BSP). Per-shift responses are not yet available in c360.
      </p>

      <section>
        <h3 className="mb-1.5 border-b border-border pb-1 text-sm font-semibold text-beacon">ISP — Goals / Objectives / Interventions</h3>
        {goalKeys.length === 0 && <p className="italic text-ink-muted/60">No ISP plan found.</p>}
        {goalKeys.map((goal) => (
          <div key={goal} className="mb-3">
            <div className="font-medium">{goal}</div>
            <ul className="ml-4 mt-1 list-disc space-y-1">
              {goals[goal].map((r, i) => (
                <li key={i}>
                  <span className="font-medium">{r.Objective || '—'}</span>
                  {r.InterventionMethod ? <span className="text-ink-muted"> — {r.InterventionMethod}</span> : null}
                  {r.Frequency ? <span className="text-ink-muted"> ({r.Frequency})</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-1.5 border-b border-border pb-1 text-sm font-semibold text-beacon">BSP Objectives</h3>
        {(!data.bspObjectives || !data.bspObjectives.length) && <p className="italic text-ink-muted/60">No BSP objectives.</p>}
        {(data.bspObjectives || []).map((o, i) => (
          <div key={i} className="mb-2">
            <div className="font-medium">{o.OutcomePhrase || o.OutcomeStatement || '—'}</div>
            {o.OutcomeStrategy ? <div className="text-ink-muted">{o.OutcomeStrategy}</div> : null}
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-1.5 border-b border-border pb-1 text-sm font-semibold text-beacon">Target Behaviors</h3>
        {(!data.targetBehaviors || !data.targetBehaviors.length) && <p className="italic text-ink-muted/60">No target behaviors.</p>}
        {(data.targetBehaviors || []).map((b, i) => (
          <div key={i} className="mb-2">
            <div className="font-medium">{b.TargetBehavior || '—'}</div>
            {b.Function ? <div className="text-ink-muted">Function: {b.Function}</div> : null}
            {b.Definition ? <div className="whitespace-pre-wrap text-ink-muted">{b.Definition}</div> : null}
          </div>
        ))}
      </section>
    </div>
  );
}
