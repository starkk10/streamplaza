import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type StorageKind = "receipts" | "public";

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { ext: "webp", magic: b => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  "application/pdf": { ext: "pdf", magic: b => b.subarray(0, 5).toString() === "%PDF-" },
};

export const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

const MAX_BYTES = 5 * 1024 * 1024;

function dir(kind: StorageKind) {
  return path.resolve(env.uploadDir, kind);
}

/** Guarda un archivo comprobando su tipo real (no solo la extensión). Devuelve el nombre guardado. */
export async function saveUpload(kind: StorageKind, data: Buffer, mime: string, allowPdf = kind === "receipts"): Promise<string> {
  const t = TYPES[mime];
  if (!t || (mime === "application/pdf" && !allowPdf)) throw new AppError(allowPdf ? "Sube una imagen PNG, JPG o WEBP, o un PDF." : "Sube una imagen PNG, JPG o WEBP.");
  if (data.length === 0) throw new AppError("El archivo está vacío.");
  if (data.length > MAX_BYTES) throw new AppError("El archivo pesa más de 5 MB.");
  if (!t.magic(data)) throw new AppError("El archivo no es una imagen o PDF válido.");
  await mkdir(dir(kind), { recursive: true });
  const name = `${Date.now()}-${randomToken(9)}.${t.ext}`;
  await writeFile(path.join(dir(kind), name), data);
  return name;
}

export async function saveUploadFromFile(kind: StorageKind, file: File | null | undefined, required = false): Promise<string | null> {
  if (!file || file.size === 0) {
    if (required) throw new AppError("Adjunta el archivo.");
    return null;
  }
  return saveUpload(kind, Buffer.from(await file.arrayBuffer()), file.type);
}

export async function readUpload(kind: StorageKind, name: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!/^[\w.-]+$/.test(name)) return null; // impide rutas como ../../
  const ext = name.split(".").pop() ?? "";
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  try {
    return { data: await readFile(path.join(dir(kind), name)), mime };
  } catch {
    return null;
  }
}
