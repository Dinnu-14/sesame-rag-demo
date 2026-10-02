export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { system, question } = req.body || {};
  if (!question) {
    return res.status(400).json({ error: "Missing question" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: question }],
      }),
    });

    const data = await response.json();

    console.log("Anthropic status:", response.status);
    console.log("Anthropic response:", JSON.stringify(data));

    if (!response.ok) {
      return res.status(200).json({
        text: `DEBUG ERROR (${response.status}): ${JSON.stringify(data.error || data)}`,
      });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({ text: text || "DEBUG: empty response from Anthropic" });
  } catch (err) {
    console.log("Caught exception:", err.message);
    return res.status(200).json({ text: `DEBUG EXCEPTION: ${err.message}` });
  }
}
