
import { Buffer } from 'buffer';

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  // Only POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({
      error: 'GROQ_API_KEY is missing in Vercel environment variables.'
    });
  }

  try {
    // Receive raw audio from frontend
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      );
    }

    const buffer = Buffer.concat(chunks);

    if (!buffer.length) {
      return res.status(400).json({
        error: 'No audio received. Please record your voice first.'
      });
    }

    // 1. Speech-to-text using Groq Whisper
    const formData = new FormData();

    const audioBlob = new Blob([buffer], {
      type: 'audio/webm'
    });

    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'json');

    const sttResponse = await fetch(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        body: formData
      }
    );

    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();

      console.error('Groq STT error:', errorText);

      return res.status(502).json({
        error: `Speech recognition failed (${sttResponse.status}).`,
        details: errorText
      });
    }

    const sttData = await sttResponse.json();
    const userText = sttData.text?.trim();

    if (!userText) {
      return res.status(400).json({
        error: 'Could not understand audio. Please speak again.'
      });
    }

    // 2. English Speaking Tutor
    const systemPrompt = `
You are a friendly English speaking tutor for beginners.

Rules:
1. If the user makes an English grammar mistake, show:
Correction: [correct sentence]
2. Reply in one or two simple English sentences.
3. Use easy English suitable for beginners.
4. If the user speaks Hindi, explain how to express the idea in English.
5. Be encouraging, polite, and friendly.
6. Give practical examples when helpful.
`;

    const llmResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userText
            }
          ],
          temperature: 0.5,
          max_completion_tokens: 250
        })
      }
    );

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();

      console.error('Groq LLM error:', errorText);

      return res.status(502).json({
        error: `AI response failed (${llmResponse.status}).`,
        details: errorText,
        userText
      });
    }

    const llmData = await llmResponse.json();

    const aiReply =
      llmData.choices?.[0]?.message?.content?.trim();

    if (!aiReply) {
      return res.status(502).json({
        error: 'The AI returned an empty response.',
        userText
      });
    }

    // Send both transcript and AI response to frontend
    return res.status(200).json({
      success: true,
      userText,
      aiReply
    });

  } catch (error) {
    console.error('Chat API error:', error);

    return res.status(500).json({
      error: 'Internal server error.',
      details: error.message
    });
  }
}
