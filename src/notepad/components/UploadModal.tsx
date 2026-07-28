import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, FileText, X } from 'lucide-react';
import { useFolderHierarchy } from '../context/useFolderHierarchy';
import { useNotepadActions } from '../context/useNotepadActions';
import { filesToNotes } from '../import/document-importer';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { ScanCapturePanel } from './ScanCapturePanel';
import { TranscriptionReview } from './TranscriptionReview';
import type { TranscriptionResult } from '../scan/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ScanStage = null | 'capture' | { review: TranscriptionResult };

// ---------------------------------------------------------------------------
// Format file size
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// UploadModal component
// ---------------------------------------------------------------------------

export function UploadModal({ open, onOpenChange }: UploadModalProps) {
  const { folders } = useFolderHierarchy();
  const actions = useNotepadActions();
  const importNotes = actions.importNotes;
  const { user } = useAuthSession();

  const [files, setFiles] = useState<File[]>([]);
  const [folderId, setFolderId] = useState<string>('root');
  const [autoDetectVerses, setAutoDetectVerses] = useState(true);
  const [autoCreateLinks, setAutoCreateLinks] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scan, setScan] = useState<ScanStage>(null);

  // Fix 3: reset scan state when the modal closes so reopening never shows a stale stage
  useEffect(() => { if (!open) setScan(null); }, [open]);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...accepted.filter((f) => !existing.has(f.name))];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/markdown': ['.md'],
      'text/plain': ['.txt'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    noClick: false,
    noKeyboard: false,
  });

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const handleUpload = async () => {
    if (files.length === 0 || uploading) return;
    setUploading(true);

    try {
      const notes = await filesToNotes(files, {
        folderId,
        autoDetectVerses,
        autoCreateLinks,
      });
      await importNotes(notes);

      setFiles([]);
      onOpenChange(false);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    if (uploading) return;
    setFiles([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ fontFamily: 'Outfit, sans-serif', maxWidth: 520 }}
        className="gap-0"
      >
        <DialogHeader className="pb-4">
          <DialogTitle
            style={{
              color: 'var(--deep-umber)',
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: '1.25rem',
              fontWeight: 600,
            }}
          >
            Upload Notes
          </DialogTitle>
        </DialogHeader>

        {scan === null ? (
          <>
            <div className="space-y-4 py-2">
              {/* Drop zone */}
              <div
                {...getRootProps()}
                className="flex flex-col items-center justify-center gap-2 rounded-lg px-6 py-8 cursor-pointer transition-colors"
                style={{
                  border: `2px dashed ${isDragActive ? 'var(--deep-umber)' : 'var(--pale-stone)'}`,
                  background: isDragActive ? 'rgba(188, 179, 163, 0.1)' : 'transparent',
                }}
              >
                <input {...getInputProps()} />
                <Upload
                  className="w-8 h-8"
                  style={{ color: isDragActive ? 'var(--deep-umber)' : 'var(--silica)' }}
                />
                <p
                  className="text-[13px] text-center"
                  style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                >
                  {isDragActive ? 'Drop files here' : 'Drag & drop files, or click to browse'}
                </p>
                <p
                  className="text-[11px]"
                  style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                >
                  Supports .md, .txt, .pdf, .docx
                </p>
              </div>

              {/* Scan handwritten note entry point */}
              {user && (
                <button
                  type="button"
                  onClick={() => setScan('capture')}
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[12px] font-medium transition-opacity hover:opacity-80"
                  style={{
                    border: '1px solid var(--pale-stone)',
                    color: 'var(--deep-umber)',
                    fontFamily: 'Outfit, sans-serif',
                    background: 'transparent',
                  }}
                >
                  Scan handwritten note
                </button>
              )}

              {/* Options */}
              <div className="space-y-2.5">
                <label
                  className="text-[10px] font-medium tracking-[0.15em]"
                  style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                >
                  OPTIONS
                </label>

                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id="auto-detect"
                    checked={autoDetectVerses}
                    onCheckedChange={(checked) => setAutoDetectVerses(!!checked)}
                  />
                  <label
                    htmlFor="auto-detect"
                    className="text-[12px] cursor-pointer select-none"
                    style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                  >
                    Auto-detect verse references (add as tags)
                  </label>
                </div>

                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id="auto-links"
                    checked={autoCreateLinks}
                    onCheckedChange={(checked) => setAutoCreateLinks(!!checked)}
                  />
                  <label
                    htmlFor="auto-links"
                    className="text-[12px] cursor-pointer select-none"
                    style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                  >
                    Auto-create links between notes sharing verse refs
                  </label>
                </div>
              </div>

              {/* Folder destination */}
              <div className="space-y-1.5">
                <label
                  className="text-[10px] font-medium tracking-[0.15em]"
                  style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                >
                  DESTINATION FOLDER
                </label>
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger
                    style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--deep-umber)' }}
                  >
                    <SelectValue placeholder="Select folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* `root` is the stored folderId for an unfiled note;
                        "Main" is how we say that to the user. */}
                    <SelectItem value="root">Main</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Selected files list */}
              {files.length > 0 && (
                <div className="space-y-1.5">
                  <label
                    className="text-[10px] font-medium tracking-[0.15em]"
                    style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                  >
                    SELECTED FILES ({files.length})
                  </label>
                  <div
                    className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid var(--pale-stone)' }}
                  >
                    {files.map((file, idx) => (
                      <div
                        key={file.name}
                        className="flex items-center gap-2.5 px-3 py-2"
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--pale-stone)' : 'none',
                          fontFamily: 'Outfit, sans-serif',
                        }}
                      >
                        <FileText
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: 'var(--silica)' }}
                        />
                        <span
                          className="text-[12px] flex-1 truncate min-w-0"
                          style={{ color: 'var(--deep-umber)' }}
                        >
                          {file.name}
                        </span>
                        <span
                          className="text-[11px] shrink-0"
                          style={{ color: 'var(--silica)' }}
                        >
                          {formatBytes(file.size)}
                        </span>
                        <button
                          onClick={() => removeFile(file.name)}
                          className="shrink-0 hover:opacity-70 transition-opacity"
                          style={{ color: 'var(--silica)' }}
                          type="button"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-4">
              <button
                onClick={handleCancel}
                disabled={uploading}
                className="px-3 py-1.5 rounded text-[12px] disabled:opacity-50"
                style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={files.length === 0 || uploading}
                className="px-4 py-1.5 rounded text-[12px] font-medium disabled:opacity-50 transition-opacity"
                style={{
                  background: 'var(--deep-umber)',
                  color: 'var(--plaster)',
                  fontFamily: 'Outfit, sans-serif',
                }}
                type="button"
              >
                {uploading ? 'Processing…' : 'Upload & Process'}
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* Scan flow — replaces the normal dialog content when active */}
            {scan === 'capture' && user && (
              <ScanCapturePanel
                userId={user.id}
                onResult={(result) => setScan({ review: result })}
                onCancel={() => setScan(null)}
              />
            )}
            {scan !== 'capture' && (
              <TranscriptionReview
                result={(scan as { review: TranscriptionResult }).review}
                folderId={folderId}
                persistNotes={(notes) => actions.importNotes(notes)}
                onSaved={() => {
                  setScan(null);
                  onOpenChange(false);
                }}
                onDiscarded={() => setScan(null)}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
