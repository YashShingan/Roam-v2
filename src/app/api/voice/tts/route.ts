import { NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const dynamic = "force-dynamic";

const VOICE_MAP: Record<string, string> = {
  mr: "mr-IN-AarohiNeural",
  hi: "hi-IN-SwaraNeural",
  en: "en-IN-NeerjaNeural",
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string; lang?: string };
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "No text provided for speech synthesis." }, { status: 400 });
    }

    const voice = VOICE_MAP[body.lang || "en"] || "en-IN-NeerjaNeural";
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    // Limit text length to prevent timeout on very large answers
    const sanitizedText = text.slice(0, 1000);
    const { audioStream } = tts.toStream(sanitizedText);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end", () => resolve());
      audioStream.on("error", (err: Error) => reject(err));
    });

    const audioBuffer = Buffer.concat(chunks);

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Edge TTS synthesis error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS synthesis failed" },
      { status: 500 },
    );
  }
}
