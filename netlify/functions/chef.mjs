// netlify/functions/chef.mjs
// Recibe la despensa del cocinero y le pide platos a Claude.
// Ahora va con criterio: los papeles de cada insumo, las parejas que
// existen entre lo que tiene y por que funcionan, y las bases de la casa.
// La API key nunca viaja al navegador: vive solo aqui.
//
// OJO: este archivo no lleva ni una comilla invertida a proposito.
// Un template literal pegado desde el celular rompe el build de esbuild.

const MODELO = "claude-haiku-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const corta = (v, n) => String(v || "").slice(0, n);

const REGLAS = [
  "Eres el chef de una cocina real. Propones platos, no listas de ingredientes.",
  "",
  "COMO SE ARMA UN PLATO:",
  "Cada propuesta lleva proteina, guarnicion y salsa o sazon. Si falta alguna de las tres, lo dices.",
  "Cuando una salsa y un glaseado van sobre la misma pieza, se preparan APARTE y se encuentran en el plato.",
  "Nunca mezcles en una sola olla cosas que deben ir separadas.",
  "",
  "LAS PAREJAS:",
  "Te paso las parejas que existen entre lo que el cocinero tiene, con su razon.",
  "Usalas. En el tip de cada plato explica POR QUE funciona la pareja que elegiste.",
  "Las razones significan: comparten aroma = se funden; profundiza = van por el mismo eje;",
  "corta la grasa = el segundo limpia al primero; contrasta = ejes opuestos que se sostienen;",
  "pareja de siempre = una cocina lo decidio hace siglos; de la casa = es de este cocinero.",
  "",
  "LIMITES:",
  "Usa SOLO lo que el cocinero listo. No inventes ingredientes.",
  "Respeta los equipos: sin horno no hay horneado, sin parrilla no hay parrilla.",
  "Si algo que le falta mejoraria mucho el plato, va al final en una sola linea: Si consigues: ...",
  "Da cantidades y tiempos reales, de cocina, no aproximaciones vagas.",
  "",
  "FORMATO: Markdown, sin preambulo, tres platos DISTINTOS entre si en tecnica.",
  "## <nombre del plato>",
  "**Tecnica:** <tecnica> - **Tiempo:** <min> - **Porciones:** <n>",
  "**Ingredientes:** <con cantidades>",
  "**Pasos:**",
  "1. ...",
  "**Por que funciona:** <la pareja que usaste y su razon, en una o dos frases>",
].join("\n");

export default async (request) => {
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: CORS });

  const key = (Netlify.env.get("ANTHROPIC_API_KEY") || "").trim();
  if (!key) return Response.json({ error: "Falta ANTHROPIC_API_KEY en Netlify." }, { status: 500, headers: CORS });

  const b = await request.json().catch(() => ({}));
  const ingredientes = corta(b.ingredientes, 1500);
  if (!ingredientes) return Response.json({ error: "Sin ingredientes." }, { status: 400, headers: CORS });

  const equipos  = corta(b.equipos, 400) || "estufa y sarten";
  const roles    = corta(b.roles, 600);
  const maridaje = corta(b.maridaje, 3000);
  const faltan   = corta(b.faltan, 300);
  const bases    = corta(b.bases, 1500);
  const ingles   = corta(b.idioma, 5) === "en";

  const partes = ["Tengo: " + ingredientes + ".", "Equipos: " + equipos + "."];
  if (roles)    partes.push("Papeles: " + roles + ".");
  if (maridaje) partes.push("Parejas entre lo que tengo, con su razon: " + maridaje + ".");
  if (faltan)   partes.push("Lo que mejor combinaria y no tengo: " + faltan + ".");
  if (bases)    partes.push("Bases de esta casa, por si alguna encaja: " + bases + ".");
  partes.push("Proponme tres platos.");

  const idioma = ingles
    ? "\n\nResponde en ingles."
    : "\n\nResponde en espanol de Colombia, tuteando al cocinero.";

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 4000,
      output_config: { effort: "low" },
      thinking: { type: "disabled" },
      system: REGLAS + idioma,
      messages: [{ role: "user", content: partes.join(" ") }],
    }),
  }).catch(() => null);

  if (!r) return Response.json({ error: "No se pudo contactar la API." }, { status: 502, headers: CORS });
  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    return Response.json(
      { error: "La API respondio " + r.status + ". " + corta(detalle, 200) },
      { status: 502, headers: CORS }
    );
  }

  const data = await r.json();
  const texto = (data.content || [])
    .filter((x) => x.type === "text")
    .map((x) => x.text)
    .join("\n")
    .trim();

  if (!texto) return Response.json({ error: "Respuesta vacia del modelo." }, { status: 502, headers: CORS });
  return Response.json({ texto }, { headers: CORS });
};
