import { describe, expect, it } from 'vitest';
import {
  attachmentCandidateUrls,
  describeAsset,
  isAttachmentUrlExpired,
  parseAttachmentUrl,
  stickerUrl,
  toOriginalAttachmentUrl,
  userAvatarUrl,
} from '../src/processing/discordCdn';
import { FilenameAllocator, safeNameSegment, sanitizeFilename, splitExtension } from '../src/processing/filenames';

const SIGNED =
  'https://cdn.discordapp.com/attachments/1012345678900020080/1234567891233211234/my_image.png?ex=65d903de&is=65c68ede&hm=2481f30dd67f503f54d020ae3b5533b9987fae4e55f2b4e3926e08a3fa3ee24f&';
const PROXY =
  'https://media.discordapp.net/attachments/1012345678900020080/1234567891233211234/my_image.png?ex=65d903de&is=65c68ede&hm=2481f30dd67f503f54d020ae3b5533b9987fae4e55f2b4e3926e08a3fa3ee24f&=&format=webp&quality=lossless&width=550&height=309';

describe('attachment URLs', () => {
  it('parses the documented signed URL', () => {
    const parsed = parseAttachmentUrl(SIGNED);
    expect(parsed).toMatchObject({
      host: 'cdn.discordapp.com',
      channelId: '1012345678900020080',
      attachmentId: '1234567891233211234',
      filename: 'my_image.png',
      expiresAtMs: 0x65d903de * 1000,
      issuedAtMs: 0x65c68ede * 1000,
    });
  });

  it('maps media-proxy previews back to the original file', () => {
    const original = toOriginalAttachmentUrl(PROXY);
    expect(original.startsWith('https://cdn.discordapp.com/attachments/1012345678900020080/1234567891233211234/my_image.png?')).toBe(true);
    const url = new URL(original);
    expect([...url.searchParams.keys()]).toEqual(['ex', 'is', 'hm']);
  });

  it('lists candidate URLs best first without duplicates', () => {
    const candidates = attachmentCandidateUrls(PROXY);
    expect(candidates[0]).toContain('https://cdn.discordapp.com/');
    expect(candidates).toContain(PROXY);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('detects expiry from the ex parameter', () => {
    expect(isAttachmentUrlExpired(SIGNED, 0x65d903de * 1000 + 1)).toBe(true);
    expect(isAttachmentUrlExpired(SIGNED, 0x65c68ede * 1000)).toBe(false);
    expect(isAttachmentUrlExpired('https://cdn.discordapp.com/emojis/1.png')).toBe(false);
  });

  it('ignores non-attachment URLs', () => {
    expect(parseAttachmentUrl('https://example.com/attachments/1/2/x.png')).toBeNull();
    expect(parseAttachmentUrl('https://cdn.discordapp.com/avatars/1/abc.png')).toBeNull();
  });
});

describe('asset descriptors', () => {
  it('describes avatars, default avatars, emoji and stickers', () => {
    expect(describeAsset('https://cdn.discordapp.com/avatars/111/a_abc123.webp?size=80')).toEqual({
      key: 'avatar:111:a_abc123',
      kind: 'avatar',
      url: 'https://cdn.discordapp.com/avatars/111/a_abc123.webp?size=128',
      path: 'assets/avatars/111-a_abc123.webp',
    });
    expect(describeAsset('https://cdn.discordapp.com/guilds/5/users/6/avatars/ff.png')?.path).toBe('assets/avatars/5-6-ff.png');
    expect(describeAsset('https://cdn.discordapp.com/embed/avatars/3.png')?.key).toBe('avatar:default:3');
    expect(describeAsset('https://cdn.discordapp.com/emojis/42.webp?size=48&animated=true')?.path).toBe('assets/emoji/42.gif');
    expect(describeAsset('https://media.discordapp.net/stickers/7.png?size=160')?.key).toBe('sticker:7');
    expect(describeAsset('https://example.com/a.png')).toBeNull();
  });

  it('builds API-derived URLs', () => {
    expect(userAvatarUrl('80351110224678912', 'a_1')).toBe('https://cdn.discordapp.com/avatars/80351110224678912/a_1.gif?size=128');
    expect(userAvatarUrl('80351110224678912', null, '1337')).toBe('https://cdn.discordapp.com/embed/avatars/2.png');
    expect(stickerUrl('9', 3).format).toBe('lottie');
  });
});

describe('file names', () => {
  it('keeps normal names and splits extensions', () => {
    expect(sanitizeFilename('holiday photo.jpg')).toBe('holiday photo.jpg');
    expect(splitExtension('archive.tar.gz')).toEqual(['archive.tar', '.gz']);
    expect(splitExtension('.env')).toEqual(['.env', '']);
  });

  it('replaces characters that are invalid on Windows/macOS and reserved names', () => {
    expect(sanitizeFilename('a<b>:c"d/e\\f|g?h*.txt')).toBe('a_b__c_d_e_f_g_h_.txt');
    expect(sanitizeFilename('CON.txt')).toBe('CON_.txt');
    expect(sanitizeFilename('name. ')).toBe('name');
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('..')).toBe('file');
  });

  it('limits very long names but keeps the extension', () => {
    const name = sanitizeFilename(`${'x'.repeat(400)}.png`);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith('.png')).toBe(true);
  });

  it('makes names unique case-insensitively', () => {
    const allocator = new FilenameAllocator(['image.png']);
    expect(allocator.allocate('image.png')).toBe('image (2).png');
    expect(allocator.allocate('IMAGE.png')).toBe('IMAGE (3).png');
    expect(allocator.allocate('other.png')).toBe('other.png');
  });

});

describe('folder-safe name segments', () => {
  it('keeps readable text but removes characters that break folder names', () => {
    expect(safeNameSegment('Café 世界')).toBe('Café 世界');
    expect(safeNameSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(safeNameSegment('  ...hidden  ')).toBe('hidden');
    expect(safeNameSegment('tab\tand\nnewline')).toBe('tab and newline');
    expect(safeNameSegment('ends with dot.')).toBe('ends with dot');
    expect(safeNameSegment('nul')).toBe('nul_');
    expect(safeNameSegment('')).toBe('');
  });
});
