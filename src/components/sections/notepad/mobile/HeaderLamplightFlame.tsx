import { Flame } from 'lucide-react';

export interface HeaderLamplightFlameProps {
  onOpenLamplight?: () => void;
  lamplightHasConnections?: boolean;
  /** Show the gold arrival dot when a new reflection has arrived and is unopened (Task 18). */
  lamplightHasArrived?: boolean;
}

export function HeaderLamplightFlame({
  onOpenLamplight,
  lamplightHasConnections,
  lamplightHasArrived,
}: HeaderLamplightFlameProps) {
  return (
    <button
      aria-label="Lamplight"
      onClick={onOpenLamplight}
      className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
      style={{ color: '#b8843a' }}
    >
      <Flame size={18} />
      {/* Arrival wins when both would show — gold (#C49A78) is the arrival signal (Task 18),
          distinct from the amber (#b8843a) connections dot. */}
      {lamplightHasArrived ? (
        <span
          data-testid="lamplight-arrival-dot"
          style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#C49A78' }}
        />
      ) : (
        lamplightHasConnections && (
          <span
            data-testid="lamplight-dot"
            style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#b8843a' }}
          />
        )
      )}
    </button>
  );
}
