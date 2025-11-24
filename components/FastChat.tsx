import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { PaperAirplaneIcon, BoltIcon } from '@heroicons/react/24/solid';
import { saveTranscript } from '../utils/supabaseClient';
import { Message } from '../types';

const LITE_MODEL = 'gemini-flash-lite-latest';

export const FastChat: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
      { id: '1', role: 'system', text: 'EBURON Fast Response Unit online. Using Gemini Flash Lite.', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userText = input;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: userText, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);
    
    // Save User Msg
    saveTranscript(userText, 'user', 'chat');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      // We use generateContent for single turn speed, or could use Chat. maintaining history manually for simplicity here
      const history = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
      }));

      const chat = ai.chats.create({
          model: LITE_MODEL,
          history: history,
          config: {
              systemInstruction: "You are Eburon. Answer concisely and extremely fast.",
          }
      });

      const result = await chat.sendMessage({ message: userText });
      const modelText = result.text || "No response received.";
      
      const responseMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          text: modelText,
          timestamp: new Date()
      };
      setMessages(prev => [...prev, responseMsg]);
      
      // Save Model Msg
      saveTranscript(modelText, 'model', 'chat');

    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { id: 'err', role: 'system', text: 'Communication failure.', timestamp: new Date() }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10 flex items-center gap-2">
            <BoltIcon className="w-5 h-5 text-yellow-400" />
            <h2 className="text-sm font-mono text-slate-300 tracking-wider">LITE_SPEED_LINK</h2>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                     <div className={`max-w-[80%] p-3 rounded-lg text-sm ${
                         m.role === 'user' 
                         ? 'bg-cyan-700 text-white rounded-tr-none' 
                         : m.role === 'system'
                         ? 'bg-transparent text-slate-500 font-mono text-xs border border-slate-800'
                         : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none'
                     }`}>
                         {m.text}
                     </div>
                </div>
            ))}
            {isThinking && (
                 <div className="flex justify-start">
                    <div className="bg-slate-800 p-3 rounded-lg rounded-tl-none border border-slate-700 flex gap-1">
                        <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce delay-75"></div>
                        <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce delay-150"></div>
                    </div>
                 </div>
            )}
            <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-4 bg-slate-800 border-t border-slate-700">
            <div className="flex gap-2">
                <input 
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Execute command..."
                    className="flex-1 bg-slate-900 border border-slate-600 text-white rounded-lg px-4 py-2 focus:outline-none focus:border-cyan-500 font-mono text-sm"
                />
                <button 
                    onClick={sendMessage}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg transition-colors"
                >
                    <PaperAirplaneIcon className="w-5 h-5" />
                </button>
            </div>
        </div>
    </div>
  );
};