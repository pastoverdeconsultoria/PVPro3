import JSZip from 'jszip';
import { KmlError, parseKml, type KmlImport } from './parseKml';

/**
 * Lê os bytes de um arquivo .kml ou .kmz. O tipo é decidido pelo conteúdo, não pela
 * extensão: KMZ é um zip e começa com "PK". Na tela: `readKml(await file.arrayBuffer())`.
 */
/** Maior arquivo aceito. Um mapa de fazenda tem poucos MB; acima disso é engano ou arquivo malicioso. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Maior KML aceito depois de descompactar um KMZ (um zip pequeno pode esconder um arquivo gigante). */
export const MAX_KML_BYTES = 60 * 1024 * 1024;

export async function readKml(data: ArrayBuffer | Uint8Array): Promise<KmlImport> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!bytes.length) throw new KmlError('O arquivo está vazio.');
  if (bytes.length > MAX_FILE_BYTES) throw new KmlError('Arquivo grande demais (mais de 25 MB). Exporte só os piquetes da fazenda.');
  const text = isZip(bytes) ? await kmlTextFromKmz(bytes) : decodeText(bytes);
  return parseKml(text);
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function decodeText(bytes: Uint8Array): string {
  // O Google Earth grava UTF-8. Os dois casos de UTF-16 cobrem arquivos passados por editores do Windows.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

async function kmlTextFromKmz(bytes: Uint8Array): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new KmlError('Arquivo KMZ corrompido.');
  }
  const candidates = Object.values(zip.files).filter(
    (f) => !f.dir && /\.kml$/i.test(f.name) && !f.name.startsWith('__MACOSX/'),
  );
  if (!candidates.length) throw new KmlError('O KMZ não contém arquivo KML.');

  // O principal é o doc.kml da raiz; na falta dele, o KML menos aninhado.
  const depth = (name: string) => name.split('/').length;
  candidates.sort(
    (a, b) =>
      Number(b.name.toLowerCase() === 'doc.kml') - Number(a.name.toLowerCase() === 'doc.kml') ||
      depth(a.name) - depth(b.name) ||
      a.name.localeCompare(b.name),
  );
  // O tamanho descompactado vem do índice do zip: dá para recusar antes de abrir.
  const declared = (candidates[0] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === 'number' && declared > MAX_KML_BYTES) throw new KmlError('O mapa dentro do KMZ é grande demais.');
  const kml = await candidates[0].async('uint8array');
  if (kml.length > MAX_KML_BYTES) throw new KmlError('O mapa dentro do KMZ é grande demais.');
  return decodeText(kml);
}
