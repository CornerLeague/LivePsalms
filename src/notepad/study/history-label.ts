// Pure label helpers for the Study conversation-history list.
import { bookByAbbrev } from '@/notepad/bible/bible-books';

// "just now" / "N minute(s)/hour(s)/day(s) ago", driven by an injectable `now`.
export function formatRelativeTime(iso: string, now: number): string {
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

// "Romans 8 · 2 days ago" — book abbrev resolved to its display name.
export function formatHistoryLabel(book: string, chapter: number, updatedAtIso: string, now: number): string {
  const name = bookByAbbrev(book)?.name ?? book;
  return `${name} ${chapter} · ${formatRelativeTime(updatedAtIso, now)}`;
}
