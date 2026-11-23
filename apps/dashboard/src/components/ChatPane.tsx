import type { AgentJob, ChatMessage } from '@bb/shared-types';
import { useEffect, useRef, useState } from 'react';

import type { Platform } from '../api/client';
import { ApiError, getBlogJob, isQueuedChatResponse, listChatMessages, sendChatMessage, startNewChatSession } from '../api/client';
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
const JOB_POLL_MS = 5_000;

// Status line shown in place of the reply while the Blog worker on the operator's
// Mac has the message (deployed dashboard only — see apps/api/src/blogWorker.ts).
function pendingJobText(job: Pick<AgentJob, 'status'>): string {
  return job.status === 'running'
    ? 'Writing on your Mac with Claude… a full article can take 15–30 minutes. You can close this page and come back.'
    : 'Queued — it starts as soon as the Blog worker on your Mac is running (npm run blog:worker).';
}

function jobBubbleId(jobId: string): string {
  return `job-${jobId}`;
}

// A finished job's stored result, checked before it's shown.
function chatJobOutcome(job: AgentJob): { reply: string; action: string; result: unknown } | null {
  const r = job.result;
  if (typeof r !== 'object' || r === null) return null;
  const { reply, action, result } = r as Record<string, unknown>;
  if (typeof reply !== 'string' || typeof action !== 'string') return null;
  return { reply, action, result };
}

// iOS WebKit (Safari and every other iOS browser, which all wrap it) renders
// HEVC-alpha <video> as opaque instead of honoring its alpha channel — true
// everywhere else, so only iOS needs the pre-composited fallback.
const isIOS = typeof navigator !== 'undefined' && /iP(hone|od|ad)/.test(navigator.userAgent);

export function ChatPane({ platform, openContentId, onActionResult, onHeroChange, onNewChat }: ChatPaneProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // A blog message the Mac worker is still writing; the composer stays disabled.
  const [pendingJob, setPendingJob] = useState<AgentJob | null>(null);
  const busy = sending || pendingJob !== null;
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
    setPendingJob(null);
    listChatMessages(platform)
      .then((res) => {
        if (cancelled) return;
        setSessionId(res.sessionId);
        const loaded: LocalMessage[] = res.messages.map((m: ChatMessage) => ({ id: m.id, role: m.role, content: m.content }));
        const pending = res.pendingJob ?? null;
        if (pending) loaded.push({ id: jobBubbleId(pending.id), role: 'assistant', content: pendingJobText(pending) });
        setMessages(loaded);
        setPendingJob(pending);
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

  // Poll the pending job until the Mac worker finishes it, then swap the status
  // bubble for the real reply (or the error) and hand the result to App.tsx just
  // like an inline reply.
  const pendingJobId = pendingJob?.id ?? null;
  // App.tsx passes a fresh callback every render; read it through a ref so polling
  // isn't restarted by each re-render.
  const onActionResultRef = useRef(onActionResult);
  useEffect(() => {
    onActionResultRef.current = onActionResult;
  }, [onActionResult]);
  useEffect(() => {
    if (!pendingJobId) return;
    let cancelled = false;
    const bubbleId = jobBubbleId(pendingJobId);
    const replaceBubble = (next: LocalMessage): void => {
      setMessages((prev) => prev.map((m) => (m.id === bubbleId ? next : m)));
    };
    const poll = async (): Promise<void> => {
      let job: AgentJob;
      try {
        ({ job } = await getBlogJob(pendingJobId));
      } catch {
        return; // network blip (phone asleep, etc.): try again next tick
      }
      if (cancelled) return;
      if (job.status === 'done') {
        const outcome = chatJobOutcome(job);
        replaceBubble(
          outcome
            ? { id: job.runId, role: 'assistant', content: outcome.reply }
            : { id: `error-${job.id}`, role: 'error', content: 'The Blog worker finished but returned no reply.' },
        );
        setPendingJob(null);
        if (outcome) onActionResultRef.current(outcome.action, outcome.result);
      } else if (job.status === 'failed') {
        replaceBubble({ id: `error-${job.id}`, role: 'error', content: job.error ?? 'The Blog worker could not finish this message.' });
        setPendingJob(null);
      } else {
        replaceBubble({ id: bubbleId, role: 'assistant', content: pendingJobText(job) });
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingJobId]);

  async function send() {
    const message = draft.trim();
    if (!message || busy || !sessionId) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: message }]);
    setSending(true);
    try {
      const response = await sendChatMessage(platform, sessionId, message, openContentId);
      if (isQueuedChatResponse(response)) {
        setMessages((prev) => [...prev, { id: jobBubbleId(response.job.id), role: 'assistant', content: pendingJobText(response.job) }]);
        setPendingJob(response.job);
      } else {
        setMessages((prev) => [...prev, { id: response.runId, role: 'assistant', content: response.reply }]);
        onActionResult(response.action, response.result);
      }
    } catch (err) {
      const text = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'error', content: text }]);
    } finally {
      setSending(false);
    }
  }

  async function newChat() {
    if (busy) return;
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
          disabled={busy}
        />
        <button type="button" className="send-button" onClick={() => void send()} disabled={busy || !draft.trim()} aria-label="Send">
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
        <button type="button" className="new-chat-button" onClick={() => void newChat()} disabled={busy}>
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
