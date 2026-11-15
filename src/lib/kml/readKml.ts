import JSZip from 'jszip';
import { KmlError, parseKml, type KmlImport } from './parseKml';

/**
 * Lê os bytes de um arquivo .kml ou .kmz. O tipo é decidido pelo conteúdo, não pela
 * extensão: KMZ é um zip e começa com "PK". Na tela: `readKml(await file.arrayBuffer())`.
 */
export async function readKml(data: ArrayBuffer | Uint8Array): Promise<KmlImport> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!bytes.length) throw new KmlError('O arquivo está vazio.');
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
  return decodeText(await candidates[0].async('uint8array'));
}
