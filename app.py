# ==========================================================
# SERVIDOR DE MI ASISTENTE IA (Flask + Gemini)
# Qué hace:
#   - Muestra la página de chat (carpeta "static").
#   - Recibe los mensajes en /api/chat, se los manda a Gemini y devuelve la respuesta.
# La clave de Google NUNCA va en la página: se lee acá, desde la variable
# de entorno GEMINI_API_KEY.
# Para ejecutarlo:   python app.py   y abrir http://127.0.0.1:5000
# ==========================================================

import os
import time
from collections import OrderedDict
from datetime import date

from flask import Flask, jsonify, request, send_from_directory
from google import genai
from google.genai import types
from werkzeug.middleware.proxy_fix import ProxyFix

# ---------- Configuración ----------
MODELO = "gemini-3.5-flash-lite"   # si da "modelo no encontrado", cambialo por otro Flash de AI Studio
MAX_MENSAJE = 2000                 # largo máximo de lo que puede escribir la persona
MAX_CHARLAS = 200                  # cuántas conversaciones guardamos en memoria
LIMITE_POR_MINUTO = 20             # mensajes por minuto por persona (evita abusos)
MAX_POR_DIA = 300                  # tope de mensajes por día entre TODAS las personas (protege tu cupo)
MAX_BUSQUEDAS_DIA = 40             # tope de consultas CON búsqueda en Google por día (el cupo gratis es más chico)

# El nombre de tu asistente. Cambialo acá y se actualiza en la página y en la IA.
NOMBRE_IA = "Nina"

INSTRUCCIONES = """
Te llamás __NOMBRE__ y sos un asistente amable y servicial. Respondé siempre en español rioplatense.
Si te preguntan cómo te llamás, decí que sos __NOMBRE__. Si te preguntan qué tecnología usás, podés decir que funcionás con un modelo de Google (Gemini).
Podés ayudar con cualquier tema: estudio, programación, ciencia, consejos, etc.
Explicá de forma clara y con ejemplos, y adaptá el nivel a lo que te pidan.
Si no sabés algo o no estás seguro, decilo en vez de inventar.
Normalmente no tenés acceso a internet: si te preguntan por noticias o datos de hoy, avisá que podrías estar desactualizado. Cuando la persona activa la búsqueda, recibís resultados de Google: usalos para dar datos actuales y aclará que vienen de la web.

Si entendiste, respondé solamente: Listo.
""".replace("__NOMBRE__", NOMBRE_IA)

# ---------- Arranque ----------
app = Flask(__name__, static_folder="static", static_url_path="/static")
# En Railway y similares hay un "intermediario" delante de tu servidor.
# ProxyFix hace que request.remote_addr sea la IP real de cada persona.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

# genai.Client() busca solo la clave en la variable GEMINI_API_KEY.
# Si falta, guardamos el error para avisarlo en el chat (en vez de romper todo).
try:
    cliente = genai.Client()
    error_cliente = None
except Exception as error:
    cliente = None
    error_cliente = str(error)

# Acá guardamos cada conversación en memoria: {id de la charla: chat de Gemini}.
# Si el servidor se reinicia, las charlas se pierden (es lo normal en esta etapa).
charlas = OrderedDict()

# Para el límite de mensajes: {ip: [horas de los últimos mensajes]}
usos = {}


# Contador de mensajes del día (se reinicia solo cada día)
hoy = {"fecha": date.today(), "cantidad": 0, "busquedas": 0}


def supera_tope_diario():
    """Devuelve True si ya se gastó el cupo del día. Protege tu clave de Gemini."""
    if hoy["fecha"] != date.today():
        hoy["fecha"] = date.today()
        hoy["cantidad"] = 0
        hoy["busquedas"] = 0
    if hoy["cantidad"] >= MAX_POR_DIA:
        return True
    hoy["cantidad"] += 1
    return False


def puede_buscar():
    """True si todavía queda cupo de búsquedas en Google para hoy (y lo descuenta)."""
    if hoy["fecha"] != date.today():
        hoy["fecha"] = date.today()
        hoy["cantidad"] = 0
        hoy["busquedas"] = 0
    if hoy["busquedas"] >= MAX_BUSQUEDAS_DIA:
        return False
    hoy["busquedas"] += 1
    return True


def pasa_el_limite(ip):
    """Devuelve True si esta persona ya mandó demasiados mensajes en el último minuto."""
    ahora = time.time()
    recientes = [t for t in usos.get(ip, []) if ahora - t < 60]
    if len(recientes) >= LIMITE_POR_MINUTO:
        usos[ip] = recientes
        return True
    recientes.append(ahora)
    usos[ip] = recientes
    return False


def enviar(chat, texto, config=None):
    """Manda un mensaje a Gemini. Si está saturado (503) o limitado (429), reintenta hasta 3 veces.
    'config' sirve para activar la búsqueda en Google solo en este mensaje."""
    ultimo_error = None
    for intento in range(3):
        try:
            if config is not None:
                return chat.send_message(texto, config=config)
            return chat.send_message(texto)
        except Exception as error:
            ultimo_error = error
            texto_error = str(error)
            # Solo vale la pena reintentar si Google está saturado
            if "503" not in texto_error and "429" not in texto_error:
                break
            time.sleep(2)
    raise ultimo_error


def obtener_chat(id_charla):
    """Devuelve la conversación de esta persona; si es nueva, la crea y le manda las instrucciones."""
    if id_charla in charlas:
        charlas.move_to_end(id_charla)      # la marcamos como "usada hace poco"
        return charlas[id_charla]

    chat = cliente.chats.create(model=MODELO)
    enviar(chat, INSTRUCCIONES)             # primer mensaje oculto: cómo tiene que comportarse
    charlas[id_charla] = chat
    while len(charlas) > MAX_CHARLAS:       # si hay demasiadas, borramos la más vieja
        charlas.popitem(last=False)
    return chat


# ---------- Rutas ----------
@app.route("/")
def inicio():
    return send_from_directory("static", "index.html")


@app.route("/sw.js")
def service_worker():
    # Va en la raíz para que pueda controlar toda la app.
    r = send_from_directory("static", "sw.js", mimetype="application/javascript")
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.route("/api/config")
def configuracion():
    """La página le pregunta acá cómo se llama el asistente."""
    return jsonify({"nombre": NOMBRE_IA})


@app.route("/api/chat", methods=["POST"])
def chat():
    if cliente is None:
        return jsonify({"respuesta": "Falta configurar la clave GEMINI_API_KEY en el servidor."}), 500

    datos = request.get_json(silent=True) or {}
    id_charla = str(datos.get("id", ""))[:64]
    mensaje = str(datos.get("mensaje", "")).strip()[:MAX_MENSAJE]

    if not id_charla or not mensaje:
        return jsonify({"respuesta": "Escribí un mensaje para empezar."}), 400

    if pasa_el_limite(request.remote_addr or "desconocida"):
        return jsonify({"respuesta": "Mandaste muchos mensajes seguidos. Esperá un minuto."}), 429

    if supera_tope_diario():
        return jsonify({"respuesta": "Hoy se alcanzó el límite de consultas. Probá mañana."}), 429

    quiere_buscar = bool(datos.get("busqueda"))
    aviso = ""
    config = None
    if quiere_buscar:
        if puede_buscar():
            config = types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())])
        else:
            aviso = "\n\n*(Hoy se acabó el cupo de búsquedas en internet; respondí sin buscar.)*"

    try:
        chat_actual = obtener_chat(id_charla)
        try:
            respuesta = enviar(chat_actual, mensaje, config)
        except Exception as error:
            # Si falló justo por la búsqueda (por ejemplo el modelo no la soporta), probamos sin ella.
            if config is None:
                raise
            print("La búsqueda falló, reintento sin buscar:", error)
            respuesta = enviar(chat_actual, mensaje)
            aviso = "\n\n*(No pude buscar en internet esta vez; respondí sin buscar.)*"
        return jsonify({"respuesta": (respuesta.text or "No tengo una respuesta para eso.") + aviso})
    except Exception as error:
        print("Error con Gemini:", error)    # el detalle queda en la ventana de cmd, no en la página
        return jsonify({"respuesta": "No pude responder en este momento. Probá de nuevo en un rato."}), 503


@app.route("/api/nueva", methods=["POST"])
def nueva():
    """Borra la conversación guardada (botón 'Nueva conversación')."""
    datos = request.get_json(silent=True) or {}
    charlas.pop(str(datos.get("id", "")), None)
    return jsonify({"ok": True})


if __name__ == "__main__":
    if error_cliente:
        print("AVISO: no se encontró la clave. Detalle:", error_cliente)
    # host 127.0.0.1 = solo se puede abrir desde tu propia compu
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
