
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage } from '@google/genai';
import { float32ToInt16, base64ToArrayBuffer } from '../utils/audioUtils';
import { saveTranscript } from '../utils/supabaseClient';
import { Message } from '../types';
import { MicrophoneIcon, StopIcon, ComputerDesktopIcon, SparklesIcon, UserGroupIcon, UserIcon, CpuChipIcon, SpeakerWaveIcon, SpeakerXMarkIcon, LanguageIcon } from '@heroicons/react/24/solid';

const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

// Sub-component for rendering messages with potential speaker labels
const MessageBubble: React.FC<{ msg: Message, showOriginalOnly: boolean }> = ({ msg, showOriginalOnly }) => {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  
  // If showOriginalOnly is true, we might want to hide Model Translation messages if we can identify them.
  // For now, translation mode makes the model reply with translation. 
  // If we want to view "Original" only, we show User messages.
  // If we want "Both", we show User and Model.
  // But usually "Original" implies just the transcript. "Translated" implies the model's output.
  
  // Advanced parsing for speaker labels
  const parseSpeakerText = (text: string) => {
    // Regex to catch [Speaker 1], Speaker 1:, Speaker A:, etc.
    const speakerRegex = /^(\[?(?:Speaker|Voice)\s?\d+[\]:]?|[A-Za-z]+:)/i;
    
    // If the whole text starts with a speaker label, we treat it as one block
    // Otherwise we split by newlines to find interleaved speakers
    const lines = text.split('\n');
    
    return lines.map((line, i) => {
      const match = line.match(speakerRegex);
      if (match) {
        const speakerName = match[1].replace(/[:\[\]]/g, '').trim();
        const content = line.replace(match[0], '').trim();
        return (
          <div key={i} className="flex flex-col mb-2 last:mb-0">
             <span className="text-[10px] font-bold opacity-80 uppercase tracking-wider mb-0.5 flex items-center gap-1.5 text-cyan-200">
                <div className="w-4 h-4 rounded-full bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                    <UserIcon className="w-2.5 h-2.5" />
                </div>
                {speakerName}
             </span>
             <span className="pl-1">{content}</span>
          </div>
        );
      }
      return <div key={i} className={i > 0 ? "mt-1" : ""}>{line}</div>;
    });
  };

  if (isSystem) {
    return (
        <div className="flex justify-center my-2 animate-fade-in">
            <div className="bg-slate-800/80 backdrop-blur text-cyan-400 text-xs font-mono border border-slate-700 rounded-full px-4 py-1 shadow-sm flex items-center gap-2">
                <CpuChipIcon className="w-3 h-3" />
                {msg.text}
            </div>
        </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-in-up`}>
       <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-lg backdrop-blur-sm relative overflow-hidden ${
          isUser 
            ? 'bg-gradient-to-br from-cyan-600/90 to-cyan-800/90 text-white rounded-tr-sm border border-cyan-500/30' 
            : 'bg-slate-800/90 text-slate-100 border border-slate-700/50 rounded-tl-sm'
       }`}>
          {/* Decorative noise texture */}
          <div className="absolute inset-0 opacity-[0.03] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIi8+CjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMwMDAiLz4KPC9zdmc+')]"></div>
          
          <div className="relative z-10 text-sm leading-relaxed">
             {parseSpeakerText(msg.text)}
          </div>
          
          <div className="relative z-10 mt-1 flex justify-end">
             <span className="text-[10px] opacity-40 font-mono">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
             </span>
          </div>
       </div>
    </div>
  );
};

export const LiveAgent: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Message[]>([]);
  const [streamingInput, setStreamingInput] = useState(''); // New state for live user input
  const [volume, setVolume] = useState(0);
  const [useSystemAudio, setUseSystemAudio] = useState(false);
  const [diarizationEnabled, setDiarizationEnabled] = useState(true);
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [showOriginalOnly, setShowOriginalOnly] = useState(false);
  const [agentVolume, setAgentVolume] = useState(1.0);

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamsRef = useRef<MediaStream[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const turnLanguageDetectedRef = useRef(false);

  // Refs for current transcript accumulation
  const currentInputTransRef = useRef('');
  const currentOutputTransRef = useRef('');

  useEffect(() => {
    setTranscripts([{
      id: 'init',
      role: 'system',
      text: 'EBURON Live Core initialized. Configure audio and connect.',
      timestamp: new Date()
    }]);
    
    return () => cleanupAudio();
  }, []);

  useEffect(() => {
    if (transcriptContainerRef.current) {
        transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts, streamingInput]);

  const cleanupAudio = useCallback(() => {
    // Stop all media streams
    mediaStreamsRef.current.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
    });
    mediaStreamsRef.current = [];

    // Disconnect processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Close Audio Contexts
    if (inputContextRef.current?.state !== 'closed') {
        inputContextRef.current?.close();
    }
    if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
    }
    inputContextRef.current = null;
    audioContextRef.current = null;
    outputGainRef.current = null;

    // Close Session
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => {
          try { session.close(); } catch(e) { console.error("Session close error", e)}
      });
      sessionRef.current = null;
    }
    
    // Stop playing audio
    sourcesRef.current.forEach(source => {
        try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();

    setIsActive(false);
    nextStartTimeRef.current = 0;
    setVolume(0);
    setStreamingInput('');
    turnLanguageDetectedRef.current = false;
  }, []);

  const handleVolumeChange = (newVol: number) => {
    setAgentVolume(newVol);
    if (outputGainRef.current && audioContextRef.current) {
        outputGainRef.current.gain.setTargetAtTime(newVol, audioContextRef.current.currentTime, 0.1);
    }
  };

  const connect = async () => {
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // 1. Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const inCtx = new AudioContextClass({ sampleRate: 16000 });
      const outCtx = new AudioContextClass({ sampleRate: 24000 });
      inputContextRef.current = inCtx;
      audioContextRef.current = outCtx;

      // Setup Output Gain (Volume Control)
      const gainNode = outCtx.createGain();
      gainNode.gain.value = agentVolume;
      gainNode.connect(outCtx.destination);
      outputGainRef.current = gainNode;

      // 2. Setup Mixer
      const mixer = inCtx.createGain();

      // 3. Acquire Microphone (Mandatory)
      const micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
              echoCancellation: true,
              noiseSuppression: true,
              sampleRate: 16000,
              channelCount: 1
          } 
      });
      mediaStreamsRef.current.push(micStream);
      const micSource = inCtx.createMediaStreamSource(micStream);
      micSource.connect(mixer);

      // 4. Acquire System Audio (Optional)
      if (useSystemAudio) {
          try {
              const sysStream = await navigator.mediaDevices.getDisplayMedia({ 
                  video: true,
                  audio: {
                      echoCancellation: false,
                      autoGainControl: false,
                      noiseSuppression: false,
                      channelCount: 1
                  } 
              });
              mediaStreamsRef.current.push(sysStream);
              
              if (sysStream.getAudioTracks().length > 0) {
                  const sysSource = inCtx.createMediaStreamSource(sysStream);
                  sysSource.connect(mixer);
              } else {
                  console.warn("User did not share system audio.");
              }
          } catch (e) {
              console.warn("System audio selection cancelled or failed", e);
          }
      }

      // 5. Connect Mixer to Processor
      const processor = inCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      mixer.connect(processor);
      processor.connect(inCtx.destination); 

      // 6. Start Gemini Session
      
      const baseInstruction = `
      You are EBURON.
      
      CRITICAL LANGUAGE DETECTION PROTOCOL:
      1. Continuously analyze the language of the user's input audio.
      2. If you detect a language, YOU MUST start your textual response with [LANG:LanguageName] (e.g. [LANG:English], [LANG:Spanish], [LANG:Tagalog]).
      3. CRITICAL: DO NOT SPEAK this tag. It is for metadata only. The audio output must only contain your natural response.
      `;

      let systemInstruction = "";
      
      if (translationEnabled) {
          systemInstruction = `${baseInstruction}
          MODE: REAL-TIME TRANSLATOR.
          1. Translate the input audio into English (or the most logical target language).
          2. Output ONLY the translation text after the [LANG:...] tag.
          3. Do not converse.
          `;
      } else if (diarizationEnabled) {
         systemInstruction = `${baseInstruction}
          MODE: ADVANCED SPEAKER DIARIZATION.
          1. Actively identify distinct voices ([Speaker 1], [Speaker 2]).
          2. Prepend speaker labels to your text response (after the [LANG:...] tag).
          3. Example: "[LANG:English] [Speaker 1]: Hello."
          `;
      } else {
         systemInstruction = `${baseInstruction}
          MODE: ASSISTANT.
          1. Be helpful, concise, and speak naturally.
          `;
      }

      const config = {
        model: LIVE_MODEL,
        config: {
          responseModalities: ['AUDIO' as any], 
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };

      const sessionPromise = ai.live.connect({
        ...config,
        callbacks: {
          onopen: () => {
            console.log("EBURON Link Established");
            setIsActive(true);
            setTranscripts(prev => [...prev, {
                id: 'sys-start',
                role: 'system',
                text: translationEnabled ? 'Translator Mode Active.' : (diarizationEnabled ? 'Secure Link Established. Speaker ID Active.' : 'Secure Link Established.'),
                timestamp: new Date()
            }]);

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Volume Meter
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(rms);

              // PCM Conversion
              const pcm16 = float32ToInt16(inputData);
              const uint8 = new Uint8Array(pcm16.buffer);
              
              let binary = '';
              const len = uint8.byteLength;
              for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(uint8[i]);
              }
              const base64 = btoa(binary);

              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: {
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64
                  }
                });
              });
            };
          },
          onmessage: async (msg: LiveServerMessage) => {
             // Handle Audio Output
             const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (audioData && outCtx) {
                const bufferData = base64ToArrayBuffer(audioData);
                const int16Array = new Int16Array(bufferData);
                const float32Data = new Float32Array(int16Array.length);
                for (let i = 0; i < int16Array.length; i++) {
                    float32Data[i] = int16Array[i] / 32768.0;
                }

                const audioBuffer = outCtx.createBuffer(1, float32Data.length, 24000);
                audioBuffer.getChannelData(0).set(float32Data);

                const source = outCtx.createBufferSource();
                source.buffer = audioBuffer;
                
                // Connect through Gain Node for volume control
                if (outputGainRef.current) {
                    source.connect(outputGainRef.current);
                } else {
                    source.connect(outCtx.destination);
                }
                
                const now = outCtx.currentTime;
                const startTime = Math.max(now, nextStartTimeRef.current);
                source.start(startTime);
                nextStartTimeRef.current = startTime + audioBuffer.duration;
                
                sourcesRef.current.add(source);
                source.onended = () => sourcesRef.current.delete(source);
             }

             // Handle Transcription
             if (msg.serverContent?.outputTranscription) {
               const text = msg.serverContent.outputTranscription.text;
               currentOutputTransRef.current += text;

               // Parse Language Tag
               const langMatch = currentOutputTransRef.current.match(/^\[LANG:(.*?)\]/);
               if (langMatch && !turnLanguageDetectedRef.current) {
                   const detectedLang = langMatch[1];
                   setTranscripts(prev => [...prev, {
                       id: Date.now() + 'sys-lang',
                       role: 'system',
                       text: `Language Detected: ${detectedLang}`,
                       timestamp: new Date()
                   }]);
                   turnLanguageDetectedRef.current = true;
               }
             }

             if (msg.serverContent?.inputTranscription) {
               const text = msg.serverContent.inputTranscription.text;
               currentInputTransRef.current += text;
               setStreamingInput(currentInputTransRef.current); // Update streaming UI
             }

             if (msg.serverContent?.turnComplete) {
                if (currentInputTransRef.current.trim()) {
                  const text = currentInputTransRef.current;
                  setTranscripts(prev => [...prev, {
                    id: Date.now().toString() + 'u',
                    role: 'user',
                    text: text,
                    timestamp: new Date()
                  }]);
                  saveTranscript(text, 'user', 'live');
                  currentInputTransRef.current = '';
                  setStreamingInput(''); // Clear streaming UI as it's now permanent
                }
                if (currentOutputTransRef.current.trim()) {
                  let text = currentOutputTransRef.current;
                  
                  // Strip language tag from final output
                  text = text.replace(/^\[LANG:.*?\]\s*/, '');

                  setTranscripts(prev => [...prev, {
                    id: Date.now().toString() + 'm',
                    role: 'model',
                    text: text,
                    timestamp: new Date()
                  }]);
                  saveTranscript(text, 'model', 'live');
                  currentOutputTransRef.current = '';
                  turnLanguageDetectedRef.current = false;
                }
             }
          },
          onclose: () => {
            console.log("EBURON Link Closed");
            cleanupAudio();
          },
          onerror: (err) => {
            console.error("EBURON Link Error", err);
            setError("Connection interrupted. " + (err.message || "Unknown error"));
            cleanupAudio();
          }
        }
      });
      sessionRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to initialize audio subsystem.");
      cleanupAudio();
    }
  };

  const visibleTranscripts = transcripts.filter(msg => {
      if (!showOriginalOnly) return true;
      // If showing only original, we only show User messages (input)
      return msg.role === 'user' || msg.role === 'system';
  });

  return (
    <div className="flex flex-col h-full bg-slate-900 relative overflow-hidden">
      {/* Visualizer Background */}
      <div className="absolute inset-0 bg-slate-900 z-0">
          <div className="absolute bottom-0 left-0 w-full h-64 bg-gradient-to-t from-cyan-900/20 to-transparent"></div>
          {isActive && (
              <div 
                className="absolute bottom-12 left-1/2 transform -translate-x-1/2 w-64 h-64 rounded-full bg-cyan-500/10 blur-3xl transition-all duration-75"
                style={{ transform: `translateX(-50%) scale(${1 + volume * 2})` }}
              ></div>
          )}
      </div>

      {/* Transcript Area */}
      <div ref={transcriptContainerRef} className="flex-1 overflow-y-auto p-4 pb-48 z-10 scroll-smooth">
        {visibleTranscripts.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} showOriginalOnly={showOriginalOnly} />
        ))}
        
        {/* Real-time Streaming Input Bubble */}
        {streamingInput && (
            <div className="flex justify-end mb-4 animate-fade-in">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-5 py-3 bg-gradient-to-br from-cyan-600/50 to-cyan-800/50 text-white/90 border border-cyan-500/30 backdrop-blur-sm shadow-lg">
                    <span className="text-sm leading-relaxed">{streamingInput}</span>
                    <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-cyan-400 animate-pulse rounded-full"></span>
                </div>
            </div>
        )}

        {error && (
            <div className="flex justify-center p-4">
                <div className="bg-red-500/10 text-red-200 text-xs px-4 py-2 rounded-full border border-red-500/20 backdrop-blur flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    {error}
                </div>
            </div>
        )}
      </div>

      {/* Controls Overlay (Mobile First) */}
      <div className="absolute bottom-0 w-full z-20 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 rounded-t-3xl shadow-[0_-4px_30px_rgba(0,0,0,0.6)]">
        <div className="p-6 flex flex-col items-center gap-6">
            
            {/* Input Config (Inactive) OR Volume Control (Active) */}
            {!isActive ? (
                <div className="flex flex-wrap justify-center gap-3 w-full animate-fade-in">
                    <button 
                        onClick={() => setUseSystemAudio(!useSystemAudio)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-all ${
                            useSystemAudio 
                            ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-500/50 shadow-lg shadow-cyan-900/30' 
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                    >
                        <ComputerDesktopIcon className="w-4 h-4" />
                        <span>System Audio</span>
                        {useSystemAudio && <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full ml-1"></span>}
                    </button>

                    <button 
                        onClick={() => setDiarizationEnabled(!diarizationEnabled)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-all ${
                            diarizationEnabled 
                            ? 'bg-purple-900/50 text-purple-300 border border-purple-500/50 shadow-lg shadow-purple-900/30' 
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                    >
                        <UserGroupIcon className="w-4 h-4" />
                        <span>Speaker ID</span>
                        {diarizationEnabled && <span className="w-1.5 h-1.5 bg-purple-400 rounded-full ml-1"></span>}
                    </button>

                    <button 
                        onClick={() => setTranslationEnabled(!translationEnabled)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-all ${
                            translationEnabled 
                            ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-500/50 shadow-lg shadow-emerald-900/30' 
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                    >
                        <LanguageIcon className="w-4 h-4" />
                        <span>Translator Mode</span>
                        {translationEnabled && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full ml-1"></span>}
                    </button>
                </div>
            ) : (
                <div className="w-full flex flex-col gap-4 animate-fade-in-up">
                     {/* Active Session Toggles */}
                     {translationEnabled && (
                         <div className="flex justify-center">
                             <button 
                                onClick={() => setShowOriginalOnly(!showOriginalOnly)}
                                className="text-xs text-emerald-400 font-mono bg-emerald-900/20 px-3 py-1 rounded-full border border-emerald-500/20 hover:bg-emerald-900/40"
                             >
                                {showOriginalOnly ? 'View: Original Only' : 'View: Original + Translated'}
                             </button>
                         </div>
                     )}

                    <div className="w-full max-w-xs mx-auto flex items-center gap-4">
                        <button onClick={() => handleVolumeChange(0)} className="text-slate-400 hover:text-white transition-colors">
                            {agentVolume === 0 ? <SpeakerXMarkIcon className="w-5 h-5 text-red-400" /> : <SpeakerWaveIcon className="w-5 h-5 text-cyan-400" />}
                        </button>
                        <div className="flex-1 relative h-6 flex items-center">
                            <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.01" 
                                value={agentVolume} 
                                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 z-10"
                            />
                            {/* Tick marks for visual reference */}
                            <div className="absolute w-full flex justify-between px-0.5 opacity-20 pointer-events-none top-1/2 -translate-y-1/2">
                                <div className="w-0.5 h-2 bg-white"></div>
                                <div className="w-0.5 h-2 bg-white"></div>
                                <div className="w-0.5 h-2 bg-white"></div>
                            </div>
                        </div>
                    </div>
                 </div>
            )}

            {/* Main Action Button */}
            <div className="relative">
                 {isActive && (
                    <div className="absolute inset-0 rounded-full animate-ping bg-cyan-500/20 duration-1000"></div>
                 )}
                 <button
                    onClick={isActive ? cleanupAudio : connect}
                    className={`
                    relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl border-4 group
                    ${isActive 
                        ? 'bg-slate-900 border-red-500 text-red-500 hover:bg-red-500 hover:text-white' 
                        : 'bg-cyan-600 border-slate-800 text-white hover:bg-cyan-500 hover:scale-105 shadow-cyan-500/40'}
                    `}
                >
                    {isActive ? (
                        <StopIcon className="w-8 h-8 group-hover:scale-90 transition-transform" />
                    ) : (
                        <MicrophoneIcon className="w-8 h-8 group-hover:scale-110 transition-transform" />
                    )}
                </button>
            </div>

            {/* Status Text */}
            <div className="h-6 w-full text-center">
                {isActive ? (
                     <div className="flex flex-col items-center">
                        <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono tracking-[0.2em] font-bold">
                            <SparklesIcon className="w-3 h-3 animate-spin-slow" />
                            <span>CONNECTED</span>
                        </div>
                        <div className="flex gap-2 mt-1">
                            {diarizationEnabled && (
                                <span className="text-[10px] text-purple-400/70 font-mono">
                                    SPEAKER ID
                                </span>
                            )}
                            {translationEnabled && (
                                <span className="text-[10px] text-emerald-400/70 font-mono">
                                    TRANSLATOR
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <span className="text-slate-500 text-xs font-mono uppercase tracking-widest">System Ready</span>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};
