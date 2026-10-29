/**
 * Data model shared by every part of the extension.
 *
 * Retrieval adapters (DOM capture, bot API) produce `ExportMessage` records,
 * the job store persists them, and the exporters (JSON, CSV, HTML) read them.
 */

/** How messages are collected. */
export type RetrievalMethod = 'dom' | 'bot';

export interface DateRange {
  /** Inclusive start as epoch milliseconds (local start of `startDate`). */
  startMs: number;
  /** Inclusive end as epoch milliseconds (local end of `endDate`). */
  endMs: number;
  /** Calendar date picked by the user, `YYYY-MM-DD`. */
  startDate: string;
  /** Calendar date picked by the user, `YYYY-MM-DD`. */
  endDate: string;
  /** IANA time zone the dates were interpreted in. */
  timeZone: string;
}

export interface ConversationRef {
  /** `null` for direct messages and group DMs (`/channels/@me/...`). */
  guildId: string | null;
  channelId: string;
  /** Best-effort, human-readable names (may be missing). */
  channelName?: string;
  guildName?: string;
  url: string;
}

export interface ExportAuthor {
  id?: string;
  /** Name as Discord displayed it (server nickname, display name or username). */
  name: string;
  username?: string;
  avatarUrl?: string;
  bot?: boolean;
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export interface ExportAttachment {
  /** Discord attachment ID. */
  id: string;
  filename: string;
  /** Download URL as last seen. Attachment URLs are signed and expire. */
  url: string;
  /** Alternative URLs to try when `url` fails (for example the media proxy). */
  fallbackUrls?: string[];
  /** Exact size in bytes when known (bot API). */
  size?: number;
  /** Size as displayed by Discord, for example "1.2 MB" (DOM capture). */
  sizeText?: string;
  contentType?: string;
  width?: number;
  height?: number;
  kind: AttachmentKind;
  spoiler?: boolean;
  description?: string;
}

export interface ExportEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ExportEmbed {
  type?: string;
  url?: string;
  title?: string;
  /** Plain text (DOM capture) or Discord markdown (bot API). */
  description?: string;
  color?: string;
  authorName?: string;
  authorUrl?: string;
  providerName?: string;
  footerText?: string;
  fields?: ExportEmbedField[];
  imageUrl?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  timestamp?: string;
}

export interface ExportReaction {
  /** Unicode emoji or `:name:` for custom emoji. */
  emoji: string;
  emojiId?: string;
  emojiUrl?: string;
  count: number;
}

export interface ExportSticker {
  id?: string;
  name: string;
  url?: string;
  format?: 'png' | 'apng' | 'gif' | 'lottie' | 'unknown';
}

export interface ExportEmoji {
  id: string;
  name: string;
  animated?: boolean;
  url: string;
}

export interface ExportReference {
  messageId?: string;
  channelId?: string;
  guildId?: string;
  authorName?: string;
  /** Short text preview of the referenced message. */
  snippet?: string;
  /** The referenced message no longer exists. */
  deleted?: boolean;
}

export interface ExportPoll {
  question: string;
  answers: { text: string; votes?: number }[];
}

export interface ExportMessage {
  id: string;
  channelId: string;
  /** ISO 8601 creation time (derived from the snowflake ID). */
  timestamp: string;
  editedTimestamp?: string;
  /** `default`, `reply`, `system` or a Discord message type name. */
  type: string;
  system?: boolean;
  author: ExportAuthor;
  /**
   * DOM capture only: ID of the first message of the visual group this
   * message belongs to. Its author is this message's author.
   */
  authorRefId?: string;
  /** Plain-text content (mentions and emoji rendered as text). */
  content: string;
  /** Sanitized HTML content (DOM capture). */
  contentHtml?: string;
  /** Raw Discord markdown (bot API). */
  contentMarkdown?: string;
  attachments: ExportAttachment[];
  embeds: ExportEmbed[];
  reactions: ExportReaction[];
  stickers: ExportSticker[];
  /** Custom emoji used in the content (for offline copies). */
  emojis: ExportEmoji[];
  reference?: ExportReference;
  /** Markers such as `forwarded`, `voice-message`, `pinned`, `thread-starter`. */
  flags: string[];
  poll?: ExportPoll;
  /** Mentioned user IDs mapped to display names (bot API). */
  mentions?: Record<string, string>;
  source: RetrievalMethod;
  /** Unmodified API object (bot API only). */
  raw?: unknown;
}

export interface ExportFormats {
  json: boolean;
  html: boolean;
  csv: boolean;
}

export interface ExportOptions {
  formats: ExportFormats;
  downloadAttachments: boolean;
  /** Avatars, custom emoji and stickers, so the HTML viewer works offline. */
  downloadAssets: boolean;
  messagesPerHtmlPart: number;
}

export const DEFAULT_OPTIONS: ExportOptions = {
  formats: { json: true, html: true, csv: true },
  downloadAttachments: true,
  downloadAssets: true,
  messagesPerHtmlPart: 1000,
};
