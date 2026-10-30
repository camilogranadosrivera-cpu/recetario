// netlify/functions/pro.mjs  (generado: comun + cuerpo)
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

// ===== pro.mjs: codigos y pases de Siete Sabores Pro =====
// Acciones del publico: "activar" (un codigo -> un pase firmado) y "estado".
// Acciones del panel (con la clave PRO_ADMIN): "generar", "resumen" y "anular".
// OJO: sin comillas invertidas a proposito (pegar desde el celular rompe esbuild).

const LETRAS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";  // sin 0/O, 1/I/L para leerlos bien impresos
const normaliza = (c) => corta(c, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
const bonito = (c) => (c.length === 8 ? c.slice(0, 4) + "-" + c.slice(4) : c);

function codigoNuevo() {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += LETRAS[bytes[i] % LETRAS.length];
  return s;
}
function claveCorrecta(dada) {
  const real = env("PRO_ADMIN", "");
  if (!real || !dada) return false;
  const a = createHash("sha256").update(String(dada)).digest();
  const b = createHash("sha256").update(real).digest();
  return timingSafeEqual(a, b);
}

async function activar(request, context, b, st) {
  const disp = dispositivoDe(b);
  if (disp.length < 8) return [400, { error: tx(b, "Actualiza la app.", "Update the app.") }];

  // Contra los que prueban codigos al azar: 20 intentos al dia por red
  const kInt = "act/" + hoy() + "/red/" + huellaRed(request, context);
  if ((await leeNum(st, kInt)) >= 20) {
    return [429, { error: tx(b, "Demasiados intentos hoy. Prueba manana.", "Too many tries today. Try tomorrow.") }];
  }
  await suma(st, kInt);

  const codigo = normaliza(b.codigo);
  const reg = codigo.length >= 4 ? await st.get("codigo/" + codigo, { type: "json" }) : null;
  if (!reg || reg.anulado) return [404, { error: tx(b, "Ese codigo no existe. Revisalo e intenta de nuevo.", "That code does not exist. Check it and try again.") }];

  const ahora = Date.now();
  const actual = leePase(b.pase, disp);
  let hasta;

  if (reg.tipo === "campana") {
    if (reg.vence && ahora > reg.vence) return [410, { error: tx(b, "Esta promocion ya termino.", "This promotion has ended.") }];
    const kYa = "campana/" + codigo + "/" + disp;
    const ya = await st.get(kYa, { type: "json" });
    if (ya) {
      hasta = ya.hasta;
    } else {
      if (reg.usos && (reg.usados || 0) >= reg.usos) return [410, { error: tx(b, "Ya se agotaron los cupos de esta promocion.", "This promotion is fully used.") }];
      hasta = Math.max(ahora, actual ? actual.h : 0) + reg.dias * DIA_MS;
      reg.usados = (reg.usados || 0) + 1;
      await st.setJSON("codigo/" + codigo, reg);
      await st.setJSON(kYa, { en: ahora, hasta });
      await suma(st, "stat/" + hoy() + "/activaciones");
    }
  } else {
    if (reg.usado && reg.usado.d !== disp) {
      return [409, { error: tx(b, "Este codigo ya se uso en otro celular.", "This code was already used on another phone.") }];
    }
    if (reg.usado) {
      hasta = reg.usado.hasta;   // el mismo celular lo vuelve a activar (borro la app, cambio de navegador)
    } else {
      hasta = Math.max(ahora, actual ? actual.h : 0) + reg.dias * DIA_MS;
      reg.usado = { en: ahora, d: disp, hasta };
      await st.setJSON("codigo/" + codigo, reg);
      await suma(st, "stat/" + hoy() + "/activaciones");
    }
  }
  if (hasta < ahora) return [410, { error: tx(b, "Ese codigo ya vencio.", "That code has expired.") }];
  return [200, { pase: creaPase({ d: disp, h: hasta, c: codigo }), hasta, dias: reg.dias }];
}

async function generar(b, st) {
  const dias = Math.min(365, Math.max(1, parseInt(b.dias, 10) || 30));
  const etiqueta = corta(b.etiqueta, 40).trim() || "General";
  const creado = Date.now();
  if (b.tipo === "campana") {
    const codigo = normaliza(b.codigo);
    if (codigo.length < 4 || codigo.length > 20) return [400, { error: "El codigo de campana debe tener entre 4 y 20 letras o numeros." }];
    if (await st.get("codigo/" + codigo, { type: "json" })) return [409, { error: "Ese codigo ya existe." }];
    const usos = Math.max(0, parseInt(b.usos, 10) || 0);
    const vence = /^\d{4}-\d{2}-\d{2}$/.test(String(b.vence || "")) ? Date.parse(b.vence + "T23:59:59-05:00") : 0;
    await st.setJSON("codigo/" + codigo, { tipo: "campana", dias, etiqueta, creado, usos, usados: 0, vence });
    return [200, { codigos: [codigo], tipo: "campana", dias, etiqueta }];
  }
  const cantidad = Math.min(300, Math.max(1, parseInt(b.cantidad, 10) || 1));
  const codigos = [];
  while (codigos.length < cantidad) {
    const c = codigoNuevo();
    if (codigos.includes(c) || (await st.get("codigo/" + c))) continue;
    await st.setJSON("codigo/" + c, { tipo: "unico", dias, etiqueta, creado });
    codigos.push(c);
  }
  return [200, { codigos: codigos.map(bonito), tipo: "unico", dias, etiqueta }];
}

async function resumen(st) {
  const { blobs } = await st.list({ prefix: "codigo/" });
  const porEtiqueta = {};
  const campanas = [];
  for (const x of blobs) {
    const r = await st.get(x.key, { type: "json" });
    if (!r) continue;
    const codigo = x.key.slice(7);
    if (r.tipo === "campana") {
      campanas.push({ codigo, etiqueta: r.etiqueta, dias: r.dias, usados: r.usados || 0, usos: r.usos || 0, vence: r.vence || 0, anulado: !!r.anulado });
      continue;
    }
    const e = porEtiqueta[r.etiqueta] || (porEtiqueta[r.etiqueta] = { etiqueta: r.etiqueta, generados: 0, usados: 0, anulados: 0 });
    e.generados++;
    if (r.usado) e.usados++;
    if (r.anulado) e.anulados++;
  }
  const dias = [];
  for (let i = 0; i < 30; i++) {
    const d = hoy(Date.now() - i * DIA_MS);
    const [total, chef, pregunta, act] = await Promise.all([
      leeNum(st, "uso/" + d + "/total"), leeNum(st, "uso/" + d + "/chef"),
      leeNum(st, "uso/" + d + "/pregunta"), leeNum(st, "stat/" + d + "/activaciones"),
    ]);
    if (total || act) dias.push({ dia: d, consultas: total, ideas: chef, preguntas: pregunta, activaciones: act });
  }
  return [200, {
    etiquetas: Object.values(porEtiqueta).sort((a, b) => b.generados - a.generados),
    campanas, dias,
    limites: { gratis: num("LIMITE_GRATIS", 3), pro: num("LIMITE_PRO", 25), red: num("LIMITE_RED", 80), total: num("LIMITE_TOTAL", 1000) },
  }];
}

async function anular(b, st) {
  const codigo = normaliza(b.codigo);
  const reg = await st.get("codigo/" + codigo, { type: "json" });
  if (!reg) return [404, { error: "Ese codigo no existe." }];
  reg.anulado = true;
  await st.setJSON("codigo/" + codigo, reg);
  return [200, { ok: true, codigo: bonito(codigo) }];
}

export default async (request, context) => {
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: cabeceras(request) });
  if (request.method !== "POST") return responde(request, { error: "Usa POST." }, 405);
  if (!origenValido(origenDe(request))) return responde(request, { error: "Solo desde la app." }, 403);

  const b = await request.json().catch(() => ({}));
  if (!env("PRO_SECRETO", "")) return responde(request, { error: "Falta PRO_SECRETO en Netlify." }, 500);

  try {
    const st = almacen();
    if (b.accion === "activar") {
      const [s, d] = await activar(request, context, b, st);
      return responde(request, d, s);
    }
    if (b.accion === "estado") {
      const p = leePase(b.pase, dispositivoDe(b));
      return responde(request, { pro: !!p, hasta: p ? p.h : 0 });
    }
    if (["generar", "resumen", "anular"].includes(b.accion)) {
      const kMal = "adm/" + hoy() + "/red/" + huellaRed(request, context);
      if ((await leeNum(st, kMal)) >= 10) return responde(request, { error: "Demasiados intentos con clave equivocada hoy." }, 429);
      if (!claveCorrecta(b.clave)) {
        await suma(st, kMal);
        return responde(request, { error: "Clave equivocada." }, 401);
      }
      const [s, d] = b.accion === "generar" ? await generar(b, st) : b.accion === "resumen" ? await resumen(st) : await anular(b, st);
      return responde(request, d, s);
    }
    return responde(request, { error: "Accion desconocida." }, 400);
  } catch (e) {
    console.error(e);
    return responde(request, { error: tx(b, "No se pudo completar. Intenta en un momento.", "Could not finish. Try again shortly.") }, 503);
  }
};
