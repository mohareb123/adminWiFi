/**
 * Bandwidth Manager (spec §16) — real incremental graphs.
 *
 * The samples come from the bridge (per-device rates when the router publishes
 * them, otherwise rates derived from byte-counter differencing). Nothing is
 * smoothed or invented: if the router exposes nothing, the panel says so.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useMemo } from 'react';
import { COPY } from '../core/i18n';
import { formatKb, formatKbps } from '../core/format';
import { useAppState } from '../core/store';
import { LiveGraph, MultiGraph } from './charts';
import { Badge, Callout, Panel, Tile } from './ui';

export function BandwidthPanel(): JSX.Element {
  const samples = useAppState((state) => state.samples);
  const snapshot = useAppState((state) => state.snapshot);
  const capabilities = useAppState((state) => state.describe?.capabilities ?? []);

  const latest = samples[samples.length - 1];
  const peakDown = useMemo(() => Math.max(0, ...samples.map((sample) => sample.downKbps)), [samples]);
  const totalDown = useMemo(() => samples.reduce((sum, sample) => sum + sample.downKbps / 8, 0), [samples]);
  const totalUp = useMemo(() => samples.reduce((sum, sample) => sum + sample.upKbps / 8, 0), [samples]);

  const capabilityState = (id: string) => capabilities.find((entry) => (entry.id as string) === id)?.supported === 'yes';
  const perDeviceSupported = capabilityState('per_device_stats');
  const controlsSupported = capabilityState('bandwidth_control');

  const top = useMemo(() => {
    const devices = snapshot?.devices ?? [];
    const withRates = devices.filter((device) => (device.rateDownKbps ?? 0) > 0 || device.usageKb);
    const peak = Math.max(1, ...withRates.map((device) => device.rateDownKbps ?? device.usageKb ?? 0));
    return withRates
      .map((device) => ({
        device,
        value: device.rateDownKbps ?? device.usageKb ?? 0,
        share: ((device.rateDownKbps ?? device.usageKb ?? 0) / peak) * 100,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [snapshot]);

  return (
    <div className="stack">
      <div className="grid grid-tiles">
        <Tile label={COPY.bandwidth.download} icon="↓" value={formatKbps(latest?.downKbps ?? 0).split(' ')[0]} unit={formatKbps(latest?.downKbps ?? 0).split(' ')[1]} />
        <Tile label={COPY.bandwidth.upload} icon="↑" value={formatKbps(latest?.upKbps ?? 0).split(' ')[0]} unit={formatKbps(latest?.upKbps ?? 0).split(' ')[1]} />
        <Tile label="أعلى سرعة تنزيل مسجّلة" icon="⚡" value={formatKbps(peakDown).split(' ')[0]} unit={formatKbps(peakDown).split(' ')[1]} />
        <Tile label={COPY.bandwidth.totalSince} icon="Σ" value={formatKb(totalDown)} foot={`رفع: ${formatKb(totalUp)}`} />
      </div>

      <Panel
        title={COPY.bandwidth.live}
        icon="📈"
        actions={<Badge tone="dim">{samples.length} عيّنة</Badge>}
      >
        <MultiGraph
          label="استهلاك الشبكة"
          series={[
            { values: samples.map((sample) => sample.downKbps), color: '#4dd8ff', fill: 'rgba(77,216,255,0.14)' },
            { values: samples.map((sample) => sample.upKbps), color: '#34e5b0', fill: 'rgba(52,229,176,0.12)' },
          ]}
        />
        <div className="graph-legend">
          <span className="legend-key"><i style={{ background: '#4dd8ff' }} /> {COPY.bandwidth.download}</span>
          <span className="legend-key"><i style={{ background: '#34e5b0' }} /> {COPY.bandwidth.upload}</span>
          <span className="spacer" />
          <span className="tiny faint">الرسم يعتمد على قياسات فعلية من الراوتر</span>
        </div>
      </Panel>

      <Panel
        title={COPY.bandwidth.topDevices}
        icon="🔥"
        actions={
          perDeviceSupported ? (
            <Badge tone="ok">قياس مباشر لكل جهاز</Badge>
          ) : controlsSupported ? (
            <Badge tone="warn">الترتيب حسب الاستهلاك التراكمي</Badge>
          ) : (
            <Badge tone="dim">غير متاح على هذا الراوتر</Badge>
          )
        }
      >
        {top.length === 0 ? (
          <Callout tone="info" icon="📊">{COPY.bandwidth.noData}</Callout>
        ) : (
          <div className="top-list">
            {top.map((entry) => (
              <div className="top-row" key={entry.device.id}>
                <span className="ellipsis">{entry.device.name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.max(3, entry.share)}%`, display: 'block' }} />
                </span>
                <span className="num small">
                  {entry.device.rateDownKbps ? formatKbps(entry.device.rateDownKbps) : formatKb(entry.device.usageKb)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="زمن الاستجابة والجودة" icon="⏱️">
        <LiveGraph
          values={useAppState((state) => state.monitor).map((sample) => sample.latencyMs)}
          color="#ffb94d"
          fill="rgba(255,185,77,0.12)"
          label="زمن الاستجابة"
        />
      </Panel>
    </div>
  );
}
