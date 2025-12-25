# Requesty.ai API Documentation: GPT-4o Mini Implementation

This guide provides the technical specifications for integrating the **OpenAI GPT-4o mini** model into your web application via the Requesty.ai unified API gateway.

---

## 1. Authentication & Base Configuration
To use Requesty, you simply swap the standard OpenAI endpoint with the Requesty router.

| Parameter | Value |
| :--- | :--- |
| **Base URL** | `https://router.requesty.ai/v1` |
| **Model ID** | `openai/gpt-4o-mini` |
| **Auth Header** | `Authorization: Bearer YOUR_REQUESTY_API_KEY` |

---

## 2. Implementation via OpenAI SDK (Node.js/TS)

The most reliable way to implement this in a web app backend or a Node environment is using the official OpenAI library.

### Step 1: Install Dependency
```bash
npm install openai
```

### Step 2: Initialize and Call
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.REQUESTY_API_KEY, 
  baseURL: "https://router.requesty.ai/v1", // Directs traffic through Requesty
});

async function main() {
  try {
    const completion = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise web assistant." },
        { role: "user", content: "How do I implement a debounced search in React?" }
      ],
    });

    console.log(completion.choices[0].message.content);
  } catch (error) {
    console.error("API Error:", error.message);
  }
}

main();
```

---

## 3. Implementation via Fetch API (Client-Side/Edge)

For lightweight implementations or Edge Functions where you don't want to bundle a full SDK.

```javascript
async function callGptMini(prompt) {
  const response = await fetch('https://router.requesty.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.REQUESTY_API_KEY}`
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6
    })
  });

  return await response.json();
}
```

---

## 4. Multimodal Support (Vision)

GPT-4o mini supports image processing. You can pass image URLs directly in the message content.

```javascript
const response = await client.chat.completions.create({
  model: "openai/gpt-4o-mini",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What's in this image?" },
        {
          type: "image_url",
          image_url: { "url": "https://example.com/screenshot.png" },
        },
      ],
    },
  ],
});
```

---

## 5. Security & Best Practices

* **Server-Side Only:** Never expose your Requesty API key in client-side code (HTML/Frontend JS). Use a backend proxy or environment variables.
* **Streaming:** For a better UX, set `stream: true` to receive partial results as they are generated.
* **Routing:** You can change `openai/gpt-4o-mini` to `anthropic/claude-3-haiku` at any time without changing your code logic.

---
*Documentation generated for Requesty.ai Integration (2025).*