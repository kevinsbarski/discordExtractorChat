import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { snowflakeToMs } from '../src/core/snowflake';
import { createJob, deleteJob, getJob, updateJob } from '../src/storage/jobStore';
import {
  applyCaptureBatch,
  countMessages,
  findGaps,
  getMessage,
  iterateMessages,
  loadSortedIds,
  putFetchedMessages,
} from '../src/storage/messageStore';
import { idAt, jobInput, message, RANGE_END, RANGE_START } from './helpers';

describe('job store', () => {
  it('creates, updates and deletes jobs', async () => {
    const job = await createJob(jobInput());
    expect(job.stage).toBe('collecting');
    await updateJob(job.id, (j) => {
      j.paused = true;
    });
    expect((await getJob(job.id))?.paused).toBe(true);
    await putFetchedMessages(job.id, [message(idAt(1))]);
    await deleteJob(job.id);
    expect(await getJob(job.id)).toBeUndefined();
    expect(await countMessages(job.id)).toBe(0);
  });
});

describe('capture batches', () => {
  it('stores in-range messages only and counts new ones once', async () => {
    const job = await createJob(jobInput());
    const before = (BigInt(idAt(0)) - 4194304n * 60_000n).toString(); // one minute before the range
    const after = (BigInt(idAt(24 * 60)) + 1n).toString(); // after the range
    let updated = await applyCaptureBatch(job.id, {
      messages: [message(before), message(idAt(1)), message(idAt(2)), message(after)],
      pairs: [],
    });
    expect(updated.collect.messageCount).toBe(2);
    updated = await applyCaptureBatch(job.id, { messages: [message(idAt(1), { content: 'edited' })], pairs: [] });
    expect(updated.collect.messageCount).toBe(2);
    expect((await getMessage(job.id, idAt(1)))?.content).toBe('edited');
    expect(updated.collect.oldestMs).toBe(snowflakeToMs(idAt(1)));
    expect(snowflakeToMs(before)).toBeLessThan(RANGE_START);
    expect(snowflakeToMs(after)).toBeGreaterThan(RANGE_END);
  });

  it('marks coverage when neighbours outside the range are seen', async () => {
    const job = await createJob(jobInput());
    const before = (BigInt(idAt(0)) - 1n).toString();
    const last = idAt(24 * 60 - 1);
    const after = (BigInt(idAt(24 * 60)) + 5n).toString();
    let updated = await applyCaptureBatch(job.id, {
      messages: [message(idAt(0)), message(last)],
      pairs: [[before, idAt(0)]],
    });
    expect(updated.collect.startReached).toBe(true);
    expect(updated.collect.endReached).toBe(false);
    updated = await applyCaptureBatch(job.id, { messages: [], pairs: [[last, after]] });
    expect(updated.collect.endReached).toBe(true);
  });

  it('merges re-captures without losing earlier details', async () => {
    const job = await createJob(jobInput());
    const id = idAt(5);
    const attachment = {
      id: '900',
      filename: 'a.png',
      url: 'https://cdn.discordapp.com/attachments/10/900/a.png?ex=1&is=1&hm=1',
      kind: 'image' as const,
    };
    await applyCaptureBatch(job.id, { messages: [message(id, { attachments: [attachment] })], pairs: [] });
    // A later render without the author header and with a refreshed URL.
    await applyCaptureBatch(job.id, {
      messages: [
        message(id, {
          author: { name: '' },
          authorRefId: idAt(4),
          attachments: [{ ...attachment, url: attachment.url.replace('ex=1', 'ex=2') }],
        }),
      ],
      pairs: [],
    });
    const stored = await getMessage(job.id, id);
    expect(stored?.author.name).toBe('Alice');
    expect(stored?.attachments).toHaveLength(1);
    expect(stored?.attachments[0].url).toContain('ex=2');
  });

  it('finds gaps between messages that were never seen next to each other', async () => {
    const job = await createJob(jobInput());
    const ids = [idAt(1), idAt(2), idAt(3), idAt(10), idAt(11)];
    await applyCaptureBatch(job.id, {
      messages: ids.map((id) => message(id)),
      pairs: [
        [ids[0], ids[1]],
        [ids[1], ids[2]],
        [ids[3], ids[4]],
      ],
    });
    const { total, gaps } = await findGaps(job.id);
    expect(total).toBe(1);
    expect(gaps[0]).toMatchObject({ afterId: ids[2], beforeId: ids[3] });
  });
});

describe('reading messages back', () => {
  it('iterates chronologically in batches and loads compact sorted IDs', async () => {
    const job = await createJob(jobInput({ method: 'bot' }));
    const ids = Array.from({ length: 30 }, (_, i) => idAt(30 - i)); // inserted newest first
    await putFetchedMessages(job.id, ids.map((id) => message(id, { source: 'bot' })));
    const seen: string[] = [];
    for await (const batch of iterateMessages(job.id, 7)) seen.push(...batch.map((m) => m.id));
    expect(seen).toEqual([...ids].reverse());
    const sorted = await loadSortedIds(job.id);
    expect(Array.from(sorted, String)).toEqual([...ids].reverse());
  });
});
