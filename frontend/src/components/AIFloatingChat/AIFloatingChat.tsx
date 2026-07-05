'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import styles from './AIFloatingChat.module.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AIFloatingChat() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    // 1. Add User Message
    const updatedMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(updatedMessages);
    setInputValue('');
    setIsLoading(true);

    // Add placeholder for streaming AI response
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const token = localStorage.getItem('token') || (user ? `token_${user.id}` : '');
      const configuredApiURL = process.env.NEXT_PUBLIC_API_URL?.trim() || '';
      const apiURL = /^https?:\/\/localhost:8080\/?$/.test(configuredApiURL)
        ? ''
        : configuredApiURL.replace(/\/$/, '');
      
      const response = await fetch(`${apiURL}/api/v1/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          message: text,
          // Send last 10 messages as history context (windowing)
          history: updatedMessages.slice(-10)
        })
      });

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

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          // Split SSE lines by double newline or single newline
          const lines = chunk.split('\n');
          for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine.startsWith('data: ')) {
              const dataStr = cleanLine.slice(6);
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
                // Ignore incomplete lines during chunk breaks
              }
            }
          }
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
        {racketMatch && (
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
          <form onSubmit={handleFormSubmit} className={styles.inputForm}>
            <input 
              type="text" 
              className={styles.textInput}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask RacketBot anything, Boss..."
              disabled={isLoading}
            />
            <button 
              type="submit" 
              className={styles.sendButton}
              disabled={!inputValue.trim() || isLoading}
            >
              🚀
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
