/**
 * Downloaded attachments are streamed into the extension's origin-private file
 * system (OPFS) until the user saves the export. Streaming keeps memory flat,
 * and OPFS needs no permission prompt, so interrupted jobs can resume.
 */

const ROOT_DIR = 'exports';

async function rootDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function jobDir(jobId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (await rootDir()).getDirectoryHandle(jobId, { create });
  } catch (error) {
    if (!create && error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

/**
 * Streams `body` into the job's cache under `name`. Returns the number of
 * bytes written. On failure or abort the partial file is removed.
 */
export async function writeCacheFile(
  jobId: string,
  name: string,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<number> {
  const dir = await jobDir(jobId, true);
  const handle = await dir!.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  try {
    await body.pipeThrough(counter, { signal }).pipeTo(writable, { signal });
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await dir!.removeEntry(name).catch(() => undefined);
    throw error;
  }
  return bytes;
}

export async function getCacheFile(jobId: string, name: string): Promise<File | null> {
  const dir = await jobDir(jobId, false);
  if (!dir) return null;
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export async function deleteJobFiles(jobId: string): Promise<void> {
  if (!navigator.storage?.getDirectory) return;
  const root = await rootDir();
  await root.removeEntry(jobId, { recursive: true }).catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  });
}

export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return {};
  }
}
