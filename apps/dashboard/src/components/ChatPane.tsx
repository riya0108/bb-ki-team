import type { ChatMessage } from '@bb/shared-types';
import { useEffect, useRef, useState } from 'react';

import type { Platform } from '../api/client';
import { ApiError, listChatMessages, sendChatMessage } from '../api/client';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface ChatPaneProps {
  platform: Platform;
  openContentId: string | null;
  onActionResult: (action: string, result: unknown) => void;
}

export function ChatPane({ platform, openContentId, onActionResult }: ChatPaneProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    listChatMessages(platform)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages.map((m: ChatMessage) => ({ id: m.id, role: m.role, content: m.content })));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: message }]);
    setSending(true);
    try {
      const response = await sendChatMessage(platform, message, openContentId);
      setMessages((prev) => [...prev, { id: response.runId, role: 'assistant', content: response.reply }]);
      onActionResult(response.action, response.result);
    } catch (err) {
      const text = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'error', content: text }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-area">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            Ask this agent for something — e.g. &ldquo;draft a post about UPI adoption, angle: merchants are driving
            it&rdquo;.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>
      <div className="chat-composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={`Message the ${platform} agent…`}
          disabled={sending}
        />
        <button className="primary" onClick={() => void send()} disabled={sending || !draft.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
