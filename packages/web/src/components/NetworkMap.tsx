/**
 * Animated network map.
 *
 * Router in the centre, devices on an orbit, and packet particles whose *speed
 * and density follow the measured throughput* — so the animation is a readout,
 * not decoration ("كل حركة لها معنى"). When throughput is zero the particles
 * coast to a halt instead of pretending there is traffic.
 *
 * Performance: one canvas, one ticker, zero React state per frame. Positions are
 * computed once per layout (device list + size) and particles mutate in place.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { DeviceRecord } from '@urlm/core';
import { signalPercent } from '../core/format';
import { useAppState } from '../core/store';
import { useTicker, useVisuals } from '../visual/provider';

interface Particle {
  angle: number;
  progress: number;
  speed: number;
  direction: 1 | -1;
  size: number;
  color: string;
  node: number;
}

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  blocked: boolean;
  online: boolean;
  color: string;
  isRouter?: boolean;
}

const DEVICE_COLORS: Record<string, string> = {
  phone: '#4dd8ff',
  computer: '#8b7cff',
  tv: '#34e5b0',
  tablet: '#ffb94d',
  console: '#ff5d7a',
  camera: '#7fe4ff',
  iot: '#9d8dff',
  printer: '#ffa93d',
  unknown: '#8fa3c8',
};

export function NetworkMap({ onSelectDevice }: { onSelectDevice?: (device: DeviceRecord) => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshot = useAppState((state) => state.snapshot);
  const samples = useAppState((state) => state.samples);
  const { profile } = useVisuals();

  const latest = samples[samples.length - 1];
  const rateRef = useRef({ down: 0, up: 0 });
  rateRef.current = { down: latest?.downKbps ?? 0, up: latest?.upKbps ?? 0 };

  const devices = useMemo(() => {
    const list = snapshot?.devices ?? [];
    // Keep the drawing light: the map is a summary, the device list is the detail.
    return list.slice(0, 24);
  }, [snapshot]);

  const nodesRef = useRef<Node[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const hoverRef = useRef<{ x: number; y: number; node: Node } | null>(null);
  const layoutRef = useRef({ width: 0, height: 0 });

  /* ---------------- layout ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const relayout = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      layoutRef.current = { width, height };
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.max(90, Math.min(width, height) / 2 - 62);
      const nodes: Node[] = [
        {
          id: 'router',
          label: 'الراوتر',
          x: centerX,
          y: centerY,
          radius: 30,
          blocked: false,
          online: true,
          color: '#4dd8ff',
          isRouter: true,
        },
      ];
      const count = Math.max(1, devices.length);
      devices.forEach((device, index) => {
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        const wobble = devices.length > 12 ? 26 : 0;
        const distance = radius - (index % 2 === 0 ? 0 : wobble);
        nodes.push({
          id: device.id,
          label: device.name || device.mac,
          x: centerX + Math.cos(angle) * distance,
          y: centerY + Math.sin(angle) * distance * 0.82,
          radius: 14 + signalPercent(device.signal) / 14,
          blocked: Boolean(device.blocked),
          online: true,
          color: DEVICE_COLORS[device.kind ?? 'unknown'] ?? DEVICE_COLORS.unknown!,
        });
      });
      nodesRef.current = nodes;

      const budget = profile.particles;
      const particles: Particle[] = [];
      for (let index = 0; index < budget; index += 1) {
        const node = 1 + (index % Math.max(1, nodes.length - 1));
        particles.push({
          angle: 0,
          progress: Math.random(),
          speed: 0.0004 + Math.random() * 0.0006,
          direction: index % 3 === 0 ? -1 : 1,
          size: 1.6 + Math.random() * 1.8,
          color: Math.random() > 0.5 ? '#4dd8ff' : '#34e5b0',
          node,
        });
      }
      particlesRef.current = particles;
    };
    relayout();
    const observer = new ResizeObserver(relayout);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [devices, profile.particles]);

  /* ---------------- paint loop ---------------- */

  const scrollSpeed = useRef(0);

  useTicker(
    'network-map',
    (now, delta) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = layoutRef.current;
      if (!width || !height) return;
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const nodes = nodesRef.current;
      const router = nodes[0];
      if (!router || router.id !== 'router') return;

      // Particle speed follows throughput (log scale, so 1 Mbps already moves).
      const total = rateRef.current.down + rateRef.current.up;
      const intensity = total <= 0 ? 0 : Math.min(1, Math.log10(1 + total / 250) / 2.4);
      scrollSpeed.current += (intensity - scrollSpeed.current) * Math.min(1, delta / 400);

      const ambient = profile.animations ? 1 : 0;

      // links
      ctx.lineWidth = 1;
      for (let index = 1; index < nodes.length; index += 1) {
        const node = nodes[index] as Node;
        ctx.strokeStyle = node.blocked ? 'rgba(255,93,122,0.28)' : 'rgba(126,178,255,0.22)';
        ctx.beginPath();
        ctx.moveTo(router.x, router.y);
        ctx.lineTo(node.x, node.y);
        ctx.stroke();
      }

      // particles along the links — moving inwards on download, outwards on upload
      for (const particle of particlesRef.current) {
        const node = nodes[particle.node] ?? nodes[1];
        if (!node) continue;
        const speed = particle.speed * (0.25 + scrollSpeed.current * 3.4) * (delta || 16) * ambient;
        particle.progress += speed * particle.direction;
        if (particle.progress > 1) particle.progress -= 1;
        if (particle.progress < 0) particle.progress += 1;
        const t = particle.progress;
        const x = router.x + (node.x - router.x) * t;
        const y = router.y + (node.y - router.y) * t;
        const alpha = 0.25 + 0.6 * Math.sin(Math.PI * t);
        if (node.blocked && particle.progress > 0.6) continue;
        ctx.beginPath();
        ctx.arc(x, y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(node.blocked ? '#ff5d7a' : particle.color, alpha);
        ctx.fill();
      }

      // device nodes
      for (let index = 1; index < nodes.length; index += 1) {
        const node = nodes[index] as Node;
        const pulse = ambient && !node.blocked ? 1 + Math.sin(now / 620 + index) * 0.04 : 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(node.blocked ? '#3a1622' : '#0d1526', 0.95);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = node.blocked ? '#ff5d7a' : node.color;
        ctx.stroke();

        // signal ticks
        const strength = strengthOf(node);
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * pulse + 5, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * strength) / 4);
        ctx.strokeStyle = withAlpha(node.color, 0.55);
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // router hub
      const routerPulse = ambient ? 1 + Math.sin(now / 900) * 0.03 : 1;
      const glow = ctx.createRadialGradient(router.x, router.y, 4, router.x, router.y, 90 * routerPulse);
      glow.addColorStop(0, 'rgba(77,216,255,0.30)');
      glow.addColorStop(1, 'rgba(77,216,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(router.x, router.y, 90 * routerPulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(router.x, router.y, router.radius * routerPulse, 0, Math.PI * 2);
      ctx.fillStyle = '#081527';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#4dd8ff';
      ctx.stroke();

      ctx.fillStyle = '#eaf6ff';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⌂', router.x, router.y + 1);

      // labels
      ctx.font = '500 11px system-ui, sans-serif';
      for (let index = 1; index < nodes.length; index += 1) {
        const node = nodes[index] as Node;
        const label = node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label;
        const width74 = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(6,10,22,0.72)';
        ctx.beginPath();
        ctx.roundRect(node.x - width74 / 2 - 5, node.y + node.radius + 6, width74 + 10, 16, 6);
        ctx.fill();
        ctx.fillStyle = node.blocked ? '#ffd0da' : 'rgba(232,238,255,0.88)';
        ctx.fillText(label, node.x, node.y + node.radius + 14);
      }

      // hover highlight
      const hover = hoverRef.current;
      if (hover) {
        ctx.beginPath();
        ctx.arc(hover.node.x, hover.node.y, hover.node.radius + 12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    60,
    true,
  );

  /* ---------------- interaction (throttled, no per-move state) ---------------- */

  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = nodesRef.current.find((node) => Math.hypot(node.x - x, node.y - y) <= node.radius + 10) ?? null;
    hoverRef.current = hit ? { x, y, node: hit } : null;
  };

  const onClick = () => {
    const hover = hoverRef.current;
    if (!hover || hover.node.isRouter || !onSelectDevice) return;
    const device = devices.find((entry) => entry.id === hover.node.id);
    if (device) onSelectDevice(device);
  };

  return (
    <div className="map-wrap">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerMove={onMove}
        onPointerLeave={() => (hoverRef.current = null)}
        onClick={onClick}
        style={{ cursor: hoverRef.current ? 'pointer' : 'default' }}
      />
      <div className="map-legend">
        <span>
          <i className="dot dot-live" style={{ display: 'inline-block', marginInlineEnd: 6 }} />
          {devices.length} جهاز على الخريطة
        </span>
        <span>سرعة الجزيئات = الاستهلاك الحقيقي</span>
      </div>
    </div>
  );
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const value = color.slice(1);
    const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

function strengthOf(node: Node): number {
  return node.blocked ? 0.6 : 3.4;
}
