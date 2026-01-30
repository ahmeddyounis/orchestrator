import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IndexUpdater, IndexNotFoundError } from './updater';
import { IndexFile, saveIndexAtomic, loadIndex } from './store';
import { RepoScanner, RepoFileMeta } from '../scanner';
import { hashFile } from './hasher';
import path from 'node:path';

// Mock dependencies
vi.mock('./store', async () => {
  const original = await vi.importActual('./store');
  return {
    ...original,
    loadIndex: vi.fn(),
    saveIndexAtomic: vi.fn(),
  };
});

vi.mock('../scanner', () => {
  const RepoScanner = vi.fn();
  RepoScanner.prototype.scan = vi.fn();
  return { RepoScanner };
});
vi.mock('./hasher');

const mockedLoadIndex = vi.mocked(loadIndex);
const mockedSaveIndexAtomic = vi.mocked(saveIndexAtomic);
const mockedRepoScanner = vi.mocked(RepoScanner);
const mockedHashFile = vi.mocked(hashFile);

const REPO_ROOT = '/fake/repo';
const INDEX_PATH = path.join(REPO_ROOT, '.orchestrator', 'index.json');

describe('IndexUpdater', () => {
  let updater: IndexUpdater;
  let baseIndex: IndexFile;

  beforeEach(() => {
    vi.resetAllMocks();

    updater = new IndexUpdater(INDEX_PATH);

    baseIndex = {
      schemaVersion: 1,
      repoId: 'test-repo',
      repoRoot: REPO_ROOT,
      builtAt: Date.now() - 10000,
      updatedAt: Date.now() - 10000,
      files: [
        { path: 'file1.txt', sizeBytes: 10, mtimeMs: 1000, isText: true, sha256: 'abc' },
        { path: 'file2.txt', sizeBytes: 20, mtimeMs: 2000, isText: true, sha256: 'def' },
      ],
      stats: {
        fileCount: 2,
        textFileCount: 2,
        hashedCount: 2,
        byLanguage: { typescript: { count: 2, bytes: 30 } },
      },
    };

    // Setup default mocks
    mockedLoadIndex.mockReturnValue(JSON.parse(JSON.stringify(baseIndex)));
    mockedHashFile.mockResolvedValue('new-hash');
  });

  it('should throw IndexNotFoundError if index does not exist', async () => {
    mockedLoadIndex.mockReturnValue(null);
    await expect(updater.update(REPO_ROOT)).rejects.toThrow(IndexNotFoundError);
  });

  it('should detect an added file', async () => {
    const newFile: RepoFileMeta = {
      path: 'file3.txt',
      absPath: `${REPO_ROOT}/file3.txt`,
      sizeBytes: 30,
      mtimeMs: 3000,
      isText: true,
      ext: '.txt',
    };
    const currentFiles = [...baseIndex.files, newFile].map((f) => ({
      ...f,
      absPath: `${REPO_ROOT}/${f.path}`,
      ext: '.txt',
    }));

    vi.mocked(mockedRepoScanner.prototype.scan).mockResolvedValue({
      repoRoot: REPO_ROOT,
      files: currentFiles,
    });

    const result = await updater.update(REPO_ROOT);

    expect(result.added).toEqual(['file3.txt']);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.rehashedCount).toBe(1);

    expect(mockedSaveIndexAtomic).toHaveBeenCalledOnce();
    const savedIndex = mockedSaveIndexAtomic.mock.calls[0][1];
    expect(savedIndex.files).toHaveLength(3);
    expect(savedIndex.files.find((f) => f.path === 'file3.txt')).toBeDefined();
  });

  it('should detect a removed file', async () => {
    const currentFiles = [baseIndex.files[0]].map((f) => ({
      ...f,
      absPath: `${REPO_ROOT}/${f.path}`,
      ext: '.txt',
    }));
    vi.mocked(mockedRepoScanner.prototype.scan).mockResolvedValue({
      repoRoot: REPO_ROOT,
      files: currentFiles,
    });

    const result = await updater.update(REPO_ROOT);

    expect(result.added).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual(['file2.txt']);
    expect(result.rehashedCount).toBe(0);

    expect(mockedSaveIndexAtomic).toHaveBeenCalledOnce();
    const savedIndex = mockedSaveIndexAtomic.mock.calls[0][1];
    expect(savedIndex.files).toHaveLength(1);
    expect(savedIndex.files.find((f) => f.path === 'file2.txt')).toBeUndefined();
  });

  it('should detect a changed file (mtimeMs changed)', async () => {
    const changedFile: RepoFileMeta = {
      path: 'file1.txt',
      absPath: `${REPO_ROOT}/file1.txt`,
      sizeBytes: 10,
      mtimeMs: 1001,
      isText: true,
      ext: '.txt',
    };
    const currentFiles = [
      changedFile,
      { ...baseIndex.files[1], absPath: `${REPO_ROOT}/${baseIndex.files[1].path}`, ext: '.txt' },
    ];
    vi.mocked(mockedRepoScanner.prototype.scan).mockResolvedValue({
      repoRoot: REPO_ROOT,
      files: currentFiles,
    });

    const result = await updater.update(REPO_ROOT);

    expect(result.added).toEqual([]);
    expect(result.changed).toEqual(['file1.txt']);
    expect(result.removed).toEqual([]);
    expect(result.rehashedCount).toBe(1);

    expect(mockedHashFile).toHaveBeenCalledWith(path.join(REPO_ROOT, 'file1.txt'));
    expect(mockedSaveIndexAtomic).toHaveBeenCalledOnce();
    const savedIndex = mockedSaveIndexAtomic.mock.calls[0][1];
    const updatedRecord = savedIndex.files.find((f) => f.path === 'file1.txt');
    expect(updatedRecord?.sha256).toBe('new-hash');
    expect(updatedRecord?.mtimeMs).toBe(1001);
  });

  it('should detect a changed file (sizeBytes changed)', async () => {
    const changedFile: RepoFileMeta = {
      path: 'file1.txt',
      absPath: `${REPO_ROOT}/file1.txt`,
      sizeBytes: 11,
      mtimeMs: 1000,
      isText: true,
      ext: '.txt',
    };
    const currentFiles = [
      changedFile,
      { ...baseIndex.files[1], absPath: `${REPO_ROOT}/${baseIndex.files[1].path}`, ext: '.txt' },
    ];
    vi.mocked(mockedRepoScanner.prototype.scan).mockResolvedValue({
      repoRoot: REPO_ROOT,
      files: currentFiles,
    });

    const result = await updater.update(REPO_ROOT);

    expect(result.changed).toEqual(['file1.txt']);
    expect(result.rehashedCount).toBe(1);

    const savedIndex = mockedSaveIndexAtomic.mock.calls[0][1];
    const updatedRecord = savedIndex.files.find((f) => f.path === 'file1.txt');
    expect(updatedRecord?.sizeBytes).toBe(11);
  });

  it('should not rehash unchanged files', async () => {
    const currentFiles = baseIndex.files.map((f) => ({
      ...f,
      absPath: `${REPO_ROOT}/${f.path}`,
      ext: '.txt',
    }));
    vi.mocked(mockedRepoScanner.prototype.scan).mockResolvedValue({
      repoRoot: REPO_ROOT,
      files: currentFiles,
    });

    const result = await updater.update(REPO_ROOT);

    expect(result.added).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.rehashedCount).toBe(0);

    expect(mockedHashFile).not.toHaveBeenCalled();
    expect(mockedSaveIndexAtomic).toHaveBeenCalledOnce();
    const savedIndex = mockedSaveIndexAtomic.mock.calls[0][1];
    expect(savedIndex.files).toEqual(baseIndex.files);
  });

  
});