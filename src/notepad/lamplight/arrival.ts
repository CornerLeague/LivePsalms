import { ARRIVAL_HOUR_LOCAL } from './reflection-constants';

// A reflection covers `periodKey` (YYYY-MM). Its stone "arrives" — appears on the Path with a
// fresh seal — at ARRIVAL_HOUR_LOCAL on the FIRST day of the FOLLOWING month, in the reader's own
// timezone. Pure time math (no library); the existence of the artifact is the caller's concern.
export function hasArrived(now: Date, periodKey: string, timezone: string): boolean {
  const [y, m] = periodKey.split('-').map(Number);
  const arrivalYear = m === 12 ? y + 1 : y;   // December rolls into next January
  const arrivalMonth = m === 12 ? 1 : m + 1;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let localHour = get('hour');
  if (localHour === 24) localHour = 0; // some engines emit '24' for local midnight under hour12:false

  const nowTuple = [get('year'), get('month'), get('day'), localHour];
  const arrivalTuple = [arrivalYear, arrivalMonth, 1, ARRIVAL_HOUR_LOCAL];
  for (let i = 0; i < 4; i++) {
    if (nowTuple[i] > arrivalTuple[i]) return true;
    if (nowTuple[i] < arrivalTuple[i]) return false;
  }
  return true; // exactly equal → arrived
}
