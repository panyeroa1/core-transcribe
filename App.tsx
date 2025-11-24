import React, { useState } from 'react';
import { AppMode } from './types';
import { LiveAgent } from './components/LiveAgent';
import { BatchTranscriber } from './components/BatchTranscriber';
import { FastChat } from './components/FastChat';
import { MicrophoneIcon, ChatBubbleLeftRightIcon, BoltIcon, GlobeAltIcon } from '@heroicons/react/24/outline';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.LIVE);

  return (
    <div className="h-screen w-full flex flex-col bg-slate-950 text-slate-200 font-sans">
      {/* Top Status Bar (Decoration) */}
      <div className="h-1 w-full bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600"></div>
      <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <GlobeAltIcon className="w-5 h-5 text-cyan-500" />
            <span className="font-mono font-bold tracking-widest text-lg text-slate-100">EBURON</span>
          </div>
          <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
             <span className="text-xs font-mono text-slate-500">ONLINE</span>
          </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {mode === AppMode.LIVE && <LiveAgent />}
        {mode === AppMode.TRANSCRIBE && <BatchTranscriber />}
        {mode === AppMode.FAST_CHAT && <FastChat />}
      </div>

      {/* Bottom Navigation (Mobile First Sticky) */}
      <nav className="bg-slate-900 border-t border-slate-800 pb-safe">
        <div className="flex justify-around items-center h-16">
          <button 
            onClick={() => setMode(AppMode.LIVE)}
            className={`flex flex-col items-center gap-1 w-full h-full justify-center transition-all ${mode === AppMode.LIVE ? 'text-cyan-400 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <MicrophoneIcon className="w-6 h-6" />
            <span className="text-[10px] uppercase font-bold tracking-wider">Live</span>
          </button>
          
          <button 
            onClick={() => setMode(AppMode.TRANSCRIBE)}
            className={`flex flex-col items-center gap-1 w-full h-full justify-center transition-all ${mode === AppMode.TRANSCRIBE ? 'text-cyan-400 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <ChatBubbleLeftRightIcon className="w-6 h-6" />
            <span className="text-[10px] uppercase font-bold tracking-wider">Transcribe</span>
          </button>

          <button 
            onClick={() => setMode(AppMode.FAST_CHAT)}
            className={`flex flex-col items-center gap-1 w-full h-full justify-center transition-all ${mode === AppMode.FAST_CHAT ? 'text-cyan-400 bg-slate-800/50' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <BoltIcon className="w-6 h-6" />
            <span className="text-[10px] uppercase font-bold tracking-wider">Fast Chat</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;
