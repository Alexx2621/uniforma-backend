import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export type Intencion = {
  intencion: 'analizar_documento' | 'listar_descuadres' | 'desconocida';
  folio: string | null;
  /** De donde salio la interpretacion, para poder depurar sin adivinar. */
  origen: 'modelo' | 'patron';
};

/**
 * Verificado el 19/08/2026 contra la cuenta: responde en ~600ms en caliente y
 * acierta la clasificacion. Ojo al elegir otro: la lista de /v1beta/models
 * incluye modelos que luego dan 404 ("no longer available to new users"), asi
 * que hay que probar el que se ponga aqui, no solo verlo listado.
 */
const MODELO_POR_DEFECTO = 'gemini-3.5-flash-lite';

/**
 * Traduce lo que escribe el usuario a una intencion con parametros.
 *
 * Regla inviolable: al modelo solo se le manda la frase del usuario. Nunca
 * datos de la base. El modelo decide QUE quiso decir; los numeros los calcula
 * despues el analizador contra la base, en el servidor. Asi el modelo no puede
 * inventar cifras aunque quiera, y no se filtra informacion del negocio.
 *
 * Si no hay API configurada, si la cuota se agota o si el servicio tarda, cae
 * al reconocimiento por patron. El asistente nunca queda inutilizable por
 * depender de un tercero.
 */
@Injectable()
export class IntencionService implements OnModuleInit {
  private readonly logger = new Logger(IntencionService.name);

  /**
   * La primera llamada tras arrancar paga DNS, TLS y el arranque en frio del
   * modelo: medido, pasa de 6 segundos, mientras que las siguientes rondan los
   * 600ms. Sin esto la primera pregunta despues de cada reinicio caeria al
   * respaldo por patron sin que nadie se entere. Passenger recicla la app
   * seguido, asi que esa "primera pregunta" pasa varias veces al dia.
   */
  private conexionCaliente = false;

  onModuleInit() {
    // Sin await: si tarda o falla, la app arranca igual.
    void this.calentar();
  }

  private async calentar() {
    if (!(process.env.GOOGLE_AI_API_KEY || '').trim()) {
      this.logger.log('Sin GOOGLE_AI_API_KEY: el asistente usara reconocimiento por patron');
      return;
    }
    const inicio = Date.now();
    const prueba = await this.interpretar('ping');
    if (prueba.origen === 'modelo') {
      this.logger.log(`Modelo de intenciones listo en ${Date.now() - inicio}ms`);
    } else {
      this.logger.warn('El modelo de intenciones no respondio al arrancar; se seguira intentando en cada pregunta');
    }
  }

  private readonly instrucciones = [
    'Sos un extractor de intenciones para un sistema de inventario y ventas de Guatemala.',
    'Clasifica lo que pide el usuario en una de estas intenciones:',
    '- analizar_documento: menciona un documento concreto (venta, pedido u orden mixta) o pregunta por que sus cifras no cuadran.',
    '- listar_descuadres: pregunta en general que esta descuadrado o pendiente, sin referirse a un documento especifico.',
    '- desconocida: cualquier otra cosa, incluyendo consultas de stock, precios o clientes.',
    'Extrae tambien el folio si aparece. Un folio tiene forma LETRAS-LETRAS-NUMEROS, por ejemplo V-BO-0003, PE-AN-0010 u OM-0012.',
    'Si no hay folio, devolve null. No inventes folios ni cifras.',
    'Ante la duda entre una intencion concreta y desconocida, elegi desconocida.',
  ].join('\n');

  /** Reconocimiento por forma del folio: el respaldo cuando no hay modelo. */
  private porPatron(texto: string): Intencion {
    const limpio = `${texto || ''}`.toUpperCase();
    const folio = limpio.match(/\b[A-Z]{1,4}-[A-Z0-9]{1,4}-?\d{2,6}\b/)?.[0] || null;
    if (folio) return { intencion: 'analizar_documento', folio, origen: 'patron' };
    if (/DESCUADR|CUADRA|PENDIENT|DIFERENCI/.test(limpio)) {
      return { intencion: 'listar_descuadres', folio: null, origen: 'patron' };
    }
    return { intencion: 'desconocida', folio: null, origen: 'patron' };
  }

  async interpretar(texto: string): Promise<Intencion> {
    const apiKey = (process.env.GOOGLE_AI_API_KEY || '').trim();
    const pregunta = `${texto || ''}`.trim().slice(0, 500);
    if (!pregunta) return { intencion: 'desconocida', folio: null, origen: 'patron' };
    if (!apiKey) return this.porPatron(pregunta);

    const modelo = (process.env.GOOGLE_AI_MODELO || MODELO_POR_DEFECTO).trim();
    const control = new AbortController();
    // Ya en caliente, si tarda mas que esto no vale la pena esperar: el
    // respaldo responde al instante. En frio se le da margen para el saludo.
    const corte = setTimeout(() => control.abort(), this.conexionCaliente ? 6000 : 15000);

    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
        {
          method: 'POST',
          signal: control.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: this.instrucciones }] },
            contents: [{ role: 'user', parts: [{ text: pregunta }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 100,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  intencion: {
                    type: 'STRING',
                    enum: ['analizar_documento', 'listar_descuadres', 'desconocida'],
                  },
                  folio: { type: 'STRING', nullable: true },
                },
                required: ['intencion'],
              },
            },
          }),
        },
      );

      if (!resp.ok) {
        // 429 = cuota agotada del nivel gratuito. Es esperable, no es un fallo
        // del sistema: se sigue con el respaldo sin molestar al usuario.
        this.logger.warn(`Google AI respondio ${resp.status}; se usa reconocimiento por patron`);
        return this.porPatron(pregunta);
      }

      const data: any = await resp.json();
      const crudo = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!crudo) return this.porPatron(pregunta);

      const parseado = JSON.parse(crudo);
      const intencion = ['analizar_documento', 'listar_descuadres', 'desconocida'].includes(parseado?.intencion)
        ? parseado.intencion
        : 'desconocida';

      // El folio se valida contra su forma real: si el modelo lo invento o lo
      // deformo, no se usa. Nunca se confia en el texto tal cual.
      const folioCrudo = `${parseado?.folio || ''}`.toUpperCase().trim();
      const folio = /^[A-Z]{1,4}-[A-Z0-9]{1,4}-?\d{2,6}$/.test(folioCrudo) ? folioCrudo : null;

      // Si dijo que hay documento pero no dio folio valido, el patron puede
      // rescatarlo del texto original.
      if (intencion === 'analizar_documento' && !folio) {
        const respaldo = this.porPatron(pregunta);
        if (respaldo.folio) {
          this.conexionCaliente = true;
          return { ...respaldo, origen: 'modelo' };
        }
      }

      this.conexionCaliente = true;
      return { intencion, folio, origen: 'modelo' };
    } catch (error) {
      const motivo = (error as Error)?.name === 'AbortError' ? 'tardo demasiado' : (error as Error)?.message;
      this.logger.warn(`No se pudo interpretar con Google AI (${motivo}); se usa reconocimiento por patron`);
      return this.porPatron(pregunta);
    } finally {
      clearTimeout(corte);
    }
  }
}
