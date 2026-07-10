'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import styles from './AIFloatingChat.module.css';

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
  const { logout } = useAuth();
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
      const apiURL = /^https?:\/\/localhost:8080\/?$/.test(configuredApiURL)
        ? ''
        : configuredApiURL.replace(/\/$/, '');
      
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

      let response = await sendRequest(token);
      if (response.status === 401 && token) {
        // Guest AI chat is supported. Expire stale browser auth state and retry
        // once without credentials; private tools will remain unavailable.
        logout();
        response = await sendRequest('');
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
    const hasProductLinks = /^Product link:/im.test(content);
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

      const productLinkMatch = trimmed.match(/^Product link:\s*(.+?)\s*\|\s*(\S+)/i);
      if (productLinkMatch) {
        flushList();
        const linkText = productLinkMatch[1].trim();
        const href = productLinkMatch[2];
        formattedText.push(
          <a
            key={`product-link-${i}`}
            href={href}
            className={styles.actionBtn}
            target="_blank"
            rel="noopener noreferrer"
          >
            Product link: {linkText}
          </a>
        );
        return;
      }

      const productLinkFallback = trimmed.match(/^Product link:\s*(\S+)/i);
      if (productLinkFallback) {
        flushList();
        const href = productLinkFallback[1];
        formattedText.push(
          <a
            key={`product-link-${i}`}
            href={href}
            className={styles.actionBtn}
            target="_blank"
            rel="noopener noreferrer"
          >
            Product link: {href}
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
      <div className={styles.messageContent}>
        {formattedText}
        
        {/* Render quick navigation actions based on AI suggestions */}
        {racketMatch && !hasProductLinks && (
          <a
            href={`/products/${racketMatch[1]}`}
            className={styles.actionBtn}
            target="_blank"
            rel="noopener noreferrer"
          >
            🏸 View Racket #{racketMatch[1]} →
          </a>
        )}
        
        {postAdMatch && (
          <a href="/sell" className={styles.actionBtn}>
            ➕ Post an Ad Now →
          </a>
        )}

        {content.toLowerCase().includes("browse") && (
          <a href="/products" className={styles.actionBtn}>
            🔎 Browse Marketplace →
          </a>
        )}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Floating Trigger Button */}
      <button 
        className={styles.triggerButton} 
        onClick={() => setIsOpen(!isOpen)}
        title="RacketBot AI Help"
      >
        🤖
        {!isOpen && <div className={styles.pulseRing}></div>}
      </button>

      {/* Floating Chat Box Window */}
      <div className={`${styles.chatWindow} ${isOpen ? styles.chatWindowOpen : ''}`}>
        
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <div className={styles.avatar}>🏸</div>
            <div className={styles.titleContainer}>
              <h3 className={styles.title}>
                RacketBot <span className={styles.onlineDot}></span>
              </h3>
              <p className={styles.subtitle}>RacketDiction AI Assistant (Malaysian) </p>
            </div>
          </div>
          <button className={styles.closeButton} onClick={() => setIsOpen(false)}>
            &times;
          </button>
        </div>

        {/* Messages Body */}
        <div className={styles.messagesContainer}>
          {messages.length === 0 ? (
            <div className={styles.welcomeCard}>
              <h3>Selamat Datang, Boss! 👋</h3>
              <p>
                I am RacketBot, your badminton assistant. Ask me to find rackets, 
                explain weight metrics (3U vs 4U), check order status, or explain how platform buying works lah!
              </p>
              <button
                type="button"
                className={styles.recommendButton}
                onClick={startAssessment}
                disabled={isLoading}
              >
                Recommend Me a Racket
              </button>
              
              <div className={styles.suggestedPromptsContainer}>
                <p className={styles.suggestedTitle}>Suggested Prompts</p>
                {suggestedPrompts.map((prompt, idx) => (
                  <button 
                    key={idx} 
                    className={styles.promptCard}
                    onClick={() => handleSendMessage(prompt)}
                  >
                    💡 "{prompt}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div 
                key={idx} 
                className={`${styles.messageRow} ${
                  msg.role === 'user' ? styles.rowUser : styles.rowAI
                }`}
              >
                <div 
                  className={`${styles.bubble} ${
                    msg.role === 'user' ? styles.bubbleUser : styles.bubbleAI
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
            <div className={styles.assessmentOptions}>
              {currentAssessmentStep.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={styles.assessmentOption}
                  onClick={() => handleAssessmentAnswer(option)}
                  disabled={isLoading}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          
          {isLoading && messages[messages.length - 1]?.content === '' && (
            <div className={`${styles.messageRow} ${styles.rowAI}`}>
              <div className={`${styles.bubble} ${styles.bubbleAI}`}>
                <div className={styles.typingLoader}>
                  <div className={styles.dot}></div>
                  <div className={styles.dot}></div>
                  <div className={styles.dot}></div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Box Input Footer */}
        <div className={styles.inputFooter}>
          {assessmentStepIndex === null && (
            <button
              type="button"
              className={styles.footerRecommendButton}
              onClick={startAssessment}
              disabled={isLoading}
            >
              Recommend Me a Racket
            </button>
          )}
          <form onSubmit={handleFormSubmit} className={styles.inputForm}>
            <input 
              type="text" 
              className={styles.textInput}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={assessmentStepIndex === null ? 'Ask RacketBot anything, Boss...' : 'Choose an assessment option above...'}
              disabled={isLoading || assessmentStepIndex !== null}
            />
            <button 
              type="submit" 
              className={styles.sendButton}
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
