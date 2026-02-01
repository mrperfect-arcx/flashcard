// app/api/flashcards/route.js
export const runtime = "nodejs"; // important for Vercel: keep this route on Node (not Edge)

function buildFlashcardPrompt(userText) {
  return `
You are a flashcard generator. Convert the user's notes into high-quality study flashcards.

Rules:
- Output ONLY valid JSON (no markdown, no backticks).
- JSON schema:
{
  "title": string,
  "summary": string,
  "cards": [
    {
      "front": string,
      "back": string,
      "tags": string[]
    }
  ]
}
- Create 12 to 25 cards depending on content depth (prefer quality).
- Keep fronts short and exam-friendly.
- Backs should be clear, accurate, and structured (bullets allowed as plain text).
- Add 1-3 relevant tags per card.

User notes:
"""${userText}"""
`.trim();
}

export async function POST(req) {
  try {
    const { text, notes, prompt } = await req.json().catch(() => ({}));
    const userText = (text || notes || prompt || "").trim();

    if (!userText) {
      return Response.json(
        { error: "Missing input. Send { text: 'your notes' }" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "Missing GROQ_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise flashcard generator." },
          { role: "user", content: buildFlashcardPrompt(userText) },
        ],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return Response.json(
        { error: "Groq request failed", details: errText },
        { status: groqRes.status }
      );
    }

    const data = await groqRes.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return Response.json(
        { error: "No content returned from Groq." },
        { status: 502 }
      );
    }

    // Content should already be JSON string due to response_format, but we parse safely.
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      // If the model accidentally included extra text, try to extract JSON.
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start >= 0 && end > start) {
        json = JSON.parse(content.slice(start, end + 1));
      } else {
        throw new Error("Model did not return valid JSON.");
      }
    }

    return Response.json(json, { status: 200 });
  } catch (e) {
    console.error(e);
    return Response.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
