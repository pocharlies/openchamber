import { describe, expect, test } from 'bun:test';
import type { Message, Session } from '@opencode-ai/sdk/v2';
import {
  findLastCompletedAssistantMessageID,
  getSideConversationCloseDisposition,
  getSideConversationMetadata,
  isEphemeralSideConversation,
  preserveSideConversation,
  withSideConversationMetadata,
} from './sideConversations';

describe('side conversation contract', () => {
  test('marks and preserves an ephemeral child without dropping other metadata', () => {
    const marked = withSideConversationMetadata({ existing: true }, 'ses_parent');
    const session = { id: 'ses_side', metadata: marked } as unknown as Session;
    expect(isEphemeralSideConversation(session)).toBe(true);
    expect(getSideConversationMetadata(session)?.parentSessionID).toBe('ses_parent');
    const kept = preserveSideConversation(marked);
    expect((kept as { existing?: boolean }).existing).toBe(true);
    expect(isEphemeralSideConversation({ id: 'ses_side', metadata: kept } as unknown as Session)).toBe(false);
  });

  test('uses the last completed assistant boundary and ignores an active response', () => {
    const messages = [
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant', time: { completed: 10 } },
      { id: 'user-2', role: 'user' },
      { id: 'assistant-active', role: 'assistant', time: { created: 20 } },
    ] as unknown as Message[];
    expect(findLastCompletedAssistantMessageID(messages)).toBe('assistant-1');
  });

  test('discards only empty ephemeral conversations', () => {
    const metadata = withSideConversationMetadata({}, 'ses_parent');
    const ephemeral = { id: 'ses_side', metadata } as unknown as Session;
    expect(getSideConversationCloseDisposition(ephemeral, 0)).toBe('discard');
    expect(getSideConversationCloseDisposition(ephemeral, 1)).toBe('confirm');
  });

  test('closes kept and ordinary sessions without a destructive prompt', () => {
    const kept = {
      id: 'ses_kept',
      metadata: preserveSideConversation(withSideConversationMetadata({}, 'ses_parent')),
    } as unknown as Session;
    expect(getSideConversationCloseDisposition(kept, 0)).toBe('close');
    expect(getSideConversationCloseDisposition({ id: 'ses_regular' } as Session, 3)).toBe('close');
  });
});
