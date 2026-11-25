import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Trash2, Send, Loader2 } from 'lucide-react';

interface AudioRecorderProps {
  onSendVoiceNote: (audioDataUrl: string, durationSeconds: number) => void;
  onCancel: () => void;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({ onSendVoiceNote, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopAndCleanup();
    };
  }, []);

  const startRecording = async () => {
    chunksRef.current = [];
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);

      timerRef.current = window.setInterval(() => {
        setDuration((prev) => {
          if (prev >= 120) { // Max 2 minutes
            stopRecording();
            return 120;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      console.error('Microphone access failed:', err);
      setErrorMsg('Microphone access denied or not supported');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setIsRecording(false);
  };

  const stopAndCleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleSend = () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          convertAndDeliver(blob, duration);
        };
        mediaRecorderRef.current.stop();
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
    }

    if (audioBlob) {
      convertAndDeliver(audioBlob, duration);
    }
  };

  const convertAndDeliver = (blob: Blob, dur: number) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      onSendVoiceNote(dataUrl, Math.max(1, dur));
    };
    reader.readAsDataURL(blob);
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-[#7560DF]/10 dark:bg-[#7560DF]/20 px-4 py-2.5 rounded-full border border-[#7560DF]/30 animate-in fade-in">
      {/* Delete / Cancel button */}
      <button
        onClick={onCancel}
        className="p-1.5 rounded-full text-slate-500 hover:text-rose-500 hover:bg-white dark:hover:bg-slate-800 transition-colors"
        title="Discard voice message"
      >
        <Trash2 className="w-5 h-5" />
      </button>

      {/* Recording Waveform & Timer */}
      <div className="flex items-center gap-3 flex-1 justify-center">
        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
        <span className="text-xs font-mono font-bold text-slate-800 dark:text-white">
          {formatTimer(duration)}
        </span>

        {/* Dynamic Waveform Simulation */}
        <div className="flex items-center gap-1 h-5 px-2">
          {[8, 16, 24, 12, 20, 14, 22, 10, 18, 12, 24, 16, 8].map((h, i) => (
            <span
              key={i}
              className="w-1 bg-[#7560DF] dark:bg-[#A798F8] rounded-full animate-waveform"
              style={{
                height: `${h}px`,
                animationDelay: `${(i * 0.1).toFixed(1)}s`
              }}
            />
          ))}
        </div>
      </div>

      {errorMsg ? (
        <span className="text-xs text-rose-500 font-semibold">{errorMsg}</span>
      ) : (
        /* Finish and send */
        <button
          onClick={handleSend}
          className="p-2 rounded-full bg-[#7560DF] hover:bg-[#624ec7] text-white shadow-md transition-all"
          title="Send voice note"
        >
          <Send className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
