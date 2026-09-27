import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GROQ_API_KEY = process.env.GROQ_API_KEY;

export async function POST(req: Request) {
  try {
    if (!GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured on the server. Falling back to browser speech recognition." },
        { status: 501 },
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get("file");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "No audio file provided in request." }, { status: 400 });
    }

    // Prepare payload for Groq Whisper Large v3
    const groqPayload = new FormData();
    groqPayload.append("file", audioFile, "audio.webm");
    groqPayload.append("model", "whisper-large-v3");
    groqPayload.append("temperature", "0.0");
    groqPayload.append(
      "prompt",
      "Travel assistant Roam, Hey Roamy, Hey Vibe, Roamy. Travel in India. Indian cities, heritage monuments, forts, temples, food. E.g. Shaniwar Wada, Aga Khan Palace, Sinhagad Fort, Pataleshwar, Kalyan, Titwala, Badlapur, FC Road, Irani Chai, Misal Pav, Vada Pav.",
    );

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: groqPayload,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn("Groq Whisper API error:", res.status, errText);
      return NextResponse.json({ error: `Groq Whisper error: ${res.statusText}` }, { status: res.status });
    }

    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim() || "";

    return NextResponse.json({ text });
  } catch (err) {
    console.error("Transcribe API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Audio transcription failed" },
      { status: 500 },
    );
  }
}
