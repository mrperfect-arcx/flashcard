import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server misconfigured: missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are an expert flashcard creator.
Return ONLY valid JSON, no extra text.

Create ${count} high-quality flashcards from the NOTES below.

Output schema (exact):
{\n  "title": string,\n  "flashcards": [{"question": string, "answer": string, "tags": string[]}]\n}

Rules:
- Questions must be clear, specific, and test understanding.
- Answers must be concise but complete.
- No markdown.
- Style: ${style} (balanced = mix of definitions+concepts, exam = more application, simple = easy language)

NOTES:\n${notes}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = extractJson(text) as any;

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

