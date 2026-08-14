import { describe, expect, test } from 'bun:test';
import type { Message, Session } from '@opencode-ai/sdk/v2';
import {
  SIDE_CONVERSATION_BOUNDARY_INSTRUCTION,
  dropInheritedMessages,
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

  test('hides the inherited transcript up to the recorded boundary', () => {
    const messages = [
      { info: { id: 'msg-1' } },
      { info: { id: 'msg-boundary' } },
      { info: { id: 'msg-own' } },
    ];
    expect(dropInheritedMessages(messages, 'msg-boundary')).toEqual([{ info: { id: 'msg-own' } }]);
    expect(dropInheritedMessages(messages, 'msg-own')).toEqual([]);
  });

  test('keeps the transcript when the boundary is missing or unknown', () => {
    const messages = [{ info: { id: 'msg-1' } }, { info: { id: 'msg-2' } }];
    // No boundary recorded: sessions created before the field existed.
    expect(dropInheritedMessages(messages, undefined)).toBe(messages);
    expect(dropInheritedMessages(messages, null)).toBe(messages);
    // Boundary outside the loaded page must not blank the whole view.
    expect(dropInheritedMessages(messages, 'msg-not-loaded')).toBe(messages);
    expect(dropInheritedMessages([], 'msg-boundary')).toEqual([]);
  });

  test('records the inherited boundary in metadata without disturbing the rest', () => {
    const marked = withSideConversationMetadata({}, 'ses_parent', 'msg-boundary');
    const session = { id: 'ses_side', metadata: marked } as unknown as Session;
    expect(getSideConversationMetadata(session)?.inheritedThroughMessageID).toBe('msg-boundary');
    expect(isEphemeralSideConversation(session)).toBe(true);
    // A fork with no inherited tail must not invent one.
    const empty = withSideConversationMetadata({}, 'ses_parent');
    const emptySession = { id: 'ses_side', metadata: empty } as unknown as Session;
    expect(getSideConversationMetadata(emptySession)?.inheritedThroughMessageID).toBe(undefined);
  });

  test('boundary demotes inherited history without referring to its own position', () => {
    expect(SIDE_CONVERSATION_BOUNDARY_INSTRUCTION).toContain('reference context only');
    expect(SIDE_CONVERSATION_BOUNDARY_INSTRUCTION).toContain('inherited history');
    expect(SIDE_CONVERSATION_BOUNDARY_INSTRUCTION).toContain('Sub-agents are off-limits');

    // The instruction is re-sent on every turn, so any phrasing anchored to
    // where it sits would also disown the side conversation's own earlier
    // turns. Keep it scoped to the history inherited from the parent thread.
    expect(SIDE_CONVERSATION_BOUNDARY_INSTRUCTION).not.toContain('before this boundary');
    expect(SIDE_CONVERSATION_BOUNDARY_INSTRUCTION).not.toContain('after this boundary');
  });
});
