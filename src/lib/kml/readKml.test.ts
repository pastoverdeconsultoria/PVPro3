import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readKml } from './readKml';
import { KmlError } from './parseKml';
import { exampleKml } from './exampleKml.fixture';

const utf8 = (s: string) => new TextEncoder().encode(s);

async function kmz(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const other = (name: string) =>
  `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-40,-15,0 -40.01,-15,0 -40.01,-15.01,0 -40,-15.01,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;

describe('readKml', () => {
  it('lê KML em texto', async () => {
    const r = await readKml(utf8(exampleKml()));
    expect(r.paddocks).toHaveLength(13);
  });

  it('aceita ArrayBuffer, como o file.arrayBuffer() da tela devolve', async () => {
    const bytes = utf8(exampleKml());
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect((await readKml(buffer)).waterPoints).toHaveLength(6);
  });

  it('lê KMZ com doc.kml e imagens ao lado', async () => {
    const data = await kmz({ 'doc.kml': exampleKml(), 'files/icone.png': new Uint8Array([1, 2, 3]) });
    const r = await readKml(data);
    expect(r.paddocks).toHaveLength(13);
    expect(r.paddocks[12].name).toBe('Reserva legal');
  });

  it('no KMZ com vários KML, vale o doc.kml da raiz', async () => {
    const data = await kmz({ 'outros/extra.kml': other('Errado'), 'a.kml': other('Também errado'), 'doc.kml': other('Certo') });
    expect((await readKml(data)).paddocks[0].name).toBe('Certo');
  });

  it('sem doc.kml, vale o KML menos aninhado', async () => {
    const data = await kmz({ 'pasta/sub/fundo.kml': other('Fundo'), 'fazenda.kml': other('Raiz') });
    expect((await readKml(data)).paddocks[0].name).toBe('Raiz');
  });

  it('preserva acentos do nome', async () => {
    const data = await kmz({ 'doc.kml': other('Piquete do Açude') });
    expect((await readKml(data)).paddocks[0].name).toBe('Piquete do Açude');
  });

  it('lê KML gravado em UTF-16 com BOM', async () => {
    const text = other('Mombaça');
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      bytes[2 + i * 2] = c & 0xff;
      bytes[3 + i * 2] = c >> 8;
    }
    expect((await readKml(bytes)).paddocks[0].name).toBe('Mombaça');
  });

  it('erros com mensagem para a tela', async () => {
    await expect(readKml(new Uint8Array())).rejects.toThrow('O arquivo está vazio.');
    await expect(readKml(await kmz({ 'leia-me.txt': 'nada' }))).rejects.toThrow('O KMZ não contém arquivo KML.');
    await expect(readKml(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]))).rejects.toThrow('Arquivo KMZ corrompido.');
    await expect(readKml(utf8('isto não é um mapa'))).rejects.toBeInstanceOf(KmlError);
  });
});
