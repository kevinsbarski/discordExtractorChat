/** Subset of Discord API objects used by the exporter (API v10). */

export interface ApiUser {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

export interface ApiAttachment {
  id: string;
  filename: string;
  title?: string;
  description?: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url?: string;
  height?: number | null;
  width?: number | null;
  duration_secs?: number;
  flags?: number;
}

export interface ApiEmbed {
  type?: string;
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string };
  image?: { url: string; proxy_url?: string };
  thumbnail?: { url: string; proxy_url?: string };
  video?: { url?: string };
  provider?: { name?: string };
  author?: { name: string; url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface ApiEmoji {
  id: string | null;
  name: string | null;
  animated?: boolean;
}

export interface ApiReaction {
  count: number;
  emoji: ApiEmoji;
}

export interface ApiStickerItem {
  id: string;
  name: string;
  format_type: number;
}

export interface ApiMessageReference {
  type?: number;
  message_id?: string;
  channel_id?: string;
  guild_id?: string;
}

export interface ApiPoll {
  question: { text?: string };
  answers: { answer_id: number; poll_media: { text?: string; emoji?: ApiEmoji } }[];
  results?: { answer_counts: { id: number; count: number }[] };
}

export interface ApiComponent {
  type: number;
  content?: string;
  components?: ApiComponent[];
  accessory?: ApiComponent;
  items?: { media?: { url?: string }; description?: string | null }[];
  media?: { url?: string };
  file?: { url?: string };
  label?: string;
  url?: string;
}

export interface ApiMessageSnapshot {
  message: {
    content?: string;
    timestamp?: string;
    edited_timestamp?: string | null;
    attachments?: ApiAttachment[];
    embeds?: ApiEmbed[];
    sticker_items?: ApiStickerItem[];
    components?: ApiComponent[];
    flags?: number;
  };
}

export interface ApiMessage {
  id: string;
  channel_id: string;
  type: number;
  author: ApiUser;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  mentions?: ApiUser[];
  mention_roles?: string[];
  attachments?: ApiAttachment[];
  embeds?: ApiEmbed[];
  reactions?: ApiReaction[];
  pinned?: boolean;
  flags?: number;
  sticker_items?: ApiStickerItem[];
  message_reference?: ApiMessageReference;
  referenced_message?: ApiMessage | null;
  message_snapshots?: ApiMessageSnapshot[];
  poll?: ApiPoll;
  components?: ApiComponent[];
  thread?: { id: string; name?: string };
  call?: { participants: string[]; ended_timestamp?: string | null };
}

export interface ApiChannel {
  id: string;
  type: number;
  name?: string | null;
  guild_id?: string;
  parent_id?: string | null;
  recipients?: ApiUser[];
}

export interface ApiGuild {
  id: string;
  name: string;
}

export interface ApiRole {
  id: string;
  name: string;
}
