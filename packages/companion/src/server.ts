import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { COMPANION_PROTOCOL, MilpModel, type CompanionInfo, type MilpModelData, type MilpSolution, type SolverOptions } from "@planning/solver";

/** Un moteur de résolution exécuté par le compagnon. */
export interface Engine {
  name: CompanionInfo["engine"];
  /** `signal` : le navigateur a annulé, il faut arrêter le calcul. */
  solve(model: MilpModel, options: SolverOptions, signal: AbortSignal): Promise<MilpSolution>;
}

export interface CompanionConfig {
  engine: Engine;
  /** Origines de pages autorisées à utiliser le compagnon (ex. "https://planning.potodugoud.fr"). */
  origins: string[];
  version?: string;
  /** Taille maximale d'une requête, en octets. */
  maxBodyBytes?: number;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Serveur HTTP local. Protections : écoute réservée à la machine (le démarrage s'occupe de l'adresse),
 * Host vérifié (contre le « DNS rebinding »), Origin limité à une liste blanche, une seule résolution à la fois.
 */
export function createCompanion(config: CompanionConfig): Server {
  const allowed = new Set(config.origins.map((o) => o.replace(/\/$/, "")));
  const maxBody = config.maxBodyBytes ?? 512 * 1024 * 1024;
  let busy = false;

  const send = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
    const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
    if (origin) {
      headers["access-control-allow-origin"] = origin;
      headers["vary"] = "Origin";
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? "";
    if (!LOCAL_HOST.test(host)) return send(res, 403, { error: "Hôte refusé." });

    const originHeader = req.headers.origin;
    const origin = originHeader && allowed.has(originHeader) ? originHeader : undefined;
    if (originHeader && !origin) return send(res, 403, { error: `Origine non autorisée : ${originHeader}` });

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": origin ?? "",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        // Chrome exige cet en-tête pour qu'une page publique atteigne une adresse locale
        "access-control-allow-private-network": "true",
        "access-control-max-age": "600",
        vary: "Origin",
      });
      return res.end();
    }

    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      const info: CompanionInfo = { name: "planning-companion", protocol: COMPANION_PROTOCOL, version: config.version ?? "0.1.0", engine: config.engine.name };
      return send(res, 200, info, origin);
    }

    if (req.method === "POST" && path === "/solve") {
      if (busy) return send(res, 429, { error: "Un calcul est déjà en cours sur ce compagnon." }, origin);

      let payload: { protocol?: number; model?: MilpModelData; options?: SolverOptions };
      try {
        payload = JSON.parse(await readBody(req, maxBody));
      } catch (e) {
        return send(res, 400, { error: e instanceof Error ? e.message : "Requête illisible." }, origin);
      }
      if (payload.protocol !== COMPANION_PROTOCOL || !payload.model) {
        return send(res, 400, { error: "Protocole ou modèle invalide." }, origin);
      }

      busy = true;
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      try {
        const solution = await config.engine.solve(MilpModel.fromData(payload.model), payload.options ?? {}, abort.signal);
        if (!abort.signal.aborted) send(res, 200, solution, origin);
      } catch (e) {
        if (!abort.signal.aborted) send(res, 500, { error: e instanceof Error ? e.message : String(e) }, origin);
      } finally {
        busy = false;
      }
      return;
    }

    send(res, 404, { error: "Introuvable." }, origin);
  });
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Requête trop volumineuse."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
