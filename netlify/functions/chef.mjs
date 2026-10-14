const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REGLAS = [
  "Eres un chef profesional con dominio de cocina colombiana, latinoamericana, europea y asiatica.",
  "Propon 3 preparaciones DISTINTAS entre si (distinta tecnica) usando SOLO lo que el usuario tiene.",
  "No inventes ingredientes que no listo. Si algo opcional mejoraria el plato, ponlo al final como 'Si consigues: ...'.",
  "Respeta los equipos: sin horno, nada horneado. Da cantidades y tiempos reales.",
  "Responde en espanol, en Markdown, sin preambulo, con este formato por plato:",
  "## nombre del plato",
  "**Tecnica:** tecnica - **Tiempo:** min - **Porciones:** n",
  "**Ingredientes:** lista con cantidades",
  "**Pasos:**",
  "1. primer paso",
  "**Tip:** un tip de tecnica explicando el porque",
].join("\n");

export default async (request) => {
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

  const key = (Netlify.env.get("ANTHROPIC_API_KEY") || "").trim();
  if (!key) return Response.json({ error: "Falta ANTHROPIC_API_KEY en Netlify." }, { status: 500, headers: CORS });

  const b = await request.json().catch(() => ({}));
  const ingredientes = String(b.ingredientes || "").slice(0, 1200);
  const equipos = String(b.equipos || "estufa y sarten").slice(0, 400);
  if (!ingredientes) return Response.json({ error: "Sin ingredientes." }, { status: 400, headers: CORS });

  const pregunta = "Tengo: " + ingredientes + ". Equipos: " + equipos + ". Que puedo preparar?";

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      thinking: { type: "disabled" },
      system: REGLAS,
      messages: [{ role: "user", content: pregunta }],
    }),
  }).catch(() => null);

  if (!r) return Response.json({ error: "No se pudo contactar la API." }, { status: 502, headers: CORS });

  const data = await r.json().catch(() => null);

  if (!r.ok) {
    const detalle = data && data.error && data.error.message ? data.error.message : "";
    return Response.json({ error: "La API respondio " + r.status + ". " + detalle }, { status: 502, headers: CORS });
  }

  const texto = ((data && data.content) || []).filter(x => x.type === "text").map(x => x.text).join("\n").trim();

  if (!texto) {
    const motivo = data && data.stop_reason ? " (stop_reason: " + data.stop_reason + ")" : "";
    return Response.json({ error: "El modelo no devolvio texto" + motivo + "." }, { status: 502, headers: CORS });
  }

  return Response.json({ texto }, { headers: CORS });
};
