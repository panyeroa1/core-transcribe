import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gkaszpjcfdkehoivihju.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrYXN6cGpjZmRrZWhvaXZpaGp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3MjQwMjMsImV4cCI6MjA3NTMwMDAyM30.u0dxNr1LbH31OmlT7KzloKI6V_k-8uWOCslg3PE9UYw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export type TranscriptMode = 'live' | 'batch' | 'chat';

export async function saveTranscript(content: string, role: string, mode: TranscriptMode) {
  if (!content) return;
  
  try {
    const { error } = await supabase
      .from('transcripts')
      .insert([
        { 
          content, 
          role, 
          mode,
          created_at: new Date().toISOString() 
        }
      ]);

    if (error) {
      console.warn('Supabase save failed:', error.message);
    } else {
      // Silent success - Eburon standard
    }
  } catch (e) {
    console.error('Supabase connection error:', e);
  }
}