// Fill the Michigan BCAL-4607 incident/accident report (fillable AcroForm) from
// incident data. Text fields only (v1); checkboxes/notifications left for staff.
// Left un-flattened so the form stays editable after download.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const TEMPLATE = fileURLToPath(new URL('../../templates/bcal-4607.pdf', import.meta.url));

const asDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { timeZone: 'UTC' }); };
const join = (...parts) => parts.filter((p) => p != null && String(p).trim() !== '').join(', ');

export async function fillBcal4607(d) {
  const doc = await PDFDocument.load(readFileSync(TEMPLATE));
  const form = doc.getForm();
  const set = (name, val) => { if (val == null || val === '') return; try { form.getTextField(name).setText(String(val)); } catch { /* field absent — ignore */ } };

  let hour = '', minutes = '';
  if (d.TimeofIncident) { const t = new Date(d.TimeofIncident); if (!isNaN(t)) { hour = String(t.getUTCHours()).padStart(2, '0'); minutes = String(t.getUTCMinutes()).padStart(2, '0'); } }

  set('Name of FacilityHome', d.facilityName);
  set('Facility Address', d.facilityAddr);
  set('CityStateZip Code', join(d.facilityCity, d.facilityState, d.facilityZip));
  set('Facility Phone', d.facilityPhone);
  set('Phone', d.facilityPhone);
  set('License Number', d.licenseNumber);
  set('Date of Incident', asDate(d.DateofIncident));
  set('Hour', hour);
  set('Minutes', minutes);
  set('Name of Person Directly Involved', join(d.FirstName, d.LastName).replace(',', ' '));
  set('Person Directly Involved Address', join(d.clientAddr, d.clientCity, d.clientState, d.clientZip));
  set('Location of Incident Kitchen Yard etc', d.placeOfIncident);
  set('Explain What Happened  Describe Injury if any Atta', d.whatHappened);
  set('Print Name and Title', d.reportedBy);
  set('Date', asDate(d.CreatedOn));

  return await doc.save();
}
