'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type RecommendationProfile = {
  age_group?: string;
  gender?: string;
  experience_level?: string;
  play_style?: string;
  budget_range?: string;
};

type AssessmentStep = {
  key: keyof RecommendationProfile;
  question: string;
  options: Array<{
    label: string;
    value: string;
  }>;
};

const RECOMMENDATION_COMPLETE_MESSAGE = '__recommendation_assessment_complete__';

type ProductLink = {
  linkText?: string;
  href: string;
};

// The model is instructed to use a plain Product link line, but it may wrap
// the line in Markdown bold or include it in a bullet with listing details.
export function parseProductLink(line: string): ProductLink | null {
  const normalized = line
    .trim()
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^[*\-]\s+/, '')
    .trim();
  const productLink = normalized.match(/^Product link:\s*(.+)$/i);
  if (!productLink) return null;

  const details = productLink[1].split('|').map((part) => part.trim());
  const href = [...details].reverse().find((part) => /^\/products\/\d+$/.test(part));
  if (!href) return null;

  return details[0] === href ? { href } : { linkText: details[0], href };
}

const assessmentSteps: AssessmentStep[] = [
  {
    key: 'age_group',
    question: 'What is your age group?',
    options: [
      { label: 'Under 13', value: 'under-13' },
      { label: '13-17', value: '13-17' },
      { label: '18-25', value: '18-25' },
      { label: '26-35', value: '26-35' },
      { label: '36-45', value: '36-45' },
      { label: '46+', value: '46+' },
    ],
  },
  {
    key: 'gender',
    question: 'What is your gender?',
    options: [
      { label: 'Male', value: 'male' },
      { label: 'Female', value: 'female' },
      { label: 'Prefer not to say', value: 'prefer_not_to_say' },
    ],
  },
  {
    key: 'experience_level',
    question: 'How long have you been playing badminton?',
    options: [
      { label: 'Less than 6 months', value: 'less_than_6_months' },
      { label: '6 months - 1 year', value: '6_months-1_year' },
      { label: '1 - 3 years', value: '1-3_years' },
      { label: '3 - 5 years', value: '3-5_years' },
      { label: 'More than 5 years', value: 'more_than_5_years' },
    ],
  },
  {
    key: 'play_style',
    question: 'What is your play style?',
    options: [
      { label: 'Attacking', value: 'attacking' },
      { label: 'Defensive', value: 'defensive' },
      { label: 'Balanced', value: 'balanced' },
      { label: 'Not sure', value: 'not_sure' },
    ],
  },
  {
    key: 'budget_range',
    question: 'What budget range should I stay within?',
    options: [
      { label: 'Under RM200', value: 'under-200' },
      { label: 'RM200 - RM400', value: '200-400' },
      { label: 'RM400 - RM700', value: '400-700' },
      { label: 'RM700+', value: '700+' },
    ],
  },
];

export default function AIFloatingChat() {
  const { user, loading, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [assessmentStepIndex, setAssessmentStepIndex] = useState<number | null>(null);
  const [recommendationProfile, setRecommendationProfile] = useState<RecommendationProfile>({});
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentAssessmentStep = assessmentStepIndex === null ? null : assessmentSteps[assessmentStepIndex];

  // Auto-scroll to latest message
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  // RacketBot is login-only. When the session ends, close the panel and drop
  // the transcript so the next account to log in on this browser never sees
  // the previous one's conversation.
  useEffect(() => {
    if (!user) {
      setIsOpen(false);
      setMessages([]);
      setInputValue('');
      setAssessmentStepIndex(null);
      setRecommendationProfile({});
    }
  }, [user]);

  const suggestedPrompts = [
    "Find me a stiff racket under RM500",
    "How do I contact a seller?",
    "What does 3U weight mean?",
    "How do I post an ad?"
  ];

  const streamChatResponse = async (
    requestMessage: string,
    visibleHistory: Message[],
    profile?: RecommendationProfile
  ) => {
    try {
      const token = localStorage.getItem('token') || '';
      const configuredApiURL = process.env.NEXT_PUBLIC_API_URL?.trim() || '';
      const apiURL = configuredApiURL.replace(/\/$/, '');
      
      const requestBody = JSON.stringify({
        message: requestMessage,
        // Send last 10 messages as history context (windowing)
        history: visibleHistory.slice(-10),
        ...(profile ? { recommendationProfile: profile } : {})
      });
      const sendRequest = (authToken: string) => fetch(
        `${apiURL}/api/v1/ai/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
          },
          body: requestBody
        }
      );

      const response = await sendRequest(token);
      if (response.status === 401) {
        // RacketBot is login-only, so there is no guest request to retry with.
        // Clear the stale browser auth state; the logout drops `user`, which
        // unmounts this panel and leaves the visitor on the logged-out site.
        logout();
        return;
      }

      if (!response.ok) {
        throw new Error(`API returned HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Streaming response body is missing');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let aiResponseText = '';
      let sseBuffer = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        sseBuffer += value
          ? decoder.decode(value, { stream: !doneReading })
          : decoder.decode();
        const events = sseBuffer.split(/\r?\n\r?\n/);
        sseBuffer = events.pop() || '';

        for (const event of events) {
          const dataLine = event
            .split(/\r?\n/)
            .find((line) => line.startsWith('data: '));
          if (!dataLine) continue;

          const dataStr = dataLine.slice(6).trim();
          if (dataStr === '[DONE]') {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(dataStr);
            const tokenVal = parsed.token || '';
            aiResponseText += tokenVal;

            // Update the last message (AI bubble) in real time
            setMessages((prev) => {
              const newMsgs = [...prev];
              if (newMsgs.length > 0) {
                newMsgs[newMsgs.length - 1] = {
                  role: 'assistant',
                  content: aiResponseText
                };
              }
              return newMsgs;
            });
          } catch (e) {
            console.error('Invalid AI stream event:', e);
          }
        }
        if (doneReading) {
          done = true;
        }
      }
    } catch (error) {
      console.error('Error fetching stream:', error);
      setMessages((prev) => {
        const newMsgs = [...prev];
        if (newMsgs.length > 0) {
          newMsgs[newMsgs.length - 1] = {
            role: 'assistant',
            content: "Sorry Boss, something went wrong trying to connect. Please make sure the AI service is running and try again lah."
          };
        }
        return newMsgs;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading || assessmentStepIndex !== null) return;

    const updatedMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages([...updatedMessages, { role: 'assistant', content: '' }]);
    setInputValue('');
    setIsLoading(true);

    await streamChatResponse(text, updatedMessages);
  };

  const startAssessment = () => {
    if (isLoading) return;

    setRecommendationProfile({});
    setAssessmentStepIndex(0);
    setInputValue('');
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `Let's find the right racket for you, Boss.\n\n${assessmentSteps[0].question}`,
      },
    ]);
  };

  const handleAssessmentAnswer = async (option: { label: string; value: string }) => {
    if (assessmentStepIndex === null || isLoading) return;

    const step = assessmentSteps[assessmentStepIndex];
    const nextProfile = {
      ...recommendationProfile,
      [step.key]: option.value,
    };
    const withAnswer: Message[] = [...messages, { role: 'user', content: option.label }];
    const nextStepIndex = assessmentStepIndex + 1;

    setRecommendationProfile(nextProfile);

    if (nextStepIndex < assessmentSteps.length) {
      setAssessmentStepIndex(nextStepIndex);
      setMessages([
        ...withAnswer,
        { role: 'assistant', content: assessmentSteps[nextStepIndex].question },
      ]);
      return;
    }

    setAssessmentStepIndex(null);
    setMessages([
      ...withAnswer,
      { role: 'assistant', content: 'Thanks Boss. I am matching your profile with current marketplace rackets now.' },
      { role: 'assistant', content: '' },
    ]);
    setIsLoading(true);

    await streamChatResponse(RECOMMENDATION_COMPLETE_MESSAGE, withAnswer, nextProfile);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage(inputValue);
  };

  // Helper to parse content text and inject action buttons dynamically
  const renderMessageContent = (content: string) => {
    const renderInlineMarkdown = (text: string) => {
      const parts = text.split('**');
      if (parts.length === 1) {
        return text;
      }
      return parts.map((part, idx) => (
        idx % 2 === 1 ? <strong key={`b-${idx}`}>{part}</strong> : part
      ));
    };

    // Find Racket ID matches (e.g. "Racket ID: 3")
    const racketMatch = content.match(/Racket ID:\s*(\d+)/i);
    const orderMatch = content.match(/Order #\s*(\d+)/i);
    const hasProductLinks = /^(?:[*-]\s*)?Product link:/im.test(content);
    const postAdMatch = /\b(post an ad|create (?:a )?listing|list (?:my|your) racket|start selling|sell (?:my|your) racket)\b/i.test(content);
    
    const lines = content.split('\n');
    const formattedText: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];
    let listIndex = 0;

    const flushList = () => {
      if (listItems.length > 0) {
        formattedText.push(
          <ul key={`ul-${listIndex++}`}>
            {listItems}
          </ul>
        );
        listItems = [];
      }
    };

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }

      const productLink = parseProductLink(trimmed);
      if (productLink) {
        flushList();
        formattedText.push(
          <a
            key={`product-link-${i}`}
            href={productLink.href}
            className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-2 bg-[linear-gradient(135deg,#059669_0%,#10b981_100%)] text-white border-none rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-200 no-underline hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(16,185,129,0.3)]"
            target="_blank"
            rel="noopener noreferrer"
          >
            Product link: {productLink.linkText ?? productLink.href}
          </a>
        );
        return;
      }

      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        const itemText = trimmed.replace(/^[\*\-]\s+/, '');
        listItems.push(
          <li key={`li-${i}`}>{renderInlineMarkdown(itemText)}</li>
        );
        return;
      }

      flushList();
      formattedText.push(
        <p key={`p-${i}`}>{renderInlineMarkdown(line)}</p>
      );
    });

    flushList();

    return (
      <div className="text-[#f8fafc] text-[13.5px] leading-[1.55] [&_strong]:text-white [&_strong]:font-bold">
        {formattedText}
        
        {/* Render quick navigation actions based on AI suggestions */}
        {racketMatch && !hasProductLinks && (
          <a
            href={`/products/${racketMatch[1]}`}
            className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-2 bg-[linear-gradient(135deg,#059669_0%,#10b981_100%)] text-white border-none rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-200 no-underline hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(16,185,129,0.3)]"
            target="_blank"
            rel="noopener noreferrer"
          >
            🏸 View Racket #{racketMatch[1]} →
          </a>
        )}
        
        {postAdMatch && (
          <Link href="/sell" className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-2 bg-[linear-gradient(135deg,#059669_0%,#10b981_100%)] text-white border-none rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-200 no-underline hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(16,185,129,0.3)]">
            ➕ Post an Ad Now →
          </Link>
        )}

        {content.toLowerCase().includes("browse") && (
          <Link href="/products" className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-2 bg-[linear-gradient(135deg,#059669_0%,#10b981_100%)] text-white border-none rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-200 no-underline hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(16,185,129,0.3)]">
            🔎 Browse Marketplace →
          </Link>
        )}
      </div>
    );
  };

  // Login-only feature: render nothing at all for signed-out visitors, and
  // stay hidden while AuthContext is still restoring the session so the button
  // never flashes in and out on a page load.
  if (loading || !user) {
    return null;
  }

  return (
    <div className="fixed bottom-[90px] right-6 z-[1000] font-[inherit]">
      {/* Floating Trigger Button */}
      <button 
        className="w-[60px] h-[60px] rounded-full bg-[linear-gradient(135deg,#00f2fe_0%,#4facfe_100%)] border-none text-white text-[28px] cursor-pointer shadow-[0_8px_32px_rgba(79,172,254,0.4)] flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] relative hover:scale-110 hover:rotate-[5deg] hover:shadow-[0_12px_40px_rgba(79,172,254,0.6)] active:scale-95" 
        onClick={() => setIsOpen(!isOpen)}
        title="RacketBot AI Help"
      >
        🤖
        {!isOpen && <div className="absolute inset-0 rounded-full border-2 border-[#00f2fe] animate-[aiPulseRing_2s_infinite] pointer-events-none"></div>}
      </button>

      {/* Floating Chat Box Window */}
      <div className={`absolute bottom-20 right-0 w-[380px] h-[560px] bg-[rgba(15,23,42,0.85)] backdrop-blur-[20px] border border-white/10 rounded-[20px] shadow-[0_20px_50px_rgba(0,0,0,0.4)] flex flex-col overflow-hidden transition-all duration-[400ms] ease-[cubic-bezier(0.165,0.84,0.44,1)] origin-bottom-right max-[480px]:w-[calc(100vw-32px)] max-[480px]:-right-2 max-[480px]:h-[480px] ${isOpen ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' : 'opacity-0 scale-[0.8] translate-y-5 pointer-events-none'}`}>
        
        {/* Header */}
        <div className="bg-[linear-gradient(135deg,rgba(15,23,42,0.95)_0%,rgba(30,41,59,0.95)_100%)] px-5 py-4 flex items-center justify-between border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="w-[38px] h-[38px] rounded-full bg-[linear-gradient(135deg,#00f2fe_0%,#4facfe_100%)] flex items-center justify-center text-xl shadow-[0_4px_12px_rgba(0,242,254,0.3)]">🏸</div>
            <div className="flex flex-col">
              <h3 className="text-white text-[15px] font-bold m-0 flex items-center gap-1.5">
                RacketBot <span className="w-2 h-2 bg-[#10b981] rounded-full inline-block shadow-[0_0_8px_#10b981] animate-[aiGlow_1.5s_infinite_ease-in-out]"></span>
              </h3>
              <p className="text-[#94a3b8] text-[11px] m-0">RacketDiction AI Assistant (Malaysian) </p>
            </div>
          </div>
          <button className="bg-transparent border-none text-[#94a3b8] text-xl cursor-pointer w-[30px] h-[30px] rounded-full flex items-center justify-center transition-all duration-200 hover:bg-white/[0.08] hover:text-white" onClick={() => setIsOpen(false)}>
            &times;
          </button>
        </div>

        {/* Messages Body */}
        <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-4 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded">
          {messages.length === 0 ? (
            <div className="bg-[rgba(30,41,59,0.4)] border border-white/[0.06] rounded-2xl p-[18px] text-center text-[#e2e8f0] animate-[slideUp_0.4s_ease-out]">
              <h3 className="mt-0 mx-0 mb-1.5 text-base font-bold bg-[linear-gradient(135deg,#00f2fe_0%,#4facfe_100%)] bg-clip-text text-transparent">Selamat Datang, Boss! 👋</h3>
              <p className="mt-0 mx-0 mb-4 text-xs text-[#94a3b8] leading-[1.5]">
                I am RacketBot, your badminton assistant. Ask me to find rackets, 
                explain weight metrics (3U vs 4U), check order status, or explain how platform buying works lah!
              </p>
              <button
                type="button"
                className="w-full border border-[rgba(16,185,129,0.42)] rounded-[10px] px-3 py-2.5 bg-[linear-gradient(135deg,#047857_0%,#10b981_100%)] text-white text-xs font-bold cursor-pointer transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:shadow-[0_6px_16px_rgba(16,185,129,0.25)] disabled:bg-[#334155] disabled:border-white/[0.08] disabled:text-[#94a3b8] disabled:cursor-not-allowed"
                onClick={startAssessment}
                disabled={isLoading}
              >
                Recommend Me a Racket
              </button>
              
              <div className="flex flex-col gap-2 mt-2.5 animate-[fadeIn_0.5s_ease-out]">
                <p className="text-[#64748b] text-[11px] font-semibold uppercase tracking-[0.5px] mb-0.5">Suggested Prompts</p>
                {suggestedPrompts.map((prompt, idx) => (
                  <button 
                    key={idx} 
                    className="bg-[rgba(30,41,59,0.6)] border border-white/[0.05] rounded-xl px-3.5 py-2.5 text-[#e2e8f0] text-[12.5px] cursor-pointer text-left transition-all duration-200 hover:bg-[rgba(79,172,254,0.15)] hover:border-[rgba(0,242,254,0.3)] hover:text-[#00f2fe] hover:translate-x-1"
                    onClick={() => handleSendMessage(prompt)}
                  >
                    {`💡 "${prompt}"`}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div 
                key={idx} 
                className={`flex w-full ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div 
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-[13.5px] leading-[1.5] break-words shadow-[0_2px_10px_rgba(0,0,0,0.1)] animate-[bubblePop_0.3s_cubic-bezier(0.175,0.885,0.32,1.1)] ${
                    msg.role === 'user' ? 'bg-[linear-gradient(135deg,#4facfe_0%,#00f2fe_100%)] text-white rounded-br-[4px]' : 'bg-[rgba(17,24,39,0.92)] text-[#f8fafc] border border-white/[0.06] rounded-bl-[4px] [&_*]:text-[#f8fafc] [&_p]:mt-0 [&_p]:mx-0 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mt-0 [&_ul]:mx-0 [&_ul]:mb-2 [&_ul]:pl-5 [&_ol]:mt-0 [&_ol]:mx-0 [&_ol]:mb-2 [&_ol]:pl-5 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_li]:mb-1'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p style={{ margin: 0 }}>{msg.content}</p>
                  ) : (
                    renderMessageContent(msg.content)
                  )}
                </div>
              </div>
            ))
          )}

          {currentAssessmentStep && (
            <div className="flex flex-wrap gap-2 pl-0.5">
              {currentAssessmentStep.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="flex-[1_1_calc(50%-8px)] min-w-[128px] min-h-[36px] border border-[rgba(0,242,254,0.26)] rounded-lg px-2.5 py-2 bg-[rgba(30,41,59,0.82)] text-[#e2e8f0] text-xs font-semibold cursor-pointer transition-all duration-200 enabled:hover:bg-[rgba(79,172,254,0.18)] enabled:hover:border-[rgba(0,242,254,0.5)] enabled:hover:text-white disabled:text-[#64748b] disabled:cursor-not-allowed"
                  onClick={() => handleAssessmentAnswer(option)}
                  disabled={isLoading}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          
          {isLoading && messages[messages.length - 1]?.content === '' && (
            <div className="flex w-full justify-start">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl text-[13.5px] leading-[1.5] break-words shadow-[0_2px_10px_rgba(0,0,0,0.1)] animate-[bubblePop_0.3s_cubic-bezier(0.175,0.885,0.32,1.1)] bg-[rgba(17,24,39,0.92)] text-[#f8fafc] border border-white/[0.06] rounded-bl-[4px] [&_*]:text-[#f8fafc] [&_p]:mt-0 [&_p]:mx-0 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mt-0 [&_ul]:mx-0 [&_ul]:mb-2 [&_ul]:pl-5 [&_ol]:mt-0 [&_ol]:mx-0 [&_ol]:mb-2 [&_ol]:pl-5 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_li]:mb-1">
                <div className="flex gap-1 px-2 py-1 items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-[#94a3b8] rounded-full animate-[aiTypingBounce_1.4s_infinite_ease-in-out_both] [animation-delay:-0.32s]"></div>
                  <div className="w-1.5 h-1.5 bg-[#94a3b8] rounded-full animate-[aiTypingBounce_1.4s_infinite_ease-in-out_both] [animation-delay:-0.16s]"></div>
                  <div className="w-1.5 h-1.5 bg-[#94a3b8] rounded-full animate-[aiTypingBounce_1.4s_infinite_ease-in-out_both]"></div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Box Input Footer */}
        <div className="px-5 py-4 bg-[rgba(15,23,42,0.95)] border-t border-white/[0.08]">
          {assessmentStepIndex === null && (
            <button
              type="button"
              className="w-full mb-2.5 border border-[rgba(16,185,129,0.34)] rounded-lg px-2.5 py-2 bg-[rgba(5,150,105,0.18)] text-[#d1fae5] text-xs font-bold cursor-pointer transition-all duration-200 enabled:hover:bg-[rgba(16,185,129,0.28)] enabled:hover:border-[rgba(16,185,129,0.58)] disabled:text-[#64748b] disabled:border-white/[0.08] disabled:cursor-not-allowed"
              onClick={startAssessment}
              disabled={isLoading}
            >
              Recommend Me a Racket
            </button>
          )}
          <form onSubmit={handleFormSubmit} className="flex gap-2.5 items-center bg-[rgba(30,41,59,0.7)] border border-white/[0.08] rounded-xl pt-1 pr-1.5 pb-1 pl-3.5 transition-all duration-300 focus-within:border-[#00f2fe] focus-within:shadow-[0_0_12px_rgba(0,242,254,0.2)] focus-within:bg-[rgba(30,41,59,0.9)]">
            <input 
              type="text" 
              className="flex-1 bg-transparent border-none text-white text-[13px] outline-none py-2 placeholder:text-[#64748b]"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={assessmentStepIndex === null ? 'Ask RacketBot anything, Boss...' : 'Choose an assessment option above...'}
              disabled={isLoading || assessmentStepIndex !== null}
            />
            <button 
              type="submit" 
              className="w-8 h-8 rounded-lg bg-[linear-gradient(135deg,#00f2fe_0%,#4facfe_100%)] border-none text-white cursor-pointer flex items-center justify-center transition-all duration-200 enabled:hover:scale-105 enabled:hover:shadow-[0_4px_10px_rgba(0,242,254,0.3)] disabled:bg-[#334155] disabled:text-[#64748b] disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none"
              disabled={!inputValue.trim() || isLoading || assessmentStepIndex !== null}
            >
              🚀
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
