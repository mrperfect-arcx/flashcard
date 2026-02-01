import { NextResponse } from "next/server";

export const runtime = "nodejs"; // important for Vercel

type Flashcard = {
  question: string;
  answer: string;
  tags?: string[];
};

function extractJson(text: string): unknown {
  // Prefer fenced ```json blocks if present
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1]);

  // Fallback: first JSON object/array in the text
  const first = Math.min(...[text.indexOf("["), text.indexOf("{")].filter((n) => n !== -1));
  const last = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (first !== Infinity && first >= 0 && last > first) {
    return JSON.parse(text.slice(first, last + 1));
  }
  throw new Error("Model did not return valid JSON");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const notes = String(body?.notes ?? "").trim();
    const count = Math.max(3, Math.min(50, Number(body?.count ?? 12)));
    const style = String(body?.style ?? "balanced");

    if (!notes) {
      return NextResponse.json({ error: "Notes are required" }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing GROQ_API_KEY" },
        { status: 500 }
      );
    }

    const prompt = `You are an expert flashcard creator.
Return ONLY valid JSON, no extra text.

Create ${count} high-quality flashcards from the NOTES below.

Output schema (exact):
{
  "title": string,
  "flashcards": [
    { "question": string, "answer": string, "tags": string[] }
  ]
}

Rules:
- Questions must be clear, specific, and test understanding.
- Answers must be concise but complete.
- No markdown.
- Tags: 0-6 short tags per card.
- Style: ${style} (balanced = mix of definitions+concepts, exam = more application, simple = easy language)

NOTES:
${notes}`.trim();

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0.3,
        // Ask for strict JSON output (supported on Groq OpenAI-compatible endpoint)
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output only valid JSON." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!groqRes.ok) {
      const details = await groqRes.text();
      return NextResponse.json(
        { error: "Groq request failed", details },
        { status: groqRes.status }
      );
    }

    const data = await groqRes.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      return NextResponse.json({ error: "No response from Groq" }, { status: 502 });
    }

    // Parse JSON (should already be JSON, but we keep your safe extractor)
    const parsed = ((): any => {
      try {
        return JSON.parse(text);
      } catch {
        return extractJson(text);
      }
    })();

    const title = String(parsed?.title ?? "Flashcards");
    const flashcards = Array.isArray(parsed?.flashcards) ? parsed.flashcards : [];

    const cleaned: Flashcard[] = flashcards
      .map((c: any) => ({
        question: String(c?.question ?? "").trim(),
        answer: String(c?.answer ?? "").trim(),
        tags: Array.isArray(c?.tags) ? c.tags.map((t: any) => String(t)).slice(0, 6) : [],
      }))
      .filter((c: Flashcard) => c.question && c.answer)
      .slice(0, count);

    return NextResponse.json({ title, flashcards: cleaned });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
