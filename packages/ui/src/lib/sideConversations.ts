import type { Message, Session } from '@opencode-ai/sdk/v2';

export const SIDE_CONVERSATION_PLUGIN_ID = '@pocharlies/openchamber-side-chat';
export const SIDE_CONVERSATION_CONTRACT_VERSION = 1;

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export type SideConversationMetadata = {
  contractVersion: 1;
  pluginId: string;
  parentSessionID: string;
  ephemeral: boolean;
  createdAt: string;
};

export const getSideConversationMetadata = (
  session: Session | null | undefined,
): SideConversationMetadata | null => {
  const metadata = (session as (Session & { metadata?: unknown }) | null | undefined)?.metadata;
  if (!isRecord(metadata) || !isRecord(metadata.openchamber)) return null;
  const candidate = metadata.openchamber.sideConversation;
  if (!isRecord(candidate)) return null;
  if (candidate.contractVersion !== SIDE_CONVERSATION_CONTRACT_VERSION) return null;
  if (typeof candidate.pluginId !== 'string' || typeof candidate.parentSessionID !== 'string') return null;
  if (typeof candidate.ephemeral !== 'boolean' || typeof candidate.createdAt !== 'string') return null;
  return candidate as SideConversationMetadata;
};

export const isEphemeralSideConversation = (session: Session | null | undefined): boolean =>
  getSideConversationMetadata(session)?.ephemeral === true;

export type SideConversationCloseDisposition = 'close' | 'discard' | 'confirm';

export const getSideConversationCloseDisposition = (
  session: Session | null | undefined,
  authoritativeMessageCount: number,
): SideConversationCloseDisposition => {
  if (!isEphemeralSideConversation(session)) return 'close';
  return authoritativeMessageCount === 0 ? 'discard' : 'confirm';
};

export const withSideConversationMetadata = (
  metadata: RecordValue,
  parentSessionID: string,
): RecordValue => {
  const openchamber = isRecord(metadata.openchamber) ? metadata.openchamber : {};
  return {
    ...metadata,
    openchamber: {
      ...openchamber,
      sideConversation: {
        contractVersion: SIDE_CONVERSATION_CONTRACT_VERSION,
        pluginId: SIDE_CONVERSATION_PLUGIN_ID,
        parentSessionID,
        ephemeral: true,
        createdAt: new Date().toISOString(),
      } satisfies SideConversationMetadata,
    },
  };
};

export const preserveSideConversation = (metadata: RecordValue): RecordValue => {
  if (!isRecord(metadata.openchamber) || !isRecord(metadata.openchamber.sideConversation)) return metadata;
  return {
    ...metadata,
    openchamber: {
      ...metadata.openchamber,
      sideConversation: {
        ...metadata.openchamber.sideConversation,
        ephemeral: false,
      },
    },
  };
};

export const findLastCompletedAssistantMessageID = (messages: readonly Message[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const completed = (message as Message & { time?: { completed?: number } }).time?.completed;
    if (typeof completed === 'number' && Number.isFinite(completed)) return message.id;
  }
  return undefined;
};
