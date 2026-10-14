const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async (request) => {
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return Response.json({ error: "Falta ANTHROPIC_API_KEY en Netlify." }, { status: 500, headers: CORS });

  const b = await request.json().catch(() => ({}));
  const ingredientes = String(b.ingredientes || "").slice(0, 1200);
  const equipos = String(b.equipos || "estufa y sarten").slice(0, 400);
  if (!ingredientes) return Response.json({ error: "Sin ingredientes." }, { status: 400, headers: CORS });

  const system = `Eres un chef profesional con dominio de cocina colombiana, latinoamericana, europea y asiatica.
Propon 3 preparaciones D
