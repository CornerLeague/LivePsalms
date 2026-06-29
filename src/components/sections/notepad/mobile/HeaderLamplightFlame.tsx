import { Flame } from 'lucide-react';

export interface HeaderLamplightFlameProps {
  onOpenLamplight?: () => void;
  lamplightHasConnections?: boolean;
}

export function HeaderLamplightFlame({ onOpenLamplight, lamplightHasConnections }: HeaderLamplightFlameProps) {
  return (
    <button
      aria-label="Lamplight"
      onClick={onOpenLamplight}
      className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
      style={{ color: '#b8843a' }}
    >
      <Flame size={18} />
      {lamplightHasConnections && (
        <span
          data-testid="lamplight-dot"
          style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#b8843a' }}
        />
      )}
    </button>
  );
}
