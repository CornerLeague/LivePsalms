// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FolderHierarchy } from '../collection/folder-hierarchy';
import { FakeStorageAdapter } from '../collection/fake-storage-adapter';
import { FolderHierarchyContext } from '../context/useFolderHierarchy';
import { useEnsureStudyFolder } from './useEnsureStudyFolder';

describe('useEnsureStudyFolder', () => {
  let hierarchy: FolderHierarchy;

  beforeEach(() => {
    hierarchy = new FolderHierarchy(new FakeStorageAdapter());
  });

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <FolderHierarchyContext.Provider value={hierarchy}>
        {children}
      </FolderHierarchyContext.Provider>
    );
  }

  it('provisions a Study folder on mount and returns its id', async () => {
    const { result } = renderHook(() => useEnsureStudyFolder(), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(hierarchy.getSnapshot().folders.filter((f) => f.kind === 'study')).toHaveLength(1);
    expect(result.current).toBe(hierarchy.getSnapshot().studyFolderId);
  });
});
