import { describe, expect, it } from 'vitest';
import { namesFromTitle } from '../src/retrieval/dom/contentController';

// Page capture reads conversation names from the tab title.
describe('names from the Discord tab title', () => {
  it('reads server and channel', () => {
    expect(namesFromTitle('#general | Test Server - Discord')).toEqual({ channelName: '#general', guildName: 'Test Server' });
    expect(namesFromTitle('(3) Discord | #news | My Server')).toEqual({ channelName: '#news', guildName: 'My Server' });
  });

  it('reads DM and group chat names', () => {
    expect(namesFromTitle('Discord | @alice')).toEqual({ channelName: '@alice', guildName: undefined });
    expect(namesFromTitle('Weekend plans - Discord')).toEqual({ channelName: 'Weekend plans', guildName: undefined });
  });
});
