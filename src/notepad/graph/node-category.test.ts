import { describe, it, expect } from 'vitest';
import {
  graphNodeCategory,
  SCRIPTURE_CATEGORY,
  UNFILED_CATEGORY,
} from './node-category';

describe('graphNodeCategory', () => {
  it('maps scripture verse nodes to the scripture category', () => {
    expect(graphNodeCategory({ type: 'scripture', folderId: undefined })).toBe(SCRIPTURE_CATEGORY);
    // Scripture wins even if a folderId somehow rode along.
    expect(graphNodeCategory({ type: 'scripture', folderId: 'f1' })).toBe(SCRIPTURE_CATEGORY);
  });

  it('maps a note in a folder to that folder id', () => {
    expect(graphNodeCategory({ type: 'devotion', folderId: 'f1' })).toBe('f1');
    expect(graphNodeCategory({ type: 'sermon', folderId: 'abc-123' })).toBe('abc-123');
  });

  it('maps root / missing folder notes to the unfiled category', () => {
    expect(graphNodeCategory({ type: 'general', folderId: 'root' })).toBe(UNFILED_CATEGORY);
    expect(graphNodeCategory({ type: 'general', folderId: undefined })).toBe(UNFILED_CATEGORY);
    expect(graphNodeCategory({ type: 'theme' })).toBe(UNFILED_CATEGORY);
  });
});
