import { configure, ZipWriter } from '@zip.js/zip.js';

/**
 * Destinations for a saved export. Text files are produced incrementally
 * (async iterables of string chunks) and binary files are streamed from the
 * cache, so nothing has to fit in memory at once.
 */
export interface OutputSink {
  readonly kind: 'folder' | 'zip' | 'memory';
  /** Display name of the destination (folder or file name). */
  readonly name: string;
  writeText(path: string, chunks: AsyncIterable<string>, signal?: AbortSignal): Promise<number>;
  writeBlob(path: string, blob: Blob, signal?: AbortSignal): Promise<number>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

const encoder = new TextEncoder();

export function textStream(chunks: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

function countingStream(onBytes: (bytes: number) => void): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      onBytes(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
}

/** Writes into a folder the user picked (File System Access API). */
export class DirectorySink implements OutputSink {
  readonly kind = 'folder' as const;
  private readonly dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();

  private constructor(
    private readonly root: FileSystemDirectoryHandle,
    readonly name: string,
  ) {}

  /** Creates `<parent>/<folderName>`, adding " (2)" etc. if it already exists. */
  static async create(parent: FileSystemDirectoryHandle, folderName: string): Promise<DirectorySink> {
    let name = folderName;
    for (let n = 2; await exists(parent, name); n++) name = `${folderName} (${n})`;
    const root = await parent.getDirectoryHandle(name, { create: true });
    return new DirectorySink(root, `${parent.name}/${name}`);
  }

  private dirFor(path: string): Promise<FileSystemDirectoryHandle> {
    const parts = path.split('/').slice(0, -1);
    let key = '';
    let current: Promise<FileSystemDirectoryHandle> = Promise.resolve(this.root);
    for (const part of parts) {
      key = key ? `${key}/${part}` : part;
      const cached = this.dirs.get(key);
      if (cached) {
        current = cached;
        continue;
      }
      const parent = current;
      current = parent.then((dir) => dir.getDirectoryHandle(part, { create: true }));
      this.dirs.set(key, current);
    }
    return current;
  }

  private async open(path: string): Promise<FileSystemWritableFileStream> {
    const dir = await this.dirFor(path);
    const file = await dir.getFileHandle(path.slice(path.lastIndexOf('/') + 1), { create: true });
    return file.createWritable();
  }

  async writeText(path: string, chunks: AsyncIterable<string>, signal?: AbortSignal): Promise<number> {
    return this.writeStream(path, textStream(chunks), signal);
  }

  async writeBlob(path: string, blob: Blob, signal?: AbortSignal): Promise<number> {
    return this.writeStream(path, blob.stream(), signal);
  }

  private async writeStream(path: string, stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<number> {
    const writable = await this.open(path);
    let bytes = 0;
    try {
      await stream.pipeThrough(countingStream((n) => (bytes += n)), { signal }).pipeTo(writable, { signal });
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    return bytes;
  }

  async close(): Promise<void> {}

  async abort(): Promise<void> {}
}

async function exists(parent: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch {
    try {
      await parent.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Streams a ZIP archive into a file. zip.js switches entries to ZIP64 when
 * needed; `zip64: true` forces it for archives expected to exceed the classic
 * format's 4 GB / 65,535-entry limits.
 */
export class ZipSink implements OutputSink {
  readonly kind = 'zip' as const;
  private readonly writer: ZipWriter<unknown>;

  constructor(
    writable: WritableStream<Uint8Array>,
    readonly name: string,
    options: { zip64?: boolean } = {},
  ) {
    configure({ useWebWorkers: false });
    this.writer = new ZipWriter(writable, { zip64: options.zip64 ?? false, keepOrder: true });
  }

  async writeText(path: string, chunks: AsyncIterable<string>, signal?: AbortSignal): Promise<number> {
    let bytes = 0;
    const stream = textStream(chunks).pipeThrough(countingStream((n) => (bytes += n)));
    await this.writer.add(path, stream, { level: 6, signal });
    return bytes;
  }

  async writeBlob(path: string, blob: Blob, signal?: AbortSignal): Promise<number> {
    // Media is already compressed; storing it is much faster.
    await this.writer.add(path, blob.stream(), { level: 0, signal });
    return blob.size;
  }

  async close(): Promise<void> {
    await this.writer.close();
  }

  async abort(): Promise<void> {
    // The partial file stays on disk; it is not a valid archive.
  }
}

/** In-memory sink for tests. */
export class MemorySink implements OutputSink {
  readonly kind = 'memory' as const;
  readonly name = 'memory';
  readonly files = new Map<string, Uint8Array>();

  async writeText(path: string, chunks: AsyncIterable<string>): Promise<number> {
    let text = '';
    for await (const chunk of chunks) text += chunk;
    const bytes = encoder.encode(text);
    this.files.set(path, bytes);
    return bytes.byteLength;
  }

  async writeBlob(path: string, blob: Blob): Promise<number> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    this.files.set(path, bytes);
    return bytes.byteLength;
  }

  text(path: string): string {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`No file ${path}`);
    return new TextDecoder().decode(bytes);
  }

  async close(): Promise<void> {}

  async abort(): Promise<void> {}
}
