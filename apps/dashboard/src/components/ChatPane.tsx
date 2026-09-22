import type { ChatMessage } from '@bb/shared-types';
import { useEffect, useRef, useState } from 'react';

import type { Platform } from '../api/client';
import { ApiError, listChatMessages, sendChatMessage, startNewChatSession } from '../api/client';
import { NewChatIcon, PlusIcon, SendIcon } from './icons';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface ChatPaneProps {
  platform: Platform;
  openContentId: string | null;
  onActionResult: (action: string, result: unknown) => void;
  // Lets App.tsx know whether the full-bleed landing state or the normal
  // messages+composer layout is showing, since only the latter has a draft canvas
  // above it worth making resizable (see App.tsx's chat-pane-wrapper).
  onHeroChange?: (isHero: boolean) => void;
  // "New chat" starts a fresh thread on a fresh content item — App.tsx needs to
  // drop whatever was open in the draft canvas so a follow-up message in the new
  // thread doesn't get mistaken for an edit instruction on the old one.
  onNewChat?: () => void;
}

const COMPOSER_MAX_HEIGHT_PX = 200;

// iOS WebKit (Safari and every other iOS browser, which all wrap it) renders
// HEVC-alpha <video> as opaque instead of honoring its alpha channel — true
// everywhere else, so only iOS needs the pre-composited fallback.
const isIOS = typeof navigator !== 'undefined' && /iP(hone|od|ad)/.test(navigator.userAgent);

export function ChatPane({ platform, openContentId, onActionResult, onHeroChange, onNewChat }: ChatPaneProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the composer to fit whatever's typed (up to a cap, past which it
  // scrolls internally) instead of clipping everything after the first line —
  // re-runs on every keystroke and whenever `draft` is cleared programmatically
  // (e.g. right after send()), so it always reflects the field's actual content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    setSessionId(null);
    listChatMessages(platform)
      .then((res) => {
        if (cancelled) return;
        setSessionId(res.sessionId);
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
    if (!message || sending || !sessionId) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: message }]);
    setSending(true);
    try {
      const response = await sendChatMessage(platform, sessionId, message, openContentId);
      setMessages((prev) => [...prev, { id: response.runId, role: 'assistant', content: response.reply }]);
      onActionResult(response.action, response.result);
    } catch (err) {
      const text = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'error', content: text }]);
    } finally {
      setSending(false);
    }
  }

  async function newChat() {
    if (sending) return;
    const res = await startNewChatSession(platform);
    setSessionId(res.sessionId);
    setMessages([]);
    setDraft('');
    onNewChat?.();
  }

  function renderComposer(variant?: 'hero') {
    const isHeroVariant = variant === 'hero';
    const composer = (
      <div className={`chat-composer${isHeroVariant ? ' hero-composer' : ''}`}>
        {isHeroVariant && (
          <span className="composer-plus" aria-hidden="true">
            <PlusIcon />
          </span>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={isHeroVariant ? 'Ask Teri' : 'Ask anything..'}
          disabled={sending}
        />
        <button type="button" className="send-button" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send">
          <SendIcon />
        </button>
      </div>
    );

    if (!isHeroVariant) return composer;

    // The animated glow lives on this wrapper (not on .hero-composer itself) so the
    // pill's own opaque background paints over it and hides everything but the edges —
    // a pseudo-element on the pill would paint *above* the pill's own background fill
    // (backgrounds are the bottom-most stacking layer even under negative z-index
    // children) and wash color across the whole input instead of just the border.
    return <div className="hero-composer-glow">{composer}</div>;
  }

  const isHero = messages.length === 0 && !openContentId;

  useEffect(() => {
    onHeroChange?.(isHero);
  }, [isHero, onHeroChange]);

  if (isHero) {
    return (
      <div className="chat-area chat-hero">
        <div className="teri-hero">
          {/* True per-pixel alpha (HEVC .mov for Safari, VP9 webm for everyone
              else) reads as transparent against any background, including the
              animated bottom-glow bloom — unlike a flat pre-composited matte,
              which only matches a static, uniform --bg. The one place real
              alpha doesn't work is iOS, where WebKit renders HEVC-alpha video
              as opaque instead of honoring its alpha channel, so iOS alone
              falls back to an H.264 file with the background pre-composited
              onto it. */}
          {isIOS ? (
            <video
              className="teri-hero-animation"
              autoPlay
              loop
              muted
              playsInline
              disablePictureInPicture
              aria-hidden="true"
              src="/teri-hero.mp4"
            />
          ) : (
            <video
              className="teri-hero-animation"
              autoPlay
              loop
              muted
              playsInline
              disablePictureInPicture
              aria-hidden="true"
            >
              <source src="/teri-hero-alpha.mov" type="video/mp4; codecs=hvc1" />
              <source src="/teri-hero.webm" type="video/webm; codecs=vp9" />
            </video>
          )}
          <h1 className="teri-hero-heading">I am Teri, BB ki Team Lead</h1>
          <div className="teri-hero-composer">{renderComposer('hero')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-area">
      <div className="chat-area-header">
        <button type="button" className="new-chat-button" onClick={() => void newChat()} disabled={sending}>
          <NewChatIcon />
          New chat
        </button>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>
      {renderComposer()}
    </div>
  );
}
