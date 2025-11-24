
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage } from '@google/genai';
import { saveTranscript } from '../utils/supabaseClient';
import { float32ToInt16 } from '../utils/audioUtils';
import { DocumentTextIcon, ArrowUpTrayIcon, PlayCircleIcon, StopCircleIcon, CloudArrowUpIcon, ComputerDesktopIcon, MicrophoneIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';

const FLASH_MODEL = 'gemini-2.5-flash';
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

export const BatchTranscriber: React.FC = () => {
  const [transcription, setTranscription] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [useSystemAudio, setUseSystemAudio] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  
  // Refs for Audio Pipeline
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const mediaStreamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<BlobPart[]>([]);
  const currentTranscriptRef = useRef('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => cleanupAudio();
  }, []);

  // Auto-scroll to bottom when transcription updates
  useEffect(() => {
    if (transcriptEndRef.current) {
        transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcription]);

  const cleanupAudio = () => {
    // Stop Recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    // Stop Streams
    mediaStreamsRef.current.forEach(stream => {
        stream.getTracks().forEach(track => track.stop());
    });
    mediaStreamsRef.current = [];

    // Disconnect Nodes
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }

    // Close Context
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }

    // Close Gemini Session
    if (sessionRef.current) {
        sessionRef.current.then(session => {
            try { session.close(); } catch(e) {}
        });
        sessionRef.current = null;
    }
    
    setIsRecording(false);
  };

  // Real-time Recording & Transcription Logic
  const startRealtimeRecording = async () => {
    setStreamError(null);
    setTranscription('');
    currentTranscriptRef.current = '';
    setAudioBlob(null);
    chunksRef.current = [];

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const mixer = ctx.createGain();
      
      // 1. Get Microphone
      const micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } 
      });
      mediaStreamsRef.current.push(micStream);
      const micSource = ctx.createMediaStreamSource(micStream);
      micSource.connect(mixer);

      // 2. Get System Audio (Optional)
      if (useSystemAudio) {
         try {
             const sysStream = await navigator.mediaDevices.getDisplayMedia({
                 video: true, // Required to get audio in many browsers
                 audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false }
             });
             mediaStreamsRef.current.push(sysStream);
             
             // Check if user shared audio
             if (sysStream.getAudioTracks().length > 0) {
                 const sysSource = ctx.createMediaStreamSource(sysStream);
                 sysSource.connect(mixer);
             } else {
                 setStreamError("System audio not shared. Recording microphone only.");
             }
         } catch (e) {
             console.warn("System audio cancelled", e);
             setUseSystemAudio(false);
         }
      }

      // 3. Setup Recorder Pipeline (Mixer -> Destination -> MediaRecorder)
      const dest = ctx.createMediaStreamDestination();
      mediaStreamDestRef.current = dest;
      mixer.connect(dest);
      
      const recorder = new MediaRecorder(dest.stream);
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      recorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          setAudioBlob(blob);
          // Save final transcript
          if (currentTranscriptRef.current.trim()) {
            await saveTranscript(currentTranscriptRef.current, 'model', 'batch');
          }
      };
      
      recorder.start();

      // 4. Setup Live API Pipeline (Mixer -> Processor -> Gemini)
      // Use Live API for Realtime Transcription
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      mixer.connect(processor);
      
      // Create a mute node to prevent feedback but keep the graph active
      const mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(ctx.destination);

      const sessionPromise = ai.live.connect({
          model: LIVE_MODEL,
          config: {
              responseModalities: ['AUDIO' as any],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
              },
              inputAudioTranscription: {}, // Fixed: Empty object for default configuration
              systemInstruction: "You are a passive professional transcriber. Listen carefully and transcribe the audio stream accurately. Do not reply with audio or commentary. Just listen.",
          },
          callbacks: {
              onopen: () => {
                  console.log("Transcriber Connected");
                  
                  processor.onaudioprocess = (e) => {
                      const inputData = e.inputBuffer.getChannelData(0);
                      const pcm16 = float32ToInt16(inputData);
                      
                      let binary = '';
                      const len = pcm16.byteLength;
                      const bytes = new Uint8Array(pcm16.buffer);
                      for (let i = 0; i < len; i++) {
                          binary += String.fromCharCode(bytes[i]);
                      }
                      const base64 = btoa(binary);

                      sessionPromise.then(session => {
                          session.sendRealtimeInput({
                              media: { mimeType: 'audio/pcm;rate=16000', data: base64 }
                          });
                      });
                  };
              },
              onmessage: (msg: LiveServerMessage) => {
                  // We only care about inputTranscription (what the user/system said)
                  if (msg.serverContent?.inputTranscription) {
                      const text = msg.serverContent.inputTranscription.text;
                      if (text) {
                          currentTranscriptRef.current += text;
                          setTranscription(prev => prev + text);
                      }
                  }
              },
              onclose: () => {
                  console.log("Transcriber Closed");
              },
              onerror: (e) => {
                  console.error("Transcriber Error", e);
                  setStreamError("Connection lost.");
              }
          }
      });
      sessionRef.current = sessionPromise;
      setIsRecording(true);

    } catch (err: any) {
        console.error("Recording setup failed", err);
        setStreamError(err.message || "Could not start recording.");
        cleanupAudio();
    }
  };

  const stopRealtimeRecording = () => {
      cleanupAudio();
  };

  // Legacy File Upload Logic (Keep for manual uploads)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioBlob(file);
      setTranscription(''); // Clear previous
    }
  };

  const transcribeUploadedFile = async () => {
    if (!audioBlob) return;
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64data = (reader.result as string).split(',')[1];
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: FLASH_MODEL,
          contents: {
            parts: [
              { inlineData: { mimeType: audioBlob.type || 'audio/webm', data: base64data } },
              { text: "Transcribe this audio precisely." }
            ]
          }
        });
        const text = response.text || "No transcription generated.";
        setTranscription(text);
        await saveTranscript(text, 'model', 'batch');
        setIsProcessing(false);
      };
    } catch (e) {
        setIsProcessing(false);
        setTranscription("Error processing file.");
    }
  };

  return (
    <div className="p-6 bg-slate-900 h-full flex flex-col overflow-y-auto">
        <h2 className="text-xl text-cyan-400 font-mono mb-6 uppercase tracking-widest border-b border-slate-700 pb-2">
            Realtime Transcriber
        </h2>
        
        {/* Controls */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg mb-6">
            
            {/* Audio Source Toggles */}
            <div className="flex gap-4 mb-4">
                 <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium uppercase tracking-wide ${true ? 'bg-cyan-900/30 border-cyan-500/50 text-cyan-300' : ''}`}>
                    <MicrophoneIcon className="w-4 h-4" />
                    Microphone (Always On)
                 </div>
                 
                 <button 
                    onClick={() => !isRecording && setUseSystemAudio(!useSystemAudio)}
                    disabled={isRecording}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium uppercase tracking-wide transition-all ${
                        useSystemAudio 
                        ? 'bg-purple-900/30 border-purple-500/50 text-purple-300 shadow-sm shadow-purple-500/20' 
                        : 'bg-slate-700/50 border-slate-600 text-slate-400 hover:bg-slate-700'
                    } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
                 >
                    <ComputerDesktopIcon className="w-4 h-4" />
                    System Audio
                    {useSystemAudio && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 ml-1"></span>}
                 </button>
            </div>

            {streamError && (
                <div className="mb-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded">
                    {streamError}
                </div>
            )}

            <div className="flex gap-4 mb-6">
                <button
                    onClick={isRecording ? stopRealtimeRecording : startRealtimeRecording}
                    className={`flex-1 py-6 rounded-lg flex flex-col items-center justify-center transition-all border-2 ${
                        isRecording 
                        ? 'border-red-500 bg-red-500/10 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.2)]' 
                        : 'border-cyan-500/30 hover:border-cyan-500 bg-cyan-900/10 hover:bg-cyan-900/20 text-cyan-400'
                    }`}
                >
                    {isRecording ? (
                        <>
                            <StopCircleIcon className="w-10 h-10 mb-2 animate-pulse" />
                            <span className="text-sm font-bold tracking-widest">STOP TRANSCRIBING</span>
                        </>
                    ) : (
                        <>
                            <PlayCircleIcon className="w-10 h-10 mb-2" />
                            <span className="text-sm font-bold tracking-widest">START LIVE TRANSCRIBE</span>
                        </>
                    )}
                </button>

                {/* Vertical Divider */}
                <div className="w-px bg-slate-700 my-2"></div>

                <label className="flex-1 py-6 rounded-lg flex flex-col items-center justify-center transition-colors border-2 border-dashed border-slate-600 hover:border-slate-400 text-slate-500 hover:text-slate-300 cursor-pointer">
                    <ArrowUpTrayIcon className="w-8 h-8 mb-2" />
                    <span className="text-sm font-medium">Upload File</span>
                    <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                </label>
            </div>

            {/* Processing State for Uploads */}
            {audioBlob && !isRecording && (
                <div className="flex flex-col gap-3 animate-fade-in">
                    <div className="bg-slate-900/50 p-3 rounded text-xs text-slate-400 font-mono flex justify-between items-center border border-slate-700">
                       <span className="flex items-center gap-2">
                           <SpeakerWaveIcon className="w-4 h-4 text-slate-500"/>
                           Recorded/Uploaded Audio
                           <span className="text-slate-600">|</span>
                           {(audioBlob.size / 1024).toFixed(1)} KB
                       </span>
                       <span className="text-cyan-500 uppercase">{audioBlob.type || 'WEB/M'}</span>
                    </div>
                    {/* Only show Transcribe button if it was an upload (not a fresh recording which is already transcribed) */}
                    {!transcription && (
                        <button 
                            onClick={transcribeUploadedFile}
                            disabled={isProcessing}
                            className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
                        >
                            {isProcessing ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <DocumentTextIcon className="w-5 h-5" />
                            )}
                            PROCESS UPLOAD
                        </button>
                    )}
                </div>
            )}
        </div>

        {/* Transcription Output */}
        <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-4 z-10">
                    <div className="flex items-center gap-2">
                        <h3 className="text-slate-300 font-medium">Transcript</h3>
                        {isRecording && (
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                                <span className="text-[10px] text-red-400 font-bold tracking-wider">LIVE</span>
                            </span>
                        )}
                        {!isRecording && transcription && (
                            <span className="text-[10px] text-green-400 flex items-center gap-1 bg-green-400/10 px-2 py-0.5 rounded-full border border-green-400/20">
                                <CloudArrowUpIcon className="w-3 h-3" />
                                SAVED
                            </span>
                        )}
                    </div>
            </div>
            
            <div className="flex-1 overflow-y-auto font-mono text-sm text-slate-300 whitespace-pre-wrap leading-relaxed z-10 p-4 bg-slate-900/50 rounded-lg shadow-inner">
                {transcription || (
                    <span className="text-slate-600 italic">
                        {isRecording ? "Listening..." : "Ready to transcribe..."}
                    </span>
                )}
                <div ref={transcriptEndRef} />
            </div>
        </div>
    </div>
  );
};
