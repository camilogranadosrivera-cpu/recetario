// netlify/functions/chef.mjs  (generado: comun + cuerpo)
import { getStore } from "@netlify/blobs";
import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";

// ===== Comun a las funciones de Siete Sabores (se copia igual en cada una) =====
// Variables de entorno en Netlify:
//   ANTHROPIC_API_KEY  la clave de la API (ya existia)
//   PRO_SECRETO        texto largo y secreto para firmar los pases Pro
//   PRO_ADMIN          la clave del panel de codigos (pro-admin.html)
//   Opcionales: LIMITE_GRATIS (3), LIMITE_PRO (25), LIMITE_RED (80),
//   LIMITE_TOTAL (1000 consultas al dia entre todos), SITIOS_PERMITIDOS.

const SITIO = "https://mastercusine.netlify.app";
const DIA_MS = 86400000;

const env = (k, d) => {
  try {
    const v = Netlify.env.get(k);
    return v === undefined || v === null || String(v).trim() === "" ? d : String(v).trim();
  } catch (e) {
    return d;
  }
};
const num = (k, d) => {
  const n = parseInt(env(k, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const corta = (v, n) => String(v || "").slice(0, n);
const tx = (b, es, en) => (corta(b && b.idioma, 5) === "en" ? en : es);

// Dia de Colombia (UTC-5): los contadores se reinician a la medianoche de Bogota
const hoy = (ms) => new Date((ms || Date.now()) - 5 * 3600000).toISOString().slice(0, 10);

// ----- De donde viene el pedido -----
const anfitrion = new URL(SITIO).hostname.split(".")[0];
const origenesPermitidos = () =>
  [SITIO].concat(env("SITIOS_PERMITIDOS", "").split(",").map((s) => s.trim()).filter(Boolean));

function origenDe(request) {
  const o = request.headers.get("origin") || "";
  if (o && o !== "null") return o;
  const r = request.headers.get("referer") || "";
  try {
    return r ? new URL(r).origin : "";
  } catch (e) {
    return "";
  }
}
function origenValido(o) {
  if (!o) return false;
  if (origenesPermitidos().includes(o)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return true;
  // vistas previas de Netlify del mismo sitio: https://algo--mastercusine.netlify.app
  return new RegExp("^https://[a-z0-9-]+--" + anfitrion + "\\.netlify\\.app$").test(o);
}
function cabeceras(request) {
  const o = origenDe(request);
  return {
    "Access-Control-Allow-Origin": origenValido(o) ? o : SITIO,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const responde = (request, datos, status) =>
  Response.json(datos, { status: status || 200, headers: cabeceras(request) });

// La IP solo se guarda resumida (huella), nunca tal cual
function huellaRed(request, context) {
  const ip = (context && context.ip) || request.headers.get("x-nf-client-connection-ip") || "sin-ip";
  return createHash("sha256").update(ip + "|" + hoy()).digest("hex").slice(0, 16);
}
const dispositivoDe = (b) => corta(b && b.dispositivo, 40).replace(/[^A-Za-z0-9_-]/g, "");

// ----- Almacen (Netlify Blobs) -----
const almacen = () => globalThis.__SS_STORE__ || getStore({ name: "siete-sabores", consistency: "strong" });
async function leeNum(st, k) {
  const v = await st.get(k);
  return v ? parseInt(v, 10) || 0 : 0;
}
async function suma(st, k) {
  const n = (await leeNum(st, k)) + 1;
  await st.set(k, String(n));
  return n;
}

// ----- Pases Pro: firmados, sin base de datos -----
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const firma = (texto) => b64u(createHmac("sha256", env("PRO_SECRETO", "")).update(texto).digest());

function creaPase(datos) {
  const p = b64u(JSON.stringify(datos));
  return p + "." + firma(p);
}
function leePase(pase, dispositivo) {
  if (!env("PRO_SECRETO", "")) return null;
  const partes = String(pase || "").split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const esperada = Buffer.from(firma(partes[0]));
  const dada = Buffer.from(partes[1]);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return null;
  let d = null;
  try {
    d = JSON.parse(deB64u(partes[0]).toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!d || typeof d.h !== "number" || d.h < Date.now()) return null;
  if (dispositivo && d.d !== dispositivo) return null;
  return d;
}

// ----- Permiso para gastar una consulta del chef -----
// Gratis: LIMITE_GRATIS al dia por celular. Pro: LIMITE_PRO.
// Ademas un tope por red (contra abusos) y un tope total diario (el freno de mano).
async function permisoChef(request, context, b, tipo) {
  if (!origenValido(origenDe(request))) {
    return { status: 403, error: tx(b, "El chef solo responde desde la app.", "The chef only answers from the app.") };
  }
  const disp = dispositivoDe(b);
  if (disp.length < 8) {
    return { status: 400, error: tx(b, "Actualiza la app para usar el chef.", "Update the app to use the chef.") };
  }
  const pase = leePase(b.pase, disp);
  const pro = !!pase;
  const tope = pro ? num("LIMITE_PRO", 25) : num("LIMITE_GRATIS", 3);
  const dia = hoy();
  const kDisp = "uso/" + dia + "/d/" + disp;
  const kRed = "uso/" + dia + "/red/" + huellaRed(request, context);
  const kTotal = "uso/" + dia + "/total";
  let st;
  try {
    st = almacen();
    const [nd, nr, nt] = await Promise.all([leeNum(st, kDisp), leeNum(st, kRed), leeNum(st, kTotal)]);
    if (nt >= num("LIMITE_TOTAL", 1000)) {
      return { status: 429, limite: "total", pro, error: tx(b,
        "El chef ya atendio todas las consultas de hoy. Vuelve manana.",
        "The chef has answered every question for today. Come back tomorrow.") };
    }
    if (nd >= tope) {
      return { status: 429, limite: "persona", pro, tope, error: pro
        ? tx(b, "Ya usaste tus " + tope + " consultas de hoy. Manana tienes mas.",
                "You used your " + tope + " questions for today. More tomorrow.")
        : tx(b, "Ya usaste tus " + tope + " consultas gratis de hoy. Con Pro tienes " + num("LIMITE_PRO", 25) + " al dia.",
                "You used your " + tope + " free questions for today. Pro gives you " + num("LIMITE_PRO", 25) + " a day.") };
    }
    if (nr >= num("LIMITE_RED", 80)) {
      return { status: 429, limite: "red", pro, error: tx(b,
        "Hay demasiadas consultas desde esta red hoy. Intenta con datos moviles o manana.",
        "Too many questions from this network today. Try mobile data or tomorrow.") };
    }
    await Promise.all([suma(st, kDisp), suma(st, kRed), suma(st, kTotal), suma(st, "uso/" + dia + "/" + tipo)]);
    return { ok: true, pro, quedan: Math.max(0, tope - nd - 1) };
  } catch (e) {
    console.error("Almacen no disponible:", e);
    return { status: 503, error: tx(b, "El chef no esta disponible ahora.", "The chef is not available right now.") };
  }
}

// ----- Llamada a Claude -----
async function preguntaAClaude(b, opciones) {
  const key = env("ANTHROPIC_API_KEY", "");
  if (!key) return { status: 500, error: "Falta ANTHROPIC_API_KEY en Netlify." };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(Object.assign({
      model: "claude-haiku-5-5",
      output_config: { effort: "low" },
      thinking: { type: "disabled" },
    }, opciones)),
  }).catch(() => null);
  if (!r) return { status: 502, error: tx(b, "No se pudo contactar al chef.", "Could not reach the chef.") };
  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    console.error("API", r.status, corta(detalle, 300));
    return { status: 502, error: tx(b, "El chef no pudo responder (" + r.status + ").", "The chef could not answer (" + r.status + ").") };
  }
  const data = await r.json().catch(() => ({}));
  const texto = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n").trim();
  if (!texto) return { status: 502, error: tx(b, "Respuesta vacia del chef.", "Empty answer from the chef.") };
  return { texto };
}
// ===== Fin de lo comun =====

// ===== chef.mjs: "Pidele una idea al chef" =====
// Recibe la despensa del cocinero y le pide tres platos a Claude, con los
// papeles de cada insumo, las parejas que existen y las bases de la casa.
// OJO: sin comillas invertidas a proposito (pegar desde el celular rompe esbuild).

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

export default async (request, context) => {
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: cabeceras(request) });
  if (request.method !== "POST") return responde(request, { error: "Usa POST." }, 405);

  const b = await request.json().catch(() => ({}));
  const ingredientes = corta(b.ingredientes, 1500);
  if (!ingredientes) return responde(request, { error: tx(b, "Marca algunos ingredientes.", "Pick some ingredients.") }, 400);

  const p = await permisoChef(request, context, b, "chef");
  if (!p.ok) return responde(request, { error: p.error, limite: p.limite, pro: p.pro }, p.status);

  const equipos = corta(b.equipos, 400) || "estufa y sarten";
  const roles = corta(b.roles, 600);
  const maridaje = corta(b.maridaje, 3000);
  const faltan = corta(b.faltan, 300);
  const bases = corta(b.bases, 1500);

  const partes = ["Tengo: " + ingredientes + ".", "Equipos: " + equipos + "."];
  if (roles) partes.push("Papeles: " + roles + ".");
  if (maridaje) partes.push("Parejas entre lo que tengo, con su razon: " + maridaje + ".");
  if (faltan) partes.push("Lo que mejor combinaria y no tengo: " + faltan + ".");
  if (bases) partes.push("Bases de esta casa, por si alguna encaja: " + bases + ".");
  partes.push("Proponme tres platos.");

  const idioma = tx(b, "\n\nResponde en espanol de Colombia, tuteando al cocinero.", "\n\nResponde en ingles.");
  const r = await preguntaAClaude(b, {
    max_tokens: 4000,
    system: REGLAS + idioma,
    messages: [{ role: "user", content: partes.join(" ") }],
  });
  if (!r.texto) return responde(request, { error: r.error }, r.status);
  return responde(request, { texto: r.texto, quedan: p.quedan, pro: p.pro });
};
