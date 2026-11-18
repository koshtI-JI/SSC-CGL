import React, { useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Headset,
  Loader2,
  MessageSquare,
  Send,
  X,
} from 'lucide-react';
import { aiChatMentor } from '../lib/aiClient';
import { createSupportTicket } from '../lib/firestoreService';
import type { StudentProfile, SupportTicketDoc } from '../types/exam';
import { formatDateTimeShort } from '../utils/examEngine';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface FloatingSupportChatWidgetProps {
  student: StudentProfile;
  tickets: SupportTicketDoc[];
  aiTutorEnabled?: boolean;
}

const INITIAL_BOT_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: 'Namaste! Ask me any SSC CGL Quant/English/GS concept, formula, or platform doubt. Need to report a bug? Switch to the Admin Support tab.',
  },
];

export const FloatingSupportChatWidget: React.FC<FloatingSupportChatWidgetProps> = ({
  student,
  tickets,
  aiTutorEnabled = true,
}) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'ai' | 'support'>(aiTutorEnabled ? 'ai' : 'support');

  // AI Chatbot state
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_BOT_MESSAGES);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Admin Support ticket state
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketStatusMsg, setTicketStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const myTickets = useMemo(
    () => tickets.filter((t) => t.uid === student.uid),
    [tickets, student.uid]
  );
  const resolvedUnreadCount = useMemo(
    () => myTickets.filter((t) => t.status === 'resolved' && !t.resolutionAcked).length,
    [myTickets]
  );

  const sendAiMessage = async (promptText: string) => {
    if (!aiTutorEnabled) return;
    const trimmed = promptText.trim();
    if (!trimmed || chatBusy) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setChatInput('');
    setChatBusy(true);

    try {
      const data = await aiChatMentor({
        message: trimmed,
        history: nextHistory.slice(-8).map((m) => ({ role: m.role, text: m.text })),
        studentName: student.displayName,
        targetPost: student.targetPost,
      });
      setMessages((prev) => [
        ...prev,
        { id: `a_${Date.now()}`, role: 'assistant', text: data.reply },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          text:
            err instanceof Error
              ? err.message
              : 'Sorry, study AI is temporarily unavailable. Try again shortly.',
        },
      ]);
    } finally {
      setChatBusy(false);
      window.setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
      }, 60);
    }
  };

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setTicketStatusMsg(null);
    if (ticketMessage.trim().length < 4) {
      setTicketStatusMsg({
        type: 'err',
        text: 'Please describe the issue (at least 4 characters).',
      });
      return;
    }

    setTicketBusy(true);
    try {
      await createSupportTicket({
        uid: student.uid,
        loginId: student.loginId,
        studentName: student.displayName,
        targetPost: student.targetPost || 'SSC CGL',
        subject: ticketSubject.trim() || 'Platform Bug / Support',
        message: ticketMessage.trim(),
      });
      setTicketSubject('');
      setTicketMessage('');
      setTicketStatusMsg({
        type: 'ok',
        text: 'Ticket sent to Admin! You will get an instant notification once resolved.',
      });
    } catch (err) {
      setTicketStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to send ticket.',
      });
    } finally {
      setTicketBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 no-print">
      {open && (
        <section
          role="dialog"
          aria-label="Study AI and Admin Support Chat"
          className="mb-3 flex h-[470px] w-[min(92vw,370px)] flex-col overflow-hidden rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#181d27] shadow-2xl"
        >
          {/* Header + Two Tabs */}
          <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] px-4 pt-3 pb-2.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Study AI &amp; Admin Support
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close support chat"
                className="rounded-md p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200/70 dark:bg-[#1e2431] p-1">
              <button
                type="button"
                onClick={() => setTab('ai')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  tab === 'ai'
                    ? 'bg-white dark:bg-[#141923] text-blue-700 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                <span>AI Chatbot</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('support')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  tab === 'support'
                    ? 'bg-white dark:bg-[#141923] text-blue-700 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Headset className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Admin Support ({myTickets.length})</span>
              </button>
            </div>
          </div>

          {/* Tab 1: AI Chatbot */}
          {tab === 'ai' && (
            !aiTutorEnabled ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3 bg-white dark:bg-[#181d27]">
                <Bot className="h-8 w-8 text-slate-400" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Study AI Tutor Paused
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    The AI study tutor is currently disabled in platform settings. You can still message your mentor via Admin Support.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTab('support')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
                >
                  <Headset className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Open Admin Support</span>
                </button>
              </div>
            ) : (
            <>
              <div
                ref={chatScrollRef}
                className="flex-1 overflow-y-auto p-3.5 space-y-2.5 bg-white dark:bg-[#181d27]"
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-blue-700 text-white'
                          : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {chatBusy && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#131720] px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#141923] p-3 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {['Trigonometry identities', 'How is XP awarded?'].map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={chatBusy}
                      onClick={() => void sendAiMessage(q)}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e2431] px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendAiMessage(chatInput);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask study doubt or platform question..."
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={chatBusy || !chatInput.trim()}
                    aria-label="Send message to AI"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </form>
              </div>
            </>
            )
          )}

          {/* Tab 2: Admin Support (Ticketing) */}
          {tab === 'support' && (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              <form onSubmit={handleSubmitTicket} className="space-y-2.5">
                <div>
                  <label
                    htmlFor="support-subject"
                    className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Issue Title (Optional)
                  </label>
                  <input
                    id="support-subject"
                    type="text"
                    maxLength={120}
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="e.g., Question Hindi text or Button issue"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="support-message"
                    className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Describe Bug / Problem
                  </label>
                  <textarea
                    id="support-message"
                    rows={3}
                    maxLength={1000}
                    value={ticketMessage}
                    onChange={(e) => setTicketMessage(e.target.value)}
                    placeholder="e.g., sir ye work nahi kar raha..."
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#11151d] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                {ticketStatusMsg && (
                  <p
                    className={`rounded-lg border px-2.5 py-2 text-[11px] font-medium ${
                      ticketStatusMsg.type === 'ok'
                        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                        : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
                    }`}
                  >
                    {ticketStatusMsg.text}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={ticketBusy}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{ticketBusy ? 'Submitting Ticket...' : 'Send Bug Report to Admin'}</span>
                </button>
              </form>

              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Your Support Tickets ({myTickets.length})
                </h3>
                {myTickets.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No bug reports submitted yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {myTickets.map((t) => (
                      <li
                        key={t.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#131720] p-2.5 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {t.subject}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              t.status === 'resolved'
                                ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                                : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                            }`}
                          >
                            {t.status === 'resolved' ? 'Resolved' : 'Open'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">{t.message}</p>
                        {t.adminReply && (
                          <div className="rounded border border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50/70 dark:bg-emerald-950/25 px-2 py-1 text-[11px] text-emerald-900 dark:text-emerald-200 flex items-start gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>Admin: {t.adminReply}</span>
                          </div>
                        )}
                        <div className="font-mono text-[10px] text-slate-400">
                          {formatDateTimeShort(t.createdAtMs)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Floating Toggle Button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open Study AI and Admin Support chat"
          className="relative inline-flex items-center gap-2 rounded-full bg-blue-700 hover:bg-blue-800 px-4 py-3 text-xs font-bold text-white shadow-lg cursor-pointer transition-colors"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">AI &amp; Support</span>
          {resolvedUnreadCount > 0 && (
            <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 font-mono text-[10px] font-bold text-slate-950">
              {resolvedUnreadCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
