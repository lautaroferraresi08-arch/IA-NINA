// ==========================================================
// LÓGICA DE LA PÁGINA DE CHAT
// 1) Dibuja los mensajes.  2) Manda lo que escribís al servidor (/api/chat).
// 3) Muestra la respuesta.  La clave de Google NO está acá: vive en el servidor.
// ==========================================================

var mensajes = document.getElementById("mensajes");
var formulario = document.getElementById("formulario");
var texto = document.getElementById("texto");
var enviar = document.getElementById("enviar");
var botonNueva = document.getElementById("nueva");
var nombreIA = "Asistente";        // se reemplaza con el nombre que viene del servidor

// Cada pestaña tiene su propio ID de conversación; el servidor lo usa para recordar la charla.
function nuevoId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(16).slice(2);
}
var idCharla = nuevoId();

// ----- Convertir el texto de la IA (con **negritas**, listas, código) a HTML seguro -----
function escapar(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function aHtml(origen) {
  var t = escapar(origen);          // primero escapamos TODO: así no se puede colar HTML

  // 1) Bloques de código ``` ... ``` : los guardamos aparte para no tocarlos
  var bloques = [];
  t = t.replace(/```[\w-]*\n?([\s\S]*?)```/g, function (m, codigo) {
    bloques.push("<pre><code>" + codigo.replace(/\n$/, "") + "</code></pre>");
    return "\u0000" + (bloques.length - 1) + "\u0000";
  });

  // 2) Código en línea y negritas
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^\s*][^*\n]*?)\*/g, "<em>$1</em>");   // *cursiva* (no confunde las viñetas "* ")

  // 3) Listas y párrafos, línea por línea
  var salida = [], lista = null;
  function cerrarLista() { if (lista) { salida.push("</" + lista + ">"); lista = null; } }

  t.split("\n").forEach(function (linea) {
    var vineta = linea.match(/^\s*[-*]\s+(.*)$/);
    var numero = linea.match(/^\s*\d+[.)]\s+(.*)$/);
    if (vineta || numero) {
      var tipo = vineta ? "ul" : "ol";
      if (lista !== tipo) { cerrarLista(); salida.push("<" + tipo + ">"); lista = tipo; }
      salida.push("<li>" + (vineta ? vineta[1] : numero[1]) + "</li>");
    } else {
      cerrarLista();
      if (linea.trim() === "") { return; }
      salida.push(/^\u0000\d+\u0000$/.test(linea.trim()) ? linea.trim() : "<p>" + linea + "</p>");
    }
  });
  cerrarLista();

  // 4) Devolvemos los bloques de código a su lugar
  return salida.join("").replace(/\u0000(\d+)\u0000/g, function (m, i) { return bloques[Number(i)]; });
}

// ----- Dibujar un mensaje -----
function agregar(quien, contenido) {
  var d = document.createElement("div");
  d.className = "msg " + quien;
  if (quien === "ia") { d.innerHTML = aHtml(contenido); }   // ya viene escapado
  else { d.textContent = contenido; }                       // lo tuyo, siempre como texto
  mensajes.appendChild(d);
  mensajes.scrollTop = mensajes.scrollHeight;
  return d;
}

function bienvenida() {
  var d = agregar("ia", "¡Hola! Soy " + nombreIA + ", tu asistente. Preguntame lo que quieras: estudio, programación, ideas...");
  var cont = document.createElement("div");
  cont.className = "sugerencias";
  ["Explicame algo difícil de forma simple", "Ayudame con un error de Python", "Dame ideas para un proyecto"]
    .forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = s;
      b.addEventListener("click", function () { enviarMensaje(s); });
      cont.appendChild(b);
    });
  d.appendChild(cont);
}

// ----- Mandar un mensaje al servidor -----
function enviarMensaje(m) {
  m = m.trim();
  if (!m || enviar.disabled) { return; }

  agregar("yo", m);
  texto.value = ""; texto.style.height = "auto";
  enviar.disabled = true;

  var pensando = agregar("ia", "");
  pensando.classList.add("pensando");
  pensando.innerHTML = "<span></span><span></span><span></span>";

  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: idCharla, mensaje: m })
  })
    .then(function (r) { return r.json(); })
    .then(function (datos) {
      pensando.classList.remove("pensando");
      pensando.innerHTML = aHtml(datos.respuesta || "No pude responder.");
    })
    .catch(function () {
      pensando.classList.remove("pensando");
      pensando.textContent = "No pude conectarme con el servidor.";
    })
    .finally(function () {
      enviar.disabled = false;
      mensajes.scrollTop = mensajes.scrollHeight;
      texto.focus();
    });
}

formulario.addEventListener("submit", function (e) { e.preventDefault(); enviarMensaje(texto.value); });

// Enter envía; Shift+Enter hace un salto de línea
texto.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensaje(texto.value); }
});
// La caja crece a medida que escribís
texto.addEventListener("input", function () {
  texto.style.height = "auto";
  texto.style.height = Math.min(texto.scrollHeight, 140) + "px";
});

// Nueva conversación: borra la pantalla y el historial del servidor
botonNueva.addEventListener("click", function () {
  fetch("/api/nueva", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: idCharla }) }).catch(function () {});
  idCharla = nuevoId();
  mensajes.innerHTML = "";
  bienvenida();
  texto.focus();
});

// Le preguntamos al servidor el nombre del asistente y recién ahí damos la bienvenida
fetch("/api/config")
  .then(function (r) { return r.json(); })
  .then(function (c) {
    nombreIA = c.nombre || nombreIA;
    document.getElementById("nombre-ia").textContent = nombreIA;
    document.title = nombreIA + " · Asistente IA";
  })
  .catch(function () {})
  .finally(function () { bienvenida(); texto.focus(); });
