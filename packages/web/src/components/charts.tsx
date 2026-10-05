/**
 * Canvas charts — LiveGraph, Sparkline, SpeedGauge, ChannelChart.
 *
 * All of them draw inside the shared frame loop (`useTicker`), never in React
 * state, and read their data from refs. That is what keeps the dashboard at
 * 60 FPS while samples stream in (spec §39/§48): React re-renders only when the
 * numbers change, the pixels are painted by the compositor-friendly canvas.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTicker } from '../visual/provider';

interface Series {
  color: string;
  fill?: string;
}

function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return null;
  const targetW = Math.round(width * dpr);
  const targetH = Math.round(height * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

/** Rolling area chart for throughput / latency. */
export function LiveGraph({
  values,
  color = '#4dd8ff',
  fill = 'rgba(77, 216, 255, 0.18)',
  height = 132,
  max,
  label,
}: {
  values: number[];
  color?: string;
  fill?: string;
  height?: number;
  max?: number;
  label?: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<number[]>(values);
  dataRef.current = values;

  useTicker(`graph-${label ?? color}`, () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = setupCanvas(canvas);
    if (!surface) return;
    const { ctx, width, height: h } = surface;
    const data = dataRef.current;
    if (data.length < 2) return;

    const peak = Math.max(max ?? 0, ...data, 1);
    const stepX = width / (data.length - 1);
    const yFor = (value: number) => h - 6 - (value / peak) * (h - 18);

    // grid
    ctx.strokeStyle = 'rgba(126,178,255,0.12)';
    ctx.lineWidth = 1;
    for (let row = 1; row <= 3; row += 1) {
      const y = Math.round((h / 4) * row) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // area
    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((value, index) => ctx.lineTo(index * stepX, yFor(value)));
    ctx.lineTo(width, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // line
    ctx.beginPath();
    data.forEach((value, index) => {
      const x = index * stepX;
      const y = yFor(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // head
    const lastX = (data.length - 1) * stepX;
    const lastY = yFor(data[data.length - 1] as number);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 7, 0, Math.PI * 2);
    ctx.fillStyle = `${color}33`;
    ctx.fill();
  }, 30, true);

  return <canvas ref={canvasRef} className="graph-canvas" style={{ height }} role="img" aria-label={label} />;
}

/** Multi-series graph (download + upload on one scale). */
export function MultiGraph({
  series,
  height = 132,
  label,
}: {
  series: Array<Series & { values: number[] }>;
  height?: number;
  label?: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seriesRef = useRef(series);
  seriesRef.current = series;

  useTicker(`multi-${label ?? 'graph'}`, () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = setupCanvas(canvas);
    if (!surface) return;
    const { ctx, width, height: h } = surface;
    const peak = Math.max(1, ...seriesRef.current.flatMap((entry) => entry.values), 1);
    const stepX = width / Math.max(1, Math.max(...seriesRef.current.map((entry) => entry.values.length)) - 1);

    ctx.strokeStyle = 'rgba(126,178,255,0.12)';
    for (let row = 1; row <= 3; row += 1) {
      const y = Math.round((h / 4) * row) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    for (const entry of seriesRef.current) {
      if (entry.values.length < 2) continue;
      const yFor = (value: number) => h - 6 - (value / peak) * (h - 18);
      ctx.beginPath();
      entry.values.forEach((value, index) => {
        const x = index * stepX;
        const y = yFor(value);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = entry.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (entry.fill) {
        ctx.lineTo((entry.values.length - 1) * stepX, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = entry.fill;
        ctx.fill();
      }
    }
  }, 30, true);

  return <canvas ref={canvasRef} className="graph-canvas" style={{ height }} role="img" aria-label={label} />;
}

/** Speed-test gauge: an arc that fills with the measured value. */
export function SpeedGauge({
  value,
  maxValue,
  phaseLabel,
  unit = 'Mbps',
  color = '#4dd8ff',
}: {
  value: number;
  maxValue: number;
  phaseLabel: string;
  unit?: string;
  color?: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ value, maxValue, color, phaseLabel });
  stateRef.current = { value, maxValue, color, phaseLabel };
  const eased = useRef(0);

  useTicker(
    'speed-gauge',
    (_now, delta) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const surface = setupCanvas(canvas);
      if (!surface) return;
      const { ctx, width, height } = surface;
      const target = stateRef.current.value;
      // Ease towards the target so the needle never snaps.
      const speed = Math.min(1, delta / 160);
      eased.current += (target - eased.current) * speed;
      const radius = Math.min(width, height) / 2 - 16;
      const center = { x: width / 2, y: height / 2 + 8 };
      const start = Math.PI * 0.75;
      const sweep = Math.PI * 1.5;
      const ratio = Math.max(0, Math.min(1, eased.current / Math.max(1, stateRef.current.maxValue)));

      // track
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(126,178,255,0.14)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, start, start + sweep);
      ctx.stroke();

      // ticks
      ctx.strokeStyle = 'rgba(200,225,255,0.22)';
      ctx.lineWidth = 2;
      for (let tick = 0; tick <= 10; tick += 1) {
        const angle = start + (sweep * tick) / 10;
        const inner = radius - 20;
        const outer = radius - 12;
        ctx.beginPath();
        ctx.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner);
        ctx.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
        ctx.stroke();
      }

      // value arc
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, stateRef.current.color);
      gradient.addColorStop(1, '#8b7cff');
      ctx.lineWidth = 12;
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, start, start + sweep * ratio);
      ctx.stroke();

      // head dot
      const headAngle = start + sweep * ratio;
      ctx.beginPath();
      ctx.arc(center.x + Math.cos(headAngle) * radius, center.y + Math.sin(headAngle) * radius, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#eaf6ff';
      ctx.fill();
    },
    60,
    true,
  );

  return (
    <div className="gauge-wrap">
      <canvas ref={canvasRef} className="gauge-canvas" role="img" aria-label={`${phaseLabel}: ${value.toFixed(1)} ${unit}`} />
      <div className="gauge-value">
        <div className="gauge-number num">{value >= 100 ? value.toFixed(0) : value.toFixed(1)}</div>
        <div className="muted small">{unit}</div>
        <div className="faint tiny">{phaseLabel}</div>
      </div>
    </div>
  );
}

interface Neighbor {
  ssid: string;
  channel: number;
  signalDbm?: number;
  band: '2.4GHz' | '5GHz';
}

/** Wi-Fi channel congestion chart (DOM-based: it is tiny and static enough). */
export function ChannelChart({ neighbors, mine }: { neighbors: Neighbor[]; mine: Array<{ channel: number; band: string }> }): JSX.Element {
  const { columns, maxLoad } = useMemo(() => {
    const load = new Map<number, number>();
    for (const neighbor of neighbors) {
      const weight = Math.max(1, 1 + Math.round((Math.min(0, neighbor.signalDbm ?? -70) + 100) / 8));
      for (const channel of [neighbor.channel - 1, neighbor.channel, neighbor.channel + 1]) {
        if (channel < 1) continue;
        load.set(channel, (load.get(channel) ?? 0) + weight);
      }
    }
    const max = Math.max(1, ...load.values());
    const list = Array.from({ length: 14 }, (_value, index) => ({
      channel: index + 1,
      value: load.get(index + 1) ?? 0,
    }));
    return { columns: list, maxLoad: max };
  }, [neighbors]);

  return (
    <div className="channel-chart" role="img" aria-label="ازدحام القنوات">
      {columns.map((column) => {
        const isMine = mine.some((band) => band.channel === column.channel);
        return (
          <div key={column.channel} className={`channel-col ${isMine ? 'mine' : ''}`} title={`القناة ${column.channel}: ${column.value} شبكة`}>
            <i style={{ height: `${Math.max(3, (column.value / maxLoad) * 100)}%` }} />
            <span>{column.channel}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Circular score ring (security score, confidence). */
export function ScoreRing({ score, label, tone = 'ok', size = 96 }: { score: number; label: string; tone?: 'ok' | 'warn' | 'crit'; size?: number }): JSX.Element {
  const color = tone === 'ok' ? '#34e5b0' : tone === 'warn' ? '#ffb94d' : '#ff5d7a';
  return (
    <div className="score-ring" style={{ width: size, height: size, position: 'relative' }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * 264} 264`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
        <div className="num" style={{ fontSize: '1.35rem', fontWeight: 800 }}>
          {Math.round(score)}
        </div>
        <div className="faint tiny">{label}</div>
      </div>
    </div>
  );
}

/** Hook: sizes a canvas element's backing store to its CSS box (DPR aware). */
export function useCanvasSize(canvas: HTMLCanvasElement | null): () => { width: number; height: number; dpr: number } {
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  useEffect(() => {
    if (!canvas) return;
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { width: canvas.clientWidth, height: canvas.clientHeight, dpr };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);
  return () => sizeRef.current;
}
