import React, { useState, useRef, useEffect } from 'react';
import { getChatResponse } from '../services/aiService';
import { useApiStatus } from '../hooks/useApiStatus';
import type { ChatMessage } from '../types';

const ChatView: React.FC = () => {
  const { isAvailable: hasApiKey, isLoading: isApiLoading, error: apiError } = useApiStatus();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  // Set initial message based on API availability
  useEffect(() => {
    if (!isApiLoading && messages.length === 0) {
      const initialMessage: ChatMessage = {
        role: 'assistant',
        text: hasApiKey
          ? "Hello! I am your geospatial analyst for the San Joaquin Valley. How can I help you today? You can ask me about air quality, weather patterns, or their connections."
          : apiError || "⚠️ Backend services are not running. Start them with 'docker compose up' and ensure ANTHROPIC_API_KEY is configured in your .env file."
      };
      setMessages([initialMessage]);
    }
  }, [isApiLoading, hasApiKey, apiError, messages.length]);

  const handleSend = async () => {
    if (input.trim() === '' || isLoading || !hasApiKey) return;

    const userMessage: ChatMessage = { role: 'user', text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const responseText = await getChatResponse(input);
      const modelMessage: ChatMessage = { role: 'assistant', text: responseText };
      setMessages(prev => [...prev, modelMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = { role: 'assistant', text: 'Sorry, I encountered an error. Please try again.' };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-lg p-3 rounded-lg ${
                msg.role === 'user' ? 'bg-brand-primary text-white' : 'bg-brand-bg-lighter text-slate-200'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
             <div className="max-w-lg p-3 rounded-lg bg-brand-bg-lighter text-slate-200">
                <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t border-brand-bg-lighter">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about the San Joaquin Valley..."
            className="flex-1 p-2 bg-brand-bg-lighter border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !hasApiKey}
            className="px-4 py-2 bg-brand-primary text-white rounded-md hover:bg-sky-600 disabled:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={!hasApiKey ? "Start the backend server to enable chat" : ""}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatView;
