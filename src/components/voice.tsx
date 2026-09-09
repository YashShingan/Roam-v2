"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Ear, Mic, MicOff, Send, Volume2, VolumeX, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Action } from "@/lib/types";
import { translate, type DictKey } from "@/lib/i18n";
import { useRoam } from "@/lib/store";
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
  onClose,
  runActions,
  onReadPlan,
}: {
  open: boolean;
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
  const [sttMode, setSttMode] = useState<"webspeech" | "whisper" | "unavailable">("webspeech");
  const [webllmOn, setWebllmOn] = useState(false);
  const [webllmStatus, setWebllmStatus] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const whisperRef = useRef<{ transcribe: (audio: Float32Array) => Promise<string> } | null>(null);
  const webllmRef = useRef<{ generate: (prompt: string) => Promise<string> } | null>(null);
  const sessionIdRef = useRef(`s_${Math.random().toString(36).slice(2, 10)}`);
  const listRef = useRef<HTMLDivElement>(null);

  const voiceLocale = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";

  const speak = useCallback(
    (text: string): void => {
      if (!ttsOn) {
        setCaption(text);
        return;
      }
      if (!("speechSynthesis" in window)) {
        setCaption(text);
        return;
      }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.lang = voiceLocale;
      u.rate = 1.02;
      u.onboundary = () => setCaption(text); // caption bubble while speaking
      u.onstart = () => setCaption(text);
      u.onend = () => setTimeout(() => setCaption(null), 900);
      speechSynthesis.speak(u);
    },
    [ttsOn, voiceLocale],
  );

  // ── Submit a transcript through the NLU ladder ────────────────────────────
  const submit = useCallback(
    async (text: string): Promise<void> => {
      const transcript = text.trim();
      if (!transcript) return;
      setMessages((m) => [...m, { role: "user", text: transcript }]);
      setInterim("");
      setThinking(true);

      try {
        // 1) WebLLM (opt-in, on-device, WebGPU)
        if (webllmOn && webllmRef.current) {
          setWebllmStatus("reasoning on-device…");
          const raw = await webllmRef.current.generate(JSON.stringify({ transcript, city: useRoam.getState().lastCity }));
          const parsed = JSON.parse(raw) as { actions?: Action[]; reply?: string };
          setThinking(false);
          setWebllmStatus(null);
          const actions = parsed.actions ?? [];
          const reply = parsed.reply ?? "Done — on-device model handled that.";
          setMessages((m) => [...m, { role: "roam", text: reply }]);
          speak(reply);
          runActions(actions, reply, "webllm");
          return;
        }
        // 2) Server rules (+ optional Ollama via env)
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, sessionId: sessionIdRef.current, nlu: "rules" }),
        });
        const data = (await res.json()) as { actions: Action[]; reply: string; nlu: string };
        setThinking(false);
        setMessages((m) => [...m, { role: "roam", text: data.reply }]);
        speak(data.reply);
        runActions(data.actions ?? [], data.reply, data.nlu);
      } catch {
        setThinking(false);
        const fallback = "I couldn't reach my language brain — but I'm still here. Try “plan a one-day food trip in Kalyan under ₹500”.";
        setMessages((m) => [...m, { role: "roam", text: fallback }]);
        setCaption(fallback);
      }
    },
    [runActions, speak, webllmOn],
  );

  // ── Web Speech listening ──────────────────────────────────────────────────
  const startListening = useCallback((): void => {
    if ("speechSynthesis" in window) speechSynthesis.cancel(); // barge-in
    if (sttMode === "whisper") {
      void startWhisperCapture();
      return;
    }
    const Ctor = getRecognition();
    if (!Ctor) {
      setSttMode("unavailable");
      toast.message("This browser has no Web Speech API — text chat always works (that's the Firefox path).");
      return;
    }
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = voiceLocale;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText || finalText);
      if (finalText) void submit(finalText);
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed") toast.error("Microphone permission denied — use text chat instead.");
      else if (e.error !== "aborted") toast.message("Voice hiccup — try again or type below.");
    };
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
  }, [sttMode, submit, voiceLocale]);

  const stopListening = useCallback((): void => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  // ── Whisper (transformers.js via WebGPU) push-to-talk fallback ────────────
  const startWhisperCapture = useCallback(async (): Promise<void> => {
    try {
      if (!whisperRef.current) {
        setWebllmStatus("loading Whisper (first time ≈ 40 MB)…");
        const mod = (await cdnImport("https://esm.sh/@huggingface/transformers@3.7.5")) as {
          pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<(audio: Float32Array) => Promise<{ text: string }>>;
        };
        const pipe = await mod.pipeline("automatic-speech-recognition", "onnx-community/whisper-base", { dtype: "q8" });
        whisperRef.current = { transcribe: async (audio) => (await pipe(audio)).text };
        setWebllmStatus(null);
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setWebllmStatus("transcribing on-device…");
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const ctx = new AudioContext({ sampleRate: 16000 });
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        ctx.close();
        const audio = buf.getChannelData(0);
        const text = await whisperRef.current!.transcribe(audio);
        setWebllmStatus(null);
        if (text) void submit(text);
      };
      recorder.start();
      setListening(true);
      toast.message("Recording… tap the orb again to stop.");
      const stopWhenTapped = (): void => {
        if (recorder.state !== "inactive") recorder.stop();
        setListening(false);
        window.removeEventListener("click", stopWhenTapped);
      };
      setTimeout(() => window.addEventListener("click", stopWhenTapped), 300);
    } catch {
      setWebllmStatus(null);
      setListening(false);
      toast.error("Whisper needs WebGPU + mic permission — falling back to text chat.");
    }
  }, [submit]);

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
      recognitionRef.current?.stop();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      setListening(false);
      setCaption(null);
    }
  }, [open]);

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
          className="clay-raised-lg fixed bottom-20 sm:bottom-24 inset-x-3 sm:inset-x-auto sm:right-4 z-50 flex max-h-[75dvh] sm:max-h-[70dvh] sm:w-[400px] flex-col overflow-hidden no-print"
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
              {ttsOn ? <Volume2 size={12} /> : <VolumeX size={12} />} TTS
            </Chip>
            <Chip
              active={sttMode === "whisper"}
              className="h-7 text-[11px]"
              onClick={() => setSttMode(sttMode === "whisper" ? "webspeech" : "whisper")}
              title="Push-to-talk with on-device Whisper (WebGPU)"
            >
              Whisper STT
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
