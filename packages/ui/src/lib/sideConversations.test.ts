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

  test('hides history inherited from the parent and keeps its own turns', () => {
    const forkedAt = '2026-08-14T20:46:33.547Z';
    const messages = [
      { info: { time: { created: 1786740288172 } } },
      { info: { time: { created: 1786740393546 } } },
      { info: { time: { created: 1786740500000 } } },
    ];
    expect(dropInheritedMessages(messages, forkedAt)).toEqual([{ info: { time: { created: 1786740500000 } } }]);
  });

  test('opens clean when every message predates the fork', () => {
    // The measured shape of a freshly opened side chat: all inherited, none own.
    const messages = [{ info: { time: { created: 1786740288172 } } }];
    expect(dropInheritedMessages(messages, '2026-08-14T20:46:33.547Z')).toEqual([]);
  });

  test('keeps the transcript when there is nothing to separate it by', () => {
    const messages = [{ info: { time: { created: 10 } } }, { info: { time: { created: 20 } } }];
    // Not a side conversation at all.
    expect(dropInheritedMessages(messages, null)).toBe(messages);
    expect(dropInheritedMessages(messages, undefined)).toBe(messages);
    // An unparseable timestamp must not blank the view.
    expect(dropInheritedMessages(messages, 'not-a-date')).toBe(messages);
    // Nothing inherited: same array back, so memoized consumers do not re-render.
    expect(dropInheritedMessages(messages, new Date(5).toISOString())).toBe(messages);
    expect(dropInheritedMessages([], '2026-08-14T20:46:33.547Z')).toEqual([]);
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
