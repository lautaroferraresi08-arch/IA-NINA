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

// ----- Opciones (se recuerdan en este navegador) -----
var botonVoz = document.getElementById("op-voz");
var botonWeb = document.getElementById("op-web");
var botonMic = document.getElementById("mic");
var vozActiva = false, webActiva = false;

function leerOpcion(k) { try { return localStorage.getItem(k) === "1"; } catch (e) { return false; } }
function guardarOpcion(k, v) { try { localStorage.setItem(k, v ? "1" : "0"); } catch (e) {} }
function pintarOpciones() {
  botonVoz.setAttribute("aria-pressed", vozActiva);
  botonWeb.setAttribute("aria-pressed", webActiva);
}
vozActiva = leerOpcion("nina_voz"); webActiva = leerOpcion("nina_web"); pintarOpciones();

// ----- Voz: que la IA lea en voz alta -----
var haySintesis = "speechSynthesis" in window;
if (!haySintesis) { botonVoz.hidden = true; }

function textoParaLeer(t) {
  return t.replace(/```[\s\S]*?```/g, " (código) ")
          .replace(/[*_`#>]/g, "")
          .replace(/\s+/g, " ").trim();
}
function hablar(t) {
  if (!haySintesis || !vozActiva) { return; }
  speechSynthesis.cancel();
  var partes = textoParaLeer(t).match(/[^.!?\n]+[.!?]*/g) || [];     // frases cortas: Chrome corta las muy largas
  var voces = speechSynthesis.getVoices();
  var voz = voces.filter(function (v) { return /^es[-_]AR/i.test(v.lang); })[0]
         || voces.filter(function (v) { return /^es/i.test(v.lang); })[0];
  partes.forEach(function (p) {
    var u = new SpeechSynthesisUtterance(p.trim());
    u.lang = voz ? voz.lang : "es-AR";
    if (voz) { u.voice = voz; }
    speechSynthesis.speak(u);
  });
}
function callar() { if (haySintesis) { speechSynthesis.cancel(); } }

botonVoz.addEventListener("click", function () {
  vozActiva = !vozActiva; guardarOpcion("nina_voz", vozActiva); pintarOpciones();
  if (!vozActiva) { callar(); }
});
botonWeb.addEventListener("click", function () {
  webActiva = !webActiva; guardarOpcion("nina_web", webActiva); pintarOpciones();
});

// ----- Voz: hablarle a la IA (dictado) -----
var Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
var reconocedor = null, escuchando = false;
if (!Reconocimiento) { botonMic.hidden = true; } else { botonMic.hidden = false; }

botonMic.addEventListener("click", function () {
  if (escuchando && reconocedor) { reconocedor.stop(); return; }
  callar();
  reconocedor = new Reconocimiento();
  reconocedor.lang = "es-AR";
  reconocedor.interimResults = true;
  reconocedor.continuous = false;
  var dicho = "";
  reconocedor.onstart = function () { escuchando = true; botonMic.classList.add("escuchando"); };
  reconocedor.onresult = function (ev) {
    dicho = "";
    for (var i = 0; i < ev.results.length; i++) { dicho += ev.results[i][0].transcript; }
    texto.value = dicho;
  };
  reconocedor.onerror = function () { dicho = ""; };
  reconocedor.onend = function () {
    escuchando = false; botonMic.classList.remove("escuchando");
    if (dicho.trim()) { enviarMensaje(dicho); }      // al terminar de hablar, se envía solo
  };
  try { reconocedor.start(); } catch (e) {}
});

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

  callar();
  agregar("yo", m);
  texto.value = ""; texto.style.height = "auto";
  enviar.disabled = true;

  var pensando = agregar("ia", "");
  pensando.classList.add("pensando");
  pensando.innerHTML = "<span></span><span></span><span></span>";

  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: idCharla, mensaje: m, busqueda: webActiva })
  })
    .then(function (r) { return r.json(); })
    .then(function (datos) {
      pensando.classList.remove("pensando");
      pensando.innerHTML = aHtml(datos.respuesta || "No pude responder.");
      hablar(datos.respuesta || "");
      if (datos.sin_busqueda) {                 // Google dijo que no hay cupo: apagamos el botón un rato
        webActiva = false; guardarOpcion("nina_web", false); pintarOpciones();
        botonWeb.title = "La búsqueda no está disponible por ahora (sin cupo)";
        botonWeb.style.opacity = ".5";
      }
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
  callar();
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
