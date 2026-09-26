"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ear, Mic, MicOff, Send, Volume2, VolumeX, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Action } from "@/lib/types";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
import { playDoneChime, playWakeChime } from "@/lib/audio-cue";
import { cleanVoiceTranscript, matchesWakeWord } from "@/lib/voice-utils";
import { Button, Chip, cn, SPRING } from "./ui";

interface Msg {
  role: "user" | "roam";
  text: string;
}

type RunActions = (actions: Action[], reply: string, nlu: string) => void;

// Bundler-invisible dynamic import (CDN modules stay out of the build graph)
const cdnImport = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoicePanel({
  open,
  onOpen,
  onClose,
  runActions,
  onReadPlan,
}: {
  open: boolean;
  onOpen?: () => void;
  onClose: () => void;
  runActions: RunActions;
  onReadPlan: () => void;
}) {
  const lang = useRoam((s) => s.lang);
  const t = (k: DictKey) => translate(lang, k);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "roam", text: t("voice.ask") },
  ]);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [thinking, setThinking] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [ttsOn, setTtsOn] = useState(true);
  const [sttMode, setSttMode] = useState<"webspeech" | "whisper" | "unavailable">("whisper");
  const [handsFreeOn, setHandsFreeOn] = useState(false);
  const [webllmOn, setWebllmOn] = useState(false);
  const [webllmStatus, setWebllmStatus] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRecRef = useRef<SpeechRecognitionLike | null>(null);
  const interimRecRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextVADRef = useRef<{ close: () => void } | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const whisperRef = useRef<{ transcribe: (audio: Float32Array) => Promise<string> } | null>(null);
  const webllmRef = useRef<{ generate: (prompt: string) => Promise<string> } | null>(null);
  const sessionIdRef = useRef("");
  const listRef = useRef<HTMLDivElement>(null);

  const handsFreeRef = useRef(handsFreeOn);
  handsFreeRef.current = handsFreeOn;
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const sessionId = () => (sessionIdRef.current ||= `s_${Math.random().toString(36).slice(2, 10)}`);
  const voiceLocale = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";

  // ── Natural Speech Synthesis (Edge Neural TTS + Fallback) ──────────────────
  const stopSpeaking = useCallback((): void => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current = null;
    }
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
    setCaption(null);
  }, []);

  const fallbackBrowserSpeak = useCallback(
    (text: string): void => {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.lang = voiceLocale;
      u.rate = 1.02;
      u.onboundary = () => setCaption(text);
      u.onstart = () => setCaption(text);
      u.onend = () => setTimeout(() => setCaption(null), 900);
      speechSynthesis.speak(u);
    },
    [voiceLocale],
  );

  const speak = useCallback(
    async (text: string): Promise<void> => {
      stopSpeaking();
      if (!ttsOn) {
        setCaption(text);
        return;
      }
      setCaption(text);

      // 1. Studio-grade Edge Neural TTS (en-IN-NeerjaNeural, hi-IN-SwaraNeural, mr-IN-AarohiNeural)
      try {
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioPlayerRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(url);
            audioPlayerRef.current = null;
            setTimeout(() => setCaption(null), 800);
          };

          audio.onerror = () => {
            URL.revokeObjectURL(url);
            audioPlayerRef.current = null;
            fallbackBrowserSpeak(text);
          };

          await audio.play();
          return;
        }
      } catch {
        // Fall through to browser speech synthesis
      }

      fallbackBrowserSpeak(text);
    },
    [fallbackBrowserSpeak, lang, stopSpeaking, ttsOn],
  );

  // ── Wake Word Spotter ("Hey Vibe" / "Hey Roamy") ───────────────────────────
  const stopWakeSpotter = useCallback((): void => {
    if (wakeRecRef.current) {
      try {
        wakeRecRef.current.stop();
      } catch {
        // ignore
      }
      wakeRecRef.current = null;
    }
  }, []);

  // ── Submit a transcript through the NLU ladder ────────────────────────────
  const submit = useCallback(
    async (text: string): Promise<void> => {
      const transcript = text.trim();
      if (!transcript) return;
      setMessages((m) => [...m, { role: "user", text: transcript }]);
      setInterim("");
      setThinking(true);
      thinkingRef.current = true;

      try {
        // 1) WebLLM (opt-in, on-device, WebGPU)
        if (webllmOn && webllmRef.current) {
          setWebllmStatus("reasoning on-device…");
          const raw = await webllmRef.current.generate(JSON.stringify({ transcript, city: useRoam.getState().lastCity }));
          const parsed = JSON.parse(raw) as { actions?: Action[]; reply?: string };
          setThinking(false);
          thinkingRef.current = false;
          setWebllmStatus(null);
          const actions = parsed.actions ?? [];
          const reply = parsed.reply ?? "Done — on-device model handled that.";
          setMessages((m) => [...m, { role: "roam", text: reply }]);
          void speak(reply);
          runActions(actions, reply, "webllm");
          return;
        }

        // 2) Server rules (+ optional Groq/OpenRouter/Ollama via env)
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, sessionId: sessionId(), nlu: "rules" }),
        });
        const data = (await res.json()) as { actions: Action[]; reply: string; nlu: string };
        setThinking(false);
        thinkingRef.current = false;
        setMessages((m) => [...m, { role: "roam", text: data.reply }]);
        void speak(data.reply);
        runActions(data.actions ?? [], data.reply, data.nlu);
      } catch {
        setThinking(false);
        thinkingRef.current = false;
        const fallback = "I couldn't reach my language brain — but I'm still here. Try “plan a one-day food trip in Kalyan under ₹500”.";
        setMessages((m) => [...m, { role: "roam", text: fallback }]);
        setCaption(fallback);
      }
    },
    [runActions, speak, webllmOn],
  );

  // ── High-Accuracy Whisper Large v3 / Dual Smart Stop ────────────────────────
  const startWhisperCapture = useCallback(async (): Promise<void> => {
    try {
      stopSpeaking();
      stopWakeSpotter();

      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Microphone recording not supported on this browser.");
        setSttMode("webspeech");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      // ── Dual Smart Stop #1: In-browser 3.2s Silence VAD Analyser ───
      try {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          let hasSpoken = false;
          let lastSpokenAt = Date.now();
          let isVADActive = true;

          const interval = setInterval(() => {
            if (!isVADActive) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;

            if (avg > 12) {
              hasSpoken = true;
              lastSpokenAt = Date.now();
            } else if (hasSpoken && Date.now() - lastSpokenAt > 3200) {
              // 3.2 seconds of comfortable thinking silence after speaking
              isVADActive = false;
              clearInterval(interval);
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                playDoneChime();
                mediaRecorderRef.current.stop();
              }
            }
          }, 150);

          audioContextVADRef.current = {
            close: () => {
              isVADActive = false;
              clearInterval(interval);
              try {
                ctx.close();
              } catch {}
            },
          };
        }
      } catch {
        // ignore
      }

      // ── Dual Smart Stop #2: Interim Verbal Stop Phrase Detector ("that's it", "done") ───
      const Ctor = getRecognition();
      if (Ctor) {
        const interimRec = new Ctor();
        interimRecRef.current = interimRec;
        interimRec.lang = voiceLocale;
        interimRec.continuous = true;
        interimRec.interimResults = true;

        interimRec.onresult = (e) => {
          let curr = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            curr += e.results[i][0].transcript;
          }
          if (curr) {
            setInterim(curr);
            const { hasStopPhrase } = cleanVoiceTranscript(curr);
            if (hasStopPhrase) {
              playDoneChime();
              toast.success("✓ 'That's it' heard — planning your trip!");
              try {
                interimRec.stop();
              } catch {}
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                mediaRecorderRef.current.stop();
              }
            }
          }
        };
        interimRec.onerror = () => {};
        try {
          interimRec.start();
        } catch {}
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        audioContextVADRef.current?.close();
        audioContextVADRef.current = null;
        if (interimRecRef.current) {
          try {
            interimRecRef.current.stop();
          } catch {}
          interimRecRef.current = null;
        }
        mediaRecorderRef.current = null;
        setListening(false);
        listeningRef.current = false;

        if (chunks.length === 0) return;

        setThinking(true);
        thinkingRef.current = true;
        setWebllmStatus("Transcribing with Whisper Large v3…");

        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const formData = new FormData();
          formData.append("file", blob, "audio.webm");

          const res = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: formData,
          });

          setWebllmStatus(null);
          setThinking(false);
          thinkingRef.current = false;

          if (res.ok) {
            const data = (await res.json()) as { text?: string };
            const transcribed = data.text?.trim();
            if (transcribed) {
              const { cleaned } = cleanVoiceTranscript(transcribed);
              const finalPrompt = cleaned || transcribed;
              setInterim(finalPrompt);
              void submit(finalPrompt);
              return;
            } else {
              toast.message("Didn't catch any audio — tap and speak again.");
            }
          } else if (res.status === 501) {
            toast.message("Groq Whisper key not configured on server — switching to browser speech.");
            setSttMode("webspeech");
          } else {
            toast.error("Whisper transcription failed — falling back to browser speech.");
            setSttMode("webspeech");
          }
        } catch {
          setWebllmStatus(null);
          setThinking(false);
          thinkingRef.current = false;
          toast.error("Audio upload error — try typing or browser speech.");
        }
      };

      recorder.start();
      setListening(true);
      listeningRef.current = true;
      toast.message("Listening… say 'that’s it' or pause when done.");
    } catch (err) {
      setListening(false);
      listeningRef.current = false;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast.error("Microphone permission denied.");
      } else {
        toast.error("Failed to start voice recording — switched to browser speech.");
        setSttMode("webspeech");
      }
    }
  }, [stopSpeaking, stopWakeSpotter, submit, voiceLocale]);

  const startListening = useCallback((): void => {
    stopSpeaking();
    stopWakeSpotter();
    if (sttMode === "whisper") {
      void startWhisperCapture();
      return;
    }
    const Ctor = getRecognition();
    if (!Ctor) {
      setSttMode("unavailable");
      toast.message("This browser has no Web Speech API — text chat always works.");
      return;
    }
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = voiceLocale;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      const activeText = interimText || finalText;
      setInterim(activeText);

      const { cleaned, hasStopPhrase } = cleanVoiceTranscript(activeText);
      if (hasStopPhrase) {
        playDoneChime();
        toast.success("✓ 'That's it' heard — planning your trip!");
        rec.stop();
        setListening(false);
        listeningRef.current = false;
        void submit(cleaned || activeText);
      } else if (finalText) {
        void submit(cleaned || finalText);
      }
    };
    rec.onerror = (e) => {
      setListening(false);
      listeningRef.current = false;
      if (e.error === "not-allowed") toast.error("Microphone permission denied — use text chat instead.");
      else if (e.error !== "aborted") toast.message("Voice hiccup — try again or type below.");
    };
    rec.onend = () => {
      setListening(false);
      listeningRef.current = false;
    };
    rec.start();
    setListening(true);
    listeningRef.current = true;
  }, [startWhisperCapture, stopSpeaking, stopWakeSpotter, sttMode, submit, voiceLocale]);

  const stopListening = useCallback((): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    audioContextVADRef.current?.close();
    audioContextVADRef.current = null;
    recognitionRef.current?.stop();
    setListening(false);
    listeningRef.current = false;
  }, []);

  const startWakeSpotter = useCallback((): void => {
    stopWakeSpotter();
    const Ctor = getRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    wakeRecRef.current = rec;
    rec.lang = voiceLocale;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (matchesWakeWord(text)) {
          playWakeChime();
          toast.success("👋 'Hey Vibe' detected! Listening…");
          try {
            rec.stop();
          } catch {}
          onOpenRef.current?.();
          startListening();
          return;
        }
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        setHandsFreeOn(false);
        handsFreeRef.current = false;
        toast.error("Microphone permission needed for hands-free wake word.");
      }
    };

    rec.onend = () => {
      if (handsFreeRef.current && !listeningRef.current && !thinkingRef.current) {
        setTimeout(() => {
          try {
            if (handsFreeRef.current && !listeningRef.current) rec.start();
          } catch {}
        }, 500);
      }
    };

    try {
      rec.start();
    } catch {}
  }, [startListening, stopWakeSpotter, voiceLocale]);

  // ── WebLLM opt-in loader ──────────────────────────────────────────────────
  const toggleWebllm = useCallback(async (): Promise<void> => {
    if (webllmOn) {
      setWebllmOn(false);
      return;
    }
    if (!("gpu" in navigator)) {
      toast.error("No WebGPU in this browser — the rule-based planner still handles everything.");
      return;
    }
    try {
      setWebllmStatus("downloading a ~500 MB open model into browser cache…");
      const mod = (await cdnImport("https://esm.sh/@mlc-ai/web-llm@0.2.79")) as {
        CreateMLCEngine: (model: string, opts?: Record<string, unknown>) => Promise<{
          chat: {
            completions: { create: (args: Record<string, unknown>) => Promise<{ choices: { message: { content: string } }[] }> };
          };
        }>;
      };
      const engine = await mod.CreateMLCEngine("Qwen2.5-0.5B-Instruct-q4f16_1-MLC", {
        initProgressCallback: (p: { progress?: number; text?: string }) =>
          setWebllmStatus(`${Math.round((p.progress ?? 0) * 100)}% — ${p.text?.slice(0, 60) ?? "loading"}`),
      });
      webllmRef.current = {
        generate: async (payload) => {
          const completion = await engine.chat.completions.create({
            messages: [
              {
                role: "system",
                content:
                  'You convert travel requests to JSON: {"actions":[...],"reply":"one sentence"}. Action types: set_city{city}, apply_filters{categories?,budget?}, plan_trip{hoursPerDay,days,interests?,budget?,vibe?}, add_stop{name}, remove_stop{name}, surprise_me{}, compare{names[]}, read_day_plan{}, navigate_to{name}, answer{topic}. Categories: food, culture, nature, market, hidden_gem. Reply with ONLY minified JSON.',
              },
              { role: "user", content: payload },
            ],
            temperature: 0.2,
            max_tokens: 300,
          });
          return completion.choices[0]?.message?.content ?? "{}";
        },
      };
      setWebllmOn(true);
      setWebllmStatus(null);
      toast.success("On-device LLM ready — works offline after this.");
    } catch {
      setWebllmStatus(null);
      toast.error("WebLLM failed to load — staying on the instant rule engine.");
    }
  }, [webllmOn]);

  useEffect(() => {
    if (!open) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      audioContextVADRef.current?.close();
      audioContextVADRef.current = null;
      recognitionRef.current?.stop();
      stopSpeaking();
      setListening(false);
      listeningRef.current = false;
      setCaption(null);
    }
  }, [open, stopSpeaking]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const sttUnavailable = sttMode === "unavailable" || !getRecognition();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={SPRING}
          className="clay-raised-lg fixed bottom-20 sm:bottom-24 inset-x-3 sm:inset-x-auto sm:right-4 z-50 flex max-h-[75dvh] sm:max-h-[70dvh] sm:w-[420px] flex-col overflow-hidden no-print"
          role="dialog"
          aria-label="Roam voice assistant"
        >
          {/* header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Ear size={15} className="text-primary" /> Voice planner
            </span>
            <div className="flex gap-1">
              {(["en", "hi", "mr"] as const).map((l) => (
                <Chip key={l} active={lang === l} className="h-7 px-2 text-[11px]" onClick={() => useRoam.getState().setLang(l)}>
                  {l.toUpperCase()}
                </Chip>
              ))}
            </div>
          </div>

          {/* messages */}
          <div ref={listRef} className="thin-scroll flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                  m.role === "user" ? "ml-auto bg-primary text-primary-contrast" : "clay-raised-sm",
                )}
              >
                {m.text}
              </motion.div>
            ))}
            {thinking && (
              <div className="clay-raised-sm flex w-max items-center gap-1.5 px-4 py-3" aria-label={t("voice.thinking")}>
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-2 w-2 rounded-full bg-primary/70"
                    animate={{ y: [0, -4, 0] }}
                    transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* interim + captions */}
          <div className="px-4 pb-1">
            {interim && (
              <p className="mb-1 rounded-xl bg-primary/10 px-3 py-1.5 text-[13px] italic text-primary">{interim}</p>
            )}
            {webllmStatus && <p className="mb-1 text-[11px] font-semibold text-gold">{webllmStatus}</p>}
            <AnimatePresence>
              {caption && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-1 rounded-xl bg-accent/15 px-3 py-1.5 text-[13px] font-medium"
                  aria-live="polite"
                >
                  🔊 {caption}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* input row */}
          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(input);
              setInput("");
            }}
          >
            {/* orb */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => (listening ? stopListening() : startListening())}
              aria-label={listening ? "Stop listening" : "Start voice input"}
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                listening ? "clay-primary animate-orb clay-primary-pressed" : "clay-primary",
              )}
            >
              {sttUnavailable ? <MicOff size={18} /> : <Mic size={18} />}
              {listening && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3 items-end gap-[2px]">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-[3px] rounded-full bg-white"
                      animate={{ height: [4, 11, 4] }}
                      transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                    />
                  ))}
                </span>
              )}
            </motion.button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("voice.ask")}
              aria-label="Text chat with Roam"
              className="clay-raised-sm h-10 min-w-0 flex-1 bg-card px-3.5 text-[13px] outline-none"
            />
            <Button type="submit" variant="primary" size="icon" aria-label="Send" disabled={thinking}>
              <Send size={15} />
            </Button>
          </form>

          {/* toggles */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
            <Chip active={ttsOn} className="h-7 text-[11px]" onClick={() => setTtsOn(!ttsOn)} aria-pressed={ttsOn}>
              {ttsOn ? <Volume2 size={12} /> : <VolumeX size={12} />} Neural TTS
            </Chip>
            <Chip
              active={handsFreeOn}
              className="h-7 text-[11px]"
              onClick={() => {
                const next = !handsFreeOn;
                setHandsFreeOn(next);
                handsFreeRef.current = next;
                if (next) {
                  toast.success("Hands-Free active! Say 'Hey Vibe' or 'Hey Roamy' anytime.");
                  startWakeSpotter();
                } else {
                  stopWakeSpotter();
                  toast.message("Hands-Free disabled.");
                }
              }}
              title="Hands-free wake word listening for 'Hey Vibe' or 'Hey Roamy'"
            >
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1", handsFreeOn ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground")} />
              Hey Vibe
            </Chip>
            <Chip
              active={sttMode === "whisper"}
              className="h-7 text-[11px]"
              onClick={() => setSttMode(sttMode === "whisper" ? "webspeech" : "whisper")}
              title="Toggle Whisper Large v3 (Fast Cloud STT) / Browser Web Speech"
            >
              {sttMode === "whisper" ? "Whisper Large v3" : "Browser STT"}
            </Chip>
            <Chip active={webllmOn} className="h-7 text-[11px]" onClick={() => void toggleWebllm()} title="Opt-in on-device LLM (WebGPU, ~500 MB)">
              <Zap size={12} /> WebLLM
            </Chip>
            <Chip className="h-7 text-[11px]" onClick={onReadPlan}>
              Read my plan
            </Chip>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
