import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './Icon';
import { areaWeightedCentroid, localProjector, type LngLat } from '../lib/geo';

export interface MapShape {
  id: string;
  name: string;
  /** Anéis em [lng, lat]: o primeiro é o contorno, os demais são buracos. Podem vir fechados. */
  rings: readonly (readonly [number, number])[][];
}

export interface ShapeStyle {
  fill: string;
  /** Cor do texto sobre o preenchimento. */
  text: string;
  /** Linhas abaixo do nome (ex.: "5,57 UA/ha", "dia 2"). A primeira é a de destaque. */
  lines?: string[];
  /** Área fora do pastejo: contorno tracejado. */
  dashed?: boolean;
}

interface Props {
  shapes: readonly MapShape[];
  styleOf: (id: string) => ShapeStyle;
  points?: readonly { lat: number; lon: number }[];
  /** Posição do aparelho (GPS), desenhada por cima de tudo. */
  me?: { lat: number; lon: number } | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  label: string;
}

const BG = '#0B120E';
// Lista vazia fixa: uma nova a cada desenho faria o mapa ser recalculado sem necessidade.
const NO_POINTS: readonly { lat: number; lon: number }[] = [];

/**
 * Mapa dos piquetes em SVG, sem imagem de satélite: abre igual sem sinal. Os
 * polígonos são projetados em metros em torno do centro da fazenda, norte para cima.
 */
export function FarmMap({ shapes, styleOf, points = NO_POINTS, me, selectedId, onSelect, label }: Props) {
  const geo = useMemo(() => {
    const all: LngLat[] = shapes.flatMap((s) => s.rings[0] ?? []);
    if (!all.length) return null;
    const origin: LngLat = [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length];
    const project = localProjector(origin);
    const xy = (p: LngLat): [number, number] => {
      const [x, y] = project(p);
      return [x, -y];
    };

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const items = shapes.map((s) => {
      let sx0 = Infinity;
      let sy0 = Infinity;
      let sx1 = -Infinity;
      let sy1 = -Infinity;
      const d = s.rings
        .map((ring) => {
          const pts = ring.map(xy);
          for (const [x, y] of pts) {
            sx0 = Math.min(sx0, x);
            sy0 = Math.min(sy0, y);
            sx1 = Math.max(sx1, x);
            sy1 = Math.max(sy1, y);
          }
          return `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
        })
        .join('');
      minX = Math.min(minX, sx0);
      minY = Math.min(minY, sy0);
      maxX = Math.max(maxX, sx1);
      maxY = Math.max(maxY, sy1);
      const outer = s.rings[0] ?? [];
      const open = outer.length > 1 && outer[0][0] === outer[outer.length - 1][0] && outer[0][1] === outer[outer.length - 1][1] ? outer.slice(0, -1) : outer;
      const c = areaWeightedCentroid([open]);
      const [cx, cy] = c ? xy([c.lon, c.lat]) : [(sx0 + sx1) / 2, (sy0 + sy1) / 2];
      return { id: s.id, name: s.name, d, cx, cy, w: sx1 - sx0, h: sy1 - sy0 };
    });

    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const pad = Math.max(w, h) * 0.02;
    return {
      items,
      dots: points.map((p) => xy([p.lon, p.lat])),
      xy,
      box: { x: minX - pad, y: minY - pad, w: w + 2 * pad, h: h + 2 * pad },
    };
  }, [shapes, points]);

  // Zoom: `scale` de 1 (tudo) a 8; `cx` e `cy` são o centro da vista, em fração do mapa.
  const [zoom, setZoom] = useState({ scale: 1, cx: 0.5, cy: 0.5 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);

  if (!geo) return null;
  const { box } = geo;
  const clampCenter = (scale: number, c: number) => Math.min(1 - 0.5 / scale, Math.max(0.5 / scale, c));
  const view = {
    w: box.w / zoom.scale,
    h: box.h / zoom.scale,
    x: box.x + clampCenter(zoom.scale, zoom.cx) * box.w - box.w / zoom.scale / 2,
    y: box.y + clampCenter(zoom.scale, zoom.cy) * box.h - box.h / zoom.scale / 2,
  };
  // Texto e traços acompanham a vista: ao aproximar, o nome do piquete pequeno passa a caber.
  const unit = Math.max(view.w, view.h);
  const selected = geo.items.find((i) => i.id === selectedId);

  const zoomBy = (factor: number) =>
    setZoom((z) => {
      const scale = Math.min(8, Math.max(1, z.scale * factor));
      return scale === 1 ? { scale: 1, cx: 0.5, cy: 0.5 } : { scale, cx: clampCenter(scale, z.cx), cy: clampCenter(scale, z.cy) };
    });

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) dragged.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (pointers.current.size === 2) {
      // Pinça: a distância entre os dois dedos dá o fator de zoom.
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0 && after > 0) zoomBy(after / before);
      dragged.current = true;
    } else if (zoom.scale > 1 && rect.width > 0 && rect.height > 0) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true;
      setZoom((z) => ({ scale: z.scale, cx: clampCenter(z.scale, z.cx - dx / rect.width / z.scale), cy: clampCenter(z.scale, z.cy - dy / rect.height / z.scale) }));
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
  };
  // Tocar depois de arrastar ou de dar zoom com os dedos não seleciona piquete.
  const pick = (id: string) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onSelect?.(id);
  };

  return (
    <div className="relative">
      <div className="absolute right-1 top-1 z-10 flex flex-col gap-1.5" role="group" aria-label="Zoom do mapa">
        <button type="button" className="btn h-[44px] w-[44px] bg-card/90 !px-0" aria-label="Aproximar" disabled={zoom.scale >= 8} onClick={() => zoomBy(1.6)}>
          <Icon name="plus" />
        </button>
        <button type="button" className="btn h-[44px] w-[44px] bg-card/90 !px-0 text-[22px] leading-none" aria-label="Afastar" disabled={zoom.scale <= 1} onClick={() => zoomBy(1 / 1.6)}>
          −
        </button>
        {zoom.scale > 1 ? (
          <button type="button" className="btn h-[44px] w-[44px] bg-card/90 !px-0 text-[11px]" aria-label="Ver o mapa inteiro" onClick={() => setZoom({ scale: 1, cx: 0.5, cy: 0.5 })}>
            tudo
          </button>
        ) : null}
      </div>
    <svg
      role="group"
      aria-label={label}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="block max-h-[72dvh] w-full select-none"
      preserveAspectRatio="xMidYMid meet"
      // Com zoom, o dedo arrasta o mapa; sem zoom, a página rola normalmente.
      style={{ touchAction: zoom.scale > 1 ? 'none' : 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={onPointerEnd}
    >
      {geo.items.map((it) => {
        const st = styleOf(it.id);
        const lines = st.lines ?? [];
        const room = Math.min(it.w, it.h);
        // O texto encolhe com o piquete; em piquete muito pequeno fica só o nome, ou nada.
        const fs = Math.min(Math.max(room * 0.13, unit * 0.011), unit * 0.03);
        const showName = room > unit * 0.035;
        const showLines = showName && room > unit * 0.07;
        const big = fs * 1.75;
        const block = showLines ? fs + (lines[0] ? big : 0) + Math.max(0, lines.length - 1) * fs * 1.15 : fs;
        let y = it.cy - block / 2 + fs * 0.8;
        return (
          <g
            key={it.id}
            role="button"
            tabIndex={onSelect ? 0 : -1}
            aria-label={[it.name, ...lines].join(', ')}
            aria-pressed={selectedId === it.id}
            onClick={() => pick(it.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(it.id);
              }
            }}
            style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}
          >
            <path
              d={it.d}
              fill={st.fill}
              fillRule="evenodd"
              stroke={st.dashed ? '#35483C' : BG}
              strokeWidth={unit * 0.004}
              strokeDasharray={st.dashed ? `${unit * 0.012} ${unit * 0.008}` : undefined}
              strokeLinejoin="round"
            />
            {showName ? (
              <text textAnchor="middle" fill={st.text} fontFamily='"Space Grotesk Variable", "Inter Variable", sans-serif' pointerEvents="none">
                <tspan x={it.cx} y={y} fontSize={fs} fontWeight={600}>
                  {it.name}
                </tspan>
                {showLines
                  ? lines.map((line, i) => {
                      y += i === 0 ? big * 0.95 : fs * 1.15;
                      return (
                        <tspan key={i} x={it.cx} y={y} fontSize={i === 0 ? big : fs * 0.9} fontWeight={i === 0 ? 700 : 500}>
                          {line}
                        </tspan>
                      );
                    })
                  : null}
              </text>
            ) : null}
          </g>
        );
      })}
      {selected ? (
        <path d={selected.d} fill="none" stroke="#EEF3EC" strokeWidth={unit * 0.008} strokeLinejoin="round" pointerEvents="none" />
      ) : null}
      {geo.dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={unit * 0.009} fill="#6FA8FF" stroke={BG} strokeWidth={unit * 0.003} pointerEvents="none" />
      ))}
      {me ? (
        (() => {
          const [x, y] = geo.xy([me.lon, me.lat]);
          return (
            <g pointerEvents="none" aria-label="Você está aqui" role="img">
              <circle cx={x} cy={y} r={unit * 0.034} fill="#FFFFFF" opacity={0.25} />
              <circle cx={x} cy={y} r={unit * 0.017} fill="#2F7BFF" stroke="#FFFFFF" strokeWidth={unit * 0.006} />
            </g>
          );
        })()
      ) : null}
    </svg>
    </div>
  );
}
