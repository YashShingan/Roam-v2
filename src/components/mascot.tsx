"use client";

import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, Mic, Sparkles, Volume2, X, Minimize2, Maximize2, Compass } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { cn } from "./ui";

export interface MascotProps {
  city?: string;
  onOpenVoice: () => void;
  onSelectPrompt?: (prompt: string) => void;
  isVoiceOpen?: boolean;
  isPlanOpen?: boolean;
  stopsCount?: number;
}

function playWakeChime() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(440, now); // A4
    osc2.frequency.exponentialRampToValueAtTime(659.25, now + 0.12); // E5

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.3);
    osc2.stop(now + 0.3);
  } catch {
    // AudioContext blocked before user gesture — ignore
  }
}

export function MascotWidget({
  city = "Pune",
  onOpenVoice,
  onSelectPrompt,
  isVoiceOpen = false,
  isPlanOpen = false,
  stopsCount = 0,
}: MascotProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(true);
  const [currentThought, setCurrentThought] = useState<string>("Where do you want to roam next?");
  const [thoughtAction, setThoughtAction] = useState<{ text: string; prompt?: string }>({
    text: "Quick 2h Plan",
    prompt: "Plan a quick 2-hour micro trip",
  });
  const [ready, setReady] = useState(false);

  // Position & autonomous roaming targets
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 20, y: 350 });
  const targetPosRef = useRef<{ x: number; y: number }>({ x: 20, y: 350 });
  const posRef = useRef<{ x: number; y: number }>({ x: 20, y: 350 });
  posRef.current = pos;

  // Flight velocity & dynamic 3D banking (leaning into turns)
  const bankRef = useRef(0);

  // User drag interaction tracking
  const userPausedUntilRef = useRef<number>(0);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    hasMoved: false,
  });

  // 1. Fetch Groq Thought
  const fetchGroqThought = useCallback(
    async (context: "idle" | "day_plan_open" = "idle") => {
      try {
        const res = await fetch("/api/mascot/thought", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city,
            context,
            stopsCount,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { thought?: string };
          if (data?.thought) {
            setCurrentThought(data.thought);
            setBubbleVisible(true);
            if (context === "day_plan_open") {
              setThoughtAction({ text: "Optimize Route", prompt: "Optimize the itinerary route" });
            } else {
              setThoughtAction({ text: "Ask Roamy", prompt: `Tell me a hidden gem in ${city}` });
            }
          }
        }
      } catch {
        // Fallback default
        setCurrentThought(`Exploring ${city}! Click me to speak anytime.`);
      }
    },
    [city, stopsCount]
  );

  // 2. Initial Position Setup with LocalStorage Memory
  useEffect(() => {
    let defaultX = Math.max(20, window.innerWidth - 220);
    let defaultY = Math.max(20, window.innerHeight - 300);

    try {
      const saved = localStorage.getItem("roam_mascot_pos");
      if (saved) {
        const parsed = JSON.parse(saved) as { x: number; y: number };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          defaultX = Math.max(10, Math.min(window.innerWidth - 200, parsed.x));
          defaultY = Math.max(10, Math.min(window.innerHeight - 240, parsed.y));
        }
      }
    } catch {
      // ignore
    }

    setPos({ x: defaultX, y: defaultY });
    targetPosRef.current = { x: defaultX, y: defaultY };
    setReady(true);
    void fetchGroqThought("idle");
  }, [fetchGroqThought]);

  // 3. Autonomous Roaming Interval (Every 28–42 seconds glide to safe anchor)
  useEffect(() => {
    if (!ready || isMinimized) return;

    const interval = setInterval(() => {
      // Do not roam if user dragged recently (< 60s ago) or currently dragging
      if (Date.now() < userPausedUntilRef.current || dragRef.current.isDragging) {
        return;
      }

      // Safe anchor positions on the screen
      const anchors = [
        { x: window.innerWidth - 220, y: window.innerHeight - 300 }, // Bottom-Right
        { x: window.innerWidth - 210, y: Math.max(140, Math.floor(window.innerHeight * 0.42)) }, // Mid-Right
        { x: 35, y: window.innerHeight - 280 }, // Bottom-Left
        { x: Math.max(20, window.innerWidth - 380), y: 90 }, // Top-Right below navbar
      ];

      // Pick an anchor distant from current position
      const candidates = anchors.filter(
        (a) => Math.hypot(a.x - posRef.current.x, a.y - posRef.current.y) > 120
      );
      const nextAnchor = candidates[Math.floor(Math.random() * candidates.length)] || anchors[0];

      targetPosRef.current = {
        x: Math.max(10, Math.min(window.innerWidth - 200, nextAnchor.x)),
        y: Math.max(10, Math.min(window.innerHeight - 240, nextAnchor.y)),
      };

      // Fetch a fresh witty observation upon roaming
      void fetchGroqThought("idle");
    }, 32000);

    return () => clearInterval(interval);
  }, [ready, isMinimized, fetchGroqThought]);

  // 4. Day Plan Sneak-In Reaction (Peeks beside Day Planner when opened)
  useEffect(() => {
    if (!ready || isMinimized) return;

    if (isPlanOpen) {
      // Glide over to peek next to the maximized/open Day Planner drawer
      const sneakX = Math.max(20, window.innerWidth - 480);
      const sneakY = 120;

      targetPosRef.current = {
        x: Math.max(10, Math.min(window.innerWidth - 200, sneakX)),
        y: sneakY,
      };

      void fetchGroqThought("day_plan_open");
    }
  }, [isPlanOpen, ready, isMinimized, fetchGroqThought]);

  // 5. Smooth Spring Position Lerp Frame Loop
  useEffect(() => {
    if (!ready) return;
    let animFrame: number;

    const lerpLoop = () => {
      animFrame = requestAnimationFrame(lerpLoop);

      // Only lerp position if not actively dragged
      if (!dragRef.current.isDragging) {
        const curX = posRef.current.x;
        const curY = posRef.current.y;
        const targetX = targetPosRef.current.x;
        const targetY = targetPosRef.current.y;

        const dx = targetX - curX;
        const dy = targetY - curY;
        const dist = Math.hypot(dx, dy);

        if (dist > 1) {
          // Smooth spring easing
          const step = Math.min(0.05, Math.max(0.02, dist * 0.0004));
          const nextX = curX + dx * step;
          const nextY = curY + dy * step;

          // Compute horizontal flight banking tilt
          const vx = dx * step;
          bankRef.current = Math.max(-0.25, Math.min(0.25, -vx * 0.05));

          setPos({ x: nextX, y: nextY });
        } else {
          // Recover to upright orientation when resting
          bankRef.current *= 0.92;
        }
      } else {
        bankRef.current *= 0.85;
      }
    };

    animFrame = requestAnimationFrame(lerpLoop);
    return () => cancelAnimationFrame(animFrame);
  }, [ready]);

  // 6. Speech & Voice Event Coordination
  useEffect(() => {
    const handleSpeechStart = () => setIsSpeaking(true);
    const handleSpeechEnd = () => setIsSpeaking(false);
    const handleListeningStart = () => setIsListening(true);
    const handleListeningEnd = () => setIsListening(false);

    window.addEventListener("roam:speech-start", handleSpeechStart);
    window.addEventListener("roam:speech-end", handleSpeechEnd);
    window.addEventListener("roam:voice-listening", handleListeningStart);
    window.addEventListener("roam:voice-idle", handleListeningEnd);

    return () => {
      window.removeEventListener("roam:speech-start", handleSpeechStart);
      window.removeEventListener("roam:speech-end", handleSpeechEnd);
      window.removeEventListener("roam:voice-listening", handleListeningStart);
      window.removeEventListener("roam:voice-idle", handleListeningEnd);
    };
  }, []);

  // 7. Three.js Canvas Scene Lifecycle with Upright Orientation
  useEffect(() => {
    if (!ready || isMinimized) return;
    const container = containerRef.current;
    if (!container) return;

    let animId: number;
    let isDisposed = false;

    const width = 110;
    const height = 96;

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0, 5.0);

    // WebGLRenderer with transparency
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.pointerEvents = "none";

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Studio Environment lighting for realistic PBR metal & reflections
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch {
      // fallback to ambient
    }

    // Direct lighting
    const ambLight = new THREE.AmbientLight(0xfff7ee, 2.5);
    scene.add(ambLight);

    const keyLight = new THREE.DirectionalLight(0xff7a45, 3.5);
    keyLight.position.set(5, 7, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    fillLight.position.set(-5, 4, 3);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x06b6d4, 3.0);
    rimLight.position.set(-5, -2, -3);
    scene.add(rimLight);

    const mascotMaster = new THREE.Group();
    scene.add(mascotMaster);

    // ── Instant Procedural Mascot (Renders on Frame 1) ───────────────────────
    const proceduralGroup = new THREE.Group();
    proceduralGroup.scale.set(0.52, 0.52, 0.52);

    // Body (Terracotta metallic sphere)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff6b35,
      roughness: 0.25,
      metalness: 0.35,
      emissive: 0x3d1705,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 36, 36), bodyMat);
    proceduralGroup.add(body);

    // Visor Dome (Dark reflective curved glass)
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.1,
      metalness: 0.8,
    });
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 32), visorMat);
    visor.position.set(0, -0.02, 0.3);
    visor.scale.set(0.9, 0.85, 0.65);
    proceduralGroup.add(visor);

    // Glowing Cyan Eyes
    const eyeCurve = new THREE.TorusGeometry(0.09, 0.024, 16, 32, Math.PI);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const leftEye = new THREE.Mesh(eyeCurve, eyeMat);
    leftEye.position.set(-0.2, 0.04, 0.65);
    leftEye.rotation.x = Math.PI * 0.95;
    proceduralGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeCurve, eyeMat);
    rightEye.position.set(0.2, 0.04, 0.65);
    rightEye.rotation.x = Math.PI * 0.95;
    proceduralGroup.add(rightEye);

    // Headset
    const headsetMat = new THREE.MeshStandardMaterial({ color: 0x1f232b, metalness: 0.85, roughness: 0.25 });
    const silverMat = new THREE.MeshStandardMaterial({ color: 0xc8d2de, metalness: 0.95, roughness: 0.15 });

    const cupGeo = new THREE.CylinderGeometry(0.28, 0.31, 0.16, 24);
    const cupL = new THREE.Mesh(cupGeo, headsetMat);
    cupL.rotation.z = Math.PI / 2;
    cupL.position.set(-0.82, 0.06, 0);
    proceduralGroup.add(cupL);

    const cupR = cupL.clone();
    cupR.position.set(0.82, 0.06, 0);
    proceduralGroup.add(cupR);

    // Mic Boom & Tip
    const boomCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.82, 0.04, 0.1),
      new THREE.Vector3(0.66, -0.22, 0.4),
      new THREE.Vector3(0.35, -0.29, 0.72),
      new THREE.Vector3(0.05, -0.31, 0.79),
    ]);
    const boom = new THREE.Mesh(new THREE.TubeGeometry(boomCurve, 24, 0.018, 10, false), silverMat);
    proceduralGroup.add(boom);

    const micTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.025), eyeMat);
    micTip.position.set(0.03, -0.31, 0.83);
    proceduralGroup.add(micTip);

    mascotMaster.add(proceduralGroup);

    // ── Load /mascot.glb with MeshoptDecoder & Upright Forward Calibration ────
    MeshoptDecoder.ready.then(() => {
      if (isDisposed) return;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      loader.load(
        "/mascot.glb",
        (gltf) => {
          if (isDisposed) return;
          const glbModel = gltf.scene;

          // Double-sided bright PBR materials
          glbModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              if (mesh.material) {
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.side = THREE.DoubleSide;
                mat.needsUpdate = true;
                if (mat.metalness > 0.8) mat.metalness = 0.4;
                if (mat.roughness < 0.2) mat.roughness = 0.35;
              }
            }
          });

          // Auto-center and normalize size
          const box = new THREE.Box3().setFromObject(glbModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          glbModel.position.sub(center);

          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 1.30 / (maxDim || 1);
          glbModel.scale.set(scale, scale, scale);

          // ── Calibration: Face & Visor Look Directly Forward at Camera ───────
          // Rotated 180° around Y-axis from rear dome so front visor & eyes point forward (+Z)
          glbModel.rotation.y = -Math.PI / 2;
          glbModel.rotation.x = 0;
          glbModel.rotation.z = 0;

          // Replace procedural mascot with loaded GLB model
          mascotMaster.remove(proceduralGroup);
          mascotMaster.add(glbModel);
        },
        undefined,
        (err) => {
          console.info("Using procedural mascot model:", (err as Error)?.message || "Local fallback active");
        }
      );
    });

    // ── Animation Loop ────────────────────────────────────────────────────────
    const startTime = performance.now();

    function renderLoop() {
      animId = requestAnimationFrame(renderLoop);
      const elapsed = (performance.now() - startTime) / 1000;

      // Base hovering levitation
      const hoverY = Math.sin(elapsed * 2.2) * 0.08;
      const hoverRotY = Math.sin(elapsed * 1.1) * 0.12;
      const hoverRotX = Math.sin(elapsed * 1.6) * 0.03;

      // Directional Banking Roll from velocity
      const currentBankZ = bankRef.current;

      // Audio Speech Reactivity (Head-bobbing synced to speech)
      if (isSpeaking) {
        mascotMaster.position.y = hoverY + Math.sin(elapsed * 9.0) * 0.06;
        mascotMaster.rotation.y = hoverRotY + Math.sin(elapsed * 6.0) * 0.09;
        mascotMaster.rotation.x = hoverRotX + Math.sin(elapsed * 10.0) * 0.05;
        mascotMaster.rotation.z = currentBankZ;
      } else if (isListening) {
        // Attentive tilt when user speaks
        mascotMaster.position.y = hoverY + 0.04;
        mascotMaster.rotation.y = 0.2;
        mascotMaster.rotation.z = currentBankZ - 0.06;
        mascotMaster.rotation.x = hoverRotX - 0.05;
      } else {
        mascotMaster.position.y = hoverY;
        mascotMaster.rotation.y = hoverRotY;
        mascotMaster.rotation.z = currentBankZ;
        mascotMaster.rotation.x = hoverRotX;
      }

      renderer.render(scene, camera);
    }
    renderLoop();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animId);
      renderer.dispose();
      container.innerHTML = "";
    };
  }, [ready, isMinimized, isSpeaking, isListening]);

  // 8. Pointer Dragging with 60s Roaming Pause
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, [data-no-drag]")) {
      return;
    }
    const widget = widgetRef.current;
    if (!widget) return;

    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: pos.x,
      initialY: pos.y,
      hasMoved: false,
    };

    widget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.isDragging) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    if (Math.hypot(deltaX, deltaY) > 5) {
      dragRef.current.hasMoved = true;
    }

    const nextX = Math.max(10, Math.min(window.innerWidth - 190, dragRef.current.initialX + deltaX));
    const nextY = Math.max(10, Math.min(window.innerHeight - 230, dragRef.current.initialY + deltaY));

    targetPosRef.current = { x: nextX, y: nextY };
    setPos({ x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const target = e.target as HTMLElement | null;
    if (target?.closest("button, [data-no-drag]")) {
      return;
    }

    if (!dragRef.current.hasMoved) {
      handleMascotClick();
    } else {
      // Pause autonomous roaming for 60 seconds to respect user drag placement
      userPausedUntilRef.current = Date.now() + 60000;
      try {
        localStorage.setItem("roam_mascot_pos", JSON.stringify(pos));
      } catch {
        // ignore
      }
    }
  };

  const handleMascotClick = useCallback(() => {
    playWakeChime();
    onOpenVoice();
    window.dispatchEvent(new CustomEvent("roam:wake-activated"));
  }, [onOpenVoice]);

  if (!ready) return null;

  const isNearRight = typeof window !== "undefined" && pos.x > window.innerWidth - 180;
  const isNearLeft = pos.x < 180;
  const isNearTop = pos.y < 120;

  return (
    <>
      {/* ── Minimized Floating Avatar Pill ────────────────────────────────────── */}
      {isMinimized ? (
        <div
          style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
          className="fixed z-50 flex items-center gap-2 rounded-full clay-raised-sm bg-card/90 px-3 py-2 shadow-lg backdrop-blur-md cursor-pointer border border-primary/30"
          onClick={() => setIsMinimized(false)}
          title="Restore 3D Mascot Roamy"
        >
          <span className="flex h-3 w-3 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-bold text-foreground">Roamy</span>
          <Maximize2 size={13} className="text-muted-foreground ml-1" />
        </div>
      ) : (
        /* ── Full Interactive 3D Mascot Widget ───────────────────────────────── */
        <div
          ref={widgetRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
          className="fixed z-50 flex flex-col items-center select-none cursor-grab active:cursor-grabbing touch-none"
          role="region"
          aria-label="3D Mascot Companion Roamy"
        >
          {/* Smart Groq Thought Bubble (Positioned absolutely so toggling never shifts the 3D model) */}
          <AnimatePresence mode="wait">
            {bubbleVisible && currentThought && (
              <motion.div
                key={currentThought}
                data-no-drag="true"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                initial={{ opacity: 0, y: isNearTop ? -6 : 6, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: isNearTop ? -6 : 6, scale: 0.92 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className={cn(
                  "absolute z-10 w-max max-w-[170px] rounded-2xl bg-card/95 p-2 text-xs shadow-xl backdrop-blur-md border border-border/60 pointer-events-auto",
                  isNearTop ? "top-full mt-2" : "bottom-full mb-2",
                  isNearRight
                    ? "right-0"
                    : isNearLeft
                    ? "left-0"
                    : "left-1/2 -translate-x-1/2"
                )}
              >
                {/* Dismiss button */}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBubbleVisible(false);
                  }}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded cursor-pointer"
                  aria-label="Dismiss message"
                >
                  <X size={12} />
                </button>

                <p className="pr-3 leading-relaxed text-foreground font-semibold text-[10.5px] sm:text-[11px]">
                  {currentThought}
                </p>

                {thoughtAction && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (thoughtAction.prompt) {
                        onSelectPrompt?.(thoughtAction.prompt);
                      }
                    }}
                    className="mt-2 flex items-center gap-1 rounded-full bg-primary/15 hover:bg-primary/25 border border-primary/30 px-2.5 py-1 text-[10px] font-bold text-primary transition-all cursor-pointer"
                  >
                    <Sparkles size={10} />
                    <span>{thoughtAction.text}</span>
                  </button>
                )}

                {/* Speech Bubble Tail */}
                <div
                  className={cn(
                    "absolute h-3 w-3 rotate-45 bg-card/95",
                    isNearTop
                      ? "-top-1.5 border-l border-t border-border/60"
                      : "-bottom-1.5 border-r border-b border-border/60",
                    isNearRight
                      ? "right-8"
                      : isNearLeft
                      ? "left-8"
                      : "left-1/2 -translate-x-1/2"
                  )}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Three.js Canvas Container */}
          <div className="relative w-[110px] h-[96px]">
            <div ref={containerRef} className="h-full w-full pointer-events-none" />

            {/* Quick Action Overlay Icons */}
            <div className="absolute top-0 right-1 flex items-center gap-1" data-no-drag="true">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMinimized(true);
                }}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-card/80 text-muted-foreground hover:text-foreground border border-border/50 text-[10px] transition-all cursor-pointer"
                title="Minimize Mascot"
                aria-label="Minimize Mascot"
              >
                <Minimize2 size={10} />
              </button>
            </div>
          </div>

          {/* Floating Drag Indicator Pill */}
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 shadow-md backdrop-blur-md border text-[9.5px] font-bold transition-all pointer-events-none",
              isSpeaking
                ? "bg-primary/20 border-primary/40 text-primary shadow-primary/20"
                : isListening
                ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-400 animate-pulse"
                : "bg-surface/85 border-border/60 text-foreground"
            )}
          >
            {isSpeaking ? (
              <>
                <Volume2 size={11} className="animate-bounce text-primary" />
                <span>Roamy Speaking…</span>
              </>
            ) : isListening ? (
              <>
                <Mic size={11} className="text-cyan-400" />
                <span>Listening to you…</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500 animate-pulse" />
                <span>Click to Ask · Drag</span>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
