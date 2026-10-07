// One assistant turn with Gemini: the model calls tools until it can answer. Server-only.
// The model's own turns are sent back unchanged, which keeps Gemini 3 thought signatures valid.

export type Part = Record<string, any>;
export type Content = { role: 'user' | 'model'; parts: Part[] };
export class AssistantFailure extends Error {
  constructor(
    public key: 'quota' | 'config' | 'down' | 'empty',
    public status: number,
  ) {
    super(key);
  }
}

const MAX_ROUNDS = 8;
const MAX_CALLS = 24;
export const geminiModel = () => {
  const model = process.env.GEMINI_MODEL?.trim() || '';
  return /^[a-z0-9.-]{3,60}$/.test(model) ? model : 'gemini-3.8-flash';
};

async function generate(key: string, model: string, body: object, timeout: number): Promise<Content> {
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      },
    );
  } catch {
    throw new AssistantFailure('down', 504);
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = String((await response.json())?.error?.message || '').slice(0, 200);
    } catch {}
    // Google's messages never contain the key; they help tell a bad request from a bad key.
    console.error('assistant_gemini', { status: response.status, model, detail });
    if (response.status === 429) throw new AssistantFailure('quota', 429);
    if ([401, 403, 404].includes(response.status) || /api key/i.test(detail))
      throw new AssistantFailure('config', 502);
    throw new AssistantFailure('down', 502);
  }
  const data: any = await response.json();
  const content = data?.candidates?.[0]?.content;
  if (!content || !Array.isArray(content.parts) || !content.parts.length) {
    console.error('assistant_gemini_empty', { finish: data?.candidates?.[0]?.finishReason });
    throw new AssistantFailure('empty', 502);
  }
  return { role: 'model', parts: content.parts };
}

const textOf = (content: Content) =>
  content.parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();

export async function converse(options: {
  key: string;
  system: string;
  contents: Content[];
  tools: object[];
  execute: (name: string, args: unknown) => Promise<unknown>;
  /** Epoch ms after which the model must answer without more tools. */
  deadline: number;
}): Promise<string> {
  const model = geminiModel();
  const contents = [...options.contents];
  const thinkingConfig = model.startsWith('gemini-2') ? { thinkingBudget: 0 } : { thinkingLevel: 'low' };
  const request = (final: boolean) => ({
    systemInstruction: { parts: [{ text: options.system }] },
    contents,
    tools: [{ functionDeclarations: options.tools }],
    toolConfig: { functionCallingConfig: { mode: final ? 'NONE' : 'AUTO' } },
    generationConfig: { maxOutputTokens: 4096, thinkingConfig },
  });
  let calls = 0;
  for (let round = 0; ; round++) {
    const left = options.deadline - Date.now();
    const final = round >= MAX_ROUNDS || calls >= MAX_CALLS || left < 15000;
    const content = await generate(options.key, model, request(final), Math.max(8000, Math.min(30000, left)));
    contents.push(content);
    const wanted = content.parts.filter((p) => p.functionCall?.name);
    if (!wanted.length || final) {
      const text = textOf(content);
      if (!text) throw new AssistantFailure('empty', 502);
      return text;
    }
    const responses: Part[] = [];
    for (const part of wanted) {
      calls++;
      const { name, args, id } = part.functionCall;
      const result =
        calls > MAX_CALLS ? { error: 'Too many tool calls: answer now.' } : await options.execute(name, args);
      responses.push({ functionResponse: { ...(id ? { id } : {}), name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
}
