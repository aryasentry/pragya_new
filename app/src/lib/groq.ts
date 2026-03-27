import { env } from "@/lib/env";

type GroqResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function describeImageWithGroq(base64ImageData: string, mimeType: string): Promise<string> {
  if (!env.groqApiKey) {
    throw new Error("Missing GROQ_API_KEY for multimodal image handling.");
  }

  const imageUrl = `data:${mimeType};base64,${base64ImageData}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Extract legally relevant text and describe visual legal context. Return concise but specific output in plain text.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Perform OCR and describe this legal image/document scan for retrieval indexing.",
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq image description failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as GroqResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Groq returned empty image description.");
  }

  return content;
}
