// Formatted note view — renders a residential note object as a clinical form
// (grouped sections, friendly labels, blanks marked) instead of raw JSON.
// Works for both the identified (/full) and de-identified (/note/{id}) shapes;
// fields absent from the payload are simply skipped.

const LABELS = {
  ClientId: 'Client ID', ClientInitials: 'Client', FirstName: 'First name', LastName: 'Last name',
  ClientDOB: 'Date of birth', ClientGender: 'Gender',
  ClientFirstName: 'First name', ClientLastName: 'Last name', ClientBirthDate: 'Date of birth', ClientGenderText: 'Gender',
  ServiceName: 'Service', Program: 'Program (id)', Location: 'Location (id)',
  ProgramName: 'Program', ProgramType: 'Program type', LocationName: 'Location', State: 'State',
  ServiceDate: 'Service date',
  ServiceStartTime: 'Start', ServiceEndTime: 'End', Duration: 'Duration (min)', InRatio: 'In ratio', IsAbsent: 'Client absent',
  NoteState: 'Note state', SubmissionStatusLabel: 'Submission status', ChartType: 'Chart type',
  ChartedByName: 'Charted by', CreatedBy_: 'Charted by', CreatedOn: 'Charted on',
  LastModifiedByName: 'Last modified by', LastModifiedBy_: 'Last modified by', LastModifiedOn: 'Last modified on',
  CommunityServicesOffered: 'Community services offered', CommunityActivitesOffered_: 'Community services offered',
  Library: 'Library', Park: 'Park', Shopping: 'Shopping', SpecialEvent: 'Special event',
  SportsExercise: 'Sports / exercise', Walk: 'Walk', WorshipService: 'Worship', Other: 'Other',
  CommunityActivities: 'Community activities (notes)',
  ActivitiesofDailyLiving: 'ADLs addressed', ResponsetoADL: 'ADL response', Appointment: 'Appointment', AppointmentResponse: 'Appointment response',
  InHomeActivities: 'In-home activities', 'InHomeActivities_': 'In-home activities', InHomeActivityResponse: 'In-home response',
  Games: 'Games', Movie: 'Movie', CookingBaking: 'Cooking / baking',
  OutdoorActivities: 'Outdoor', OtherInHomeActivity: 'Other in-home', OtherInHomeActivityDetail: 'Other in-home detail',
  DetailedSummaryNote: 'Summary note', IndividualSurveyResponse: 'Survey response',
  CarveOut: 'Carve-out', CarveStartTime: 'Carve start', CarveEndTime: 'Carve end', CarveOutReason: 'Carve reason', OtherCarveReasonDetail: 'Carve reason detail',
  CarveOut1: 'Carve-out 2', CarveStartTime1: 'Carve 2 start', CarveEndTime1: 'Carve 2 end', CarveOutReason1: 'Carve 2 reason', OtherCarveReasonDetail1: 'Carve 2 detail',
  CarveOut2: 'Carve-out 3', CarveStartTime2: 'Carve 3 start', CarveEndTime2: 'Carve 3 end', CarveOutReason2: 'Carve 3 reason', OtherCarveReasonDetail2: 'Carve 3 detail'
};

const SECTIONS = [
  { title: 'Client', keys: ['ClientInitials', 'ClientId', 'ClientFirstName', 'ClientLastName', 'ClientBirthDate', 'ClientGenderText'] },
  { title: 'Service', keys: ['ServiceName', 'ProgramName', 'ProgramType', 'LocationName', 'State', 'ServiceDate', 'ServiceStartTime', 'ServiceEndTime', 'Duration', 'InRatio', 'IsAbsent'] },
  { title: 'Status', keys: ['NoteState', 'SubmissionStatusLabel', 'ChartType'] },
  { title: 'Community Engagement', keys: ['CommunityServicesOffered', 'CommunityActivitesOffered_', 'Library', 'Park', 'Shopping', 'SpecialEvent', 'SportsExercise', 'Walk', 'WorshipService', 'Other', 'CommunityActivities'] },
  { title: 'Day Living (ADLs)', keys: ['ActivitiesofDailyLiving', 'ResponsetoADL', 'Appointment', 'AppointmentResponse'] },
  { title: 'Home Activities', keys: ['InHomeActivities', 'Games', 'Movie', 'CookingBaking', 'OutdoorActivities', 'OtherInHomeActivity', 'OtherInHomeActivityDetail', 'InHomeActivityResponse'] },
  { title: 'Carve-out', onlyIfPresent: true, keys: ['CarveOut', 'CarveStartTime', 'CarveEndTime', 'CarveOutReason', 'OtherCarveReasonDetail', 'CarveOut1', 'CarveStartTime1', 'CarveEndTime1', 'CarveOutReason1', 'OtherCarveReasonDetail1', 'CarveOut2', 'CarveStartTime2', 'CarveEndTime2', 'CarveOutReason2', 'OtherCarveReasonDetail2'] },
  { title: 'Summary', keys: ['DetailedSummaryNote', 'IndividualSurveyResponse'] },
  { title: 'Authorship', keys: ['ChartedByName', 'CreatedOn', 'LastModifiedByName', 'LastModifiedOn'] }
];

const LONG = new Set(['DetailedSummaryNote', 'CommunityActivities', 'ResponsetoADL', 'AppointmentResponse', 'OtherInHomeActivityDetail', 'InHomeActivityResponse', 'IndividualSurveyResponse', 'OtherCarveReasonDetail', 'OtherCarveReasonDetail1', 'OtherCarveReasonDetail2']);

function fmt(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) {
    const d = new Date(v);
    return v.includes('00:00:00') ? d.toLocaleDateString() : d.toLocaleString();
  }
  return String(v);
}

function Field({ k, v }) {
  const val = fmt(v);
  const long = LONG.has(k);
  return (
    <div className={long ? 'col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{LABELS[k] || k}</dt>
      <dd className={`text-sm ${val == null ? 'italic text-ink-muted/60' : ''} ${long ? 'mt-0.5 whitespace-pre-wrap rounded bg-surface p-2' : ''}`}>
        {val == null ? 'Not documented' : val}
      </dd>
    </div>
  );
}

export default function NoteForm({ note, phi }) {
  if (!note) return null;
  const used = new Set();
  const sections = SECTIONS.map((s) => {
    const inNote = s.keys.filter((k) => k in note);
    inNote.forEach((k) => used.add(k)); // claim all keys so blanks don't leak to "Other"
    // onlyIfPresent sections (e.g. Carve-out) render only their non-blank fields, and disappear if none.
    const present = s.onlyIfPresent ? inNote.filter((k) => fmt(note[k]) != null) : inNote;
    return { ...s, present };
  }).filter((s) => s.present.length);
  const other = Object.keys(note).filter((k) => !used.has(k) && k !== 'NoteId');

  return (
    <div className="space-y-4">
      {phi && (
        <div className="rounded border border-gold bg-gold-tint px-3 py-1.5 text-xs text-gold-dark">
          Identified clinical note (PHI) — access is audited.
        </div>
      )}
      {sections.map((s) => (
        <section key={s.title}>
          <h3 className="mb-1.5 border-b border-border pb-1 text-sm font-semibold text-beacon">{s.title}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {s.present.map((k) => <Field key={k} k={k} v={note[k]} />)}
          </dl>
        </section>
      ))}
      {other.length > 0 && (
        <details className="rounded border border-border p-2">
          <summary className="cursor-pointer text-xs font-medium text-ink-muted">Other documented fields ({other.length})</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {other.map((k) => <Field key={k} k={k} v={note[k]} />)}
          </dl>
        </details>
      )}
    </div>
  );
}
