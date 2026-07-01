import '../scan/scan.css';
import { useScanCapture } from '../scan/useScanCapture';
import type { TranscriptionResult } from '../scan/types';

interface Props {
  userId: string;
  onResult: (result: TranscriptionResult) => void;
  onCancel: () => void;
}

export function ScanCapturePanel({ userId, onResult, onCancel }: Props) {
  const scan = useScanCapture({ userId, onResult, onCancel });
  const { phase, error } = scan.state;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void scan.submitFile(file);
  }

  return (
    <div className="scan-capture" role="dialog" aria-label="Scan handwritten note">
      <input
        ref={scan.fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFile}
      />

      {phase === 'idle' && (
        <div className="scan-capture__choices">
          {/* One capture path: the file input (capture="environment") opens the
              camera on mobile and the picker on desktop — reliable on both, unlike
              the getUserMedia flow it replaced. */}
          <button onClick={() => scan.fileRef.current?.click()}>Take photo</button>
          <button onClick={scan.cancel}>Cancel</button>
        </div>
      )}

      {(phase === 'cleaning' || phase === 'transcribing') && (
        <div className="scan-capture__busy" aria-live="polite">
          <span>{phase === 'cleaning' ? 'Cleaning up image' : 'Reading your handwriting'}</span>
          <span className="scan-capture__dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </div>
      )}

      {phase === 'error' && (
        <div className="scan-capture__error" role="alert">
          <p>{error}</p>
          <button onClick={scan.reset}>Try again</button>
          <button onClick={scan.cancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
