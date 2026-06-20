import { useEffect } from 'react';
import { useFolderHierarchy } from '../context/useFolderHierarchy';

/**
 * Provisions the per-user system Study folder when Study mode mounts.
 * Idempotent at every layer (adapter unique index + find-or-create), so firing
 * once per mount is safe. Returns the current studyFolderId for consumers.
 */
export function useEnsureStudyFolder(): string | null {
  const { studyFolderId, hierarchy } = useFolderHierarchy();
  useEffect(() => {
    void hierarchy.ensureStudyFolder();
  }, [hierarchy]);
  return studyFolderId;
}
