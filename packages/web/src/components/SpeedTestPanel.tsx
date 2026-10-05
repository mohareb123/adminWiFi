/**
 * Speed Test (spec §20): PING → DOWNLOAD → UPLOAD with an animated counter and
 * a final honest figure. The panel always states *how* the measurement was made
 * (real internet, shaped demo line, or the local segment) — never presenting an
 * estimate as a measurement.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useEffect, useState } from 'react';
import { COPY } from '../core/i18n';
import { formatClock, formatMbps, formatMs } from '../core/format';
import { store, useAppState } from '../core/store';
import { SpeedGauge } from './charts';
import { Badge, Button, Callout, KeyValue, Panel, Tile, Toggle } from './ui';
import { isNativeShell } from '../core/runtime';

export function SpeedTestPanel(): JSX.Element {
  const speedTest = useAppState((state) => state.speedTest);
  const plan = useAppState((state) => state.speedPlan);
  const runtime = useAppState((state) => state.runtime);
  const onDevice = runtime.kind === 'device' || isNativeShell();
  const [internetConsent, setInternetConsent] = useState(false);

  // Consent is remembered on the device, and never sent anywhere.
  useEffect(() => {
    if (!onDevice) return;
    void import('../native/device-speedtest').then((module) => setInternetConsent(module.internetSpeedTestAllowed()));
  }, [onDevice]);

  const toggleInternet = (value: boolean): void => {
    setInternetConsent(value);
    void import('../native/device-speedtest').then((module) => module.setInternetSpeedTestAllowed(value));
  };

  const phase = speedTest.phase ?? 'ping';
  const phaseLabelAr =
    phase === 'ping' ? 'زمن الاستجابة' : phase === 'down' ? COPY.speed.download : phase === 'up' ? COPY.speed.upload : 'انتهى';

  const liveValue =
    phase === 'down'
      ? (speedTest.downSamples[speedTest.downSamples.length - 1] ?? 0)
      : phase === 'up'
        ? (speedTest.upSamples[speedTest.upSamples.length - 1] ?? 0)
        : (speedTest.result?.downloadMbps ?? 0);

  const gaugeMax = Math.max(10, plan.simulated ? plan.downloadMbps * 1.35 : (speedTest.result?.downloadMbps ?? 100) * 1.2);

  const result = speedTest.result;

  return (
    <div className="stack">
      <Panel
        title={COPY.speed.title}
        icon="🚀"
        actions={plan.simulated ? <Badge tone="demo">{COPY.connect.demoBadge}</Badge> : <Badge tone="ok">قياس حقيقي</Badge>}
      >
        <div className="speed-stage">
          <div className="speed-phases">
            {(['ping', 'down', 'up'] as const).map((entry) => (
              <span
                key={entry}
                className={`phase-pill ${speedTest.running && phase === entry ? 'active' : ''} ${
                  speedTest.running && ['ping', 'down', 'up'].indexOf(phase) > ['ping', 'down', 'up'].indexOf(entry)
                    ? 'done'
                    : result
                      ? 'done'
                      : ''
                }`}
              >
                {entry === 'ping' ? 'PING' : entry === 'down' ? 'DOWNLOAD' : 'UPLOAD'}
              </span>
            ))}
          </div>

          <SpeedGauge
            value={speedTest.running && phase === 'ping' ? 0 : liveValue}
            maxValue={gaugeMax}
            phaseLabel={speedTest.running ? phaseLabelAr : result ? 'النتيجة النهائية' : 'جاهز للقياس'}
            color={phase === 'down' ? '#4dd8ff' : phase === 'up' ? '#34e5b0' : '#8b7cff'}
          />

          <div className="row row-wrap" style={{ justifyContent: 'center' }}>
            <Button
              variant="primary"
              onClick={() => store.runSpeedTest()}
              loading={speedTest.running}
              disabled={speedTest.running}
            >
              {result ? COPY.speed.again : COPY.speed.start}
            </Button>
          </div>

          {speedTest.errorAr && <Callout tone="crit" icon="⚠️">{speedTest.errorAr}</Callout>}

          {plan.simulated && <Callout tone="info" icon="🧪">{COPY.speed.demoNote}</Callout>}

          {onDevice && !plan.simulated && (
            <div className="stack" style={{ gap: 6 }}>
              <Callout tone="info" icon="📍">
                القياس الافتراضي يتم بين هاتفك والراوتر فقط — لا تخرج أي بيانات للإنترنت. الرفع وقياس سرعة الخط
                الحقيقية يحتاجان موافقتك على استخدام خادم قياس عام.
              </Callout>
              <Toggle
                checked={internetConsent}
                onChange={toggleInternet}
                label="قياس سرعة الإنترنت الحقيقية (خادم عام — بموافقتك)"
              />
            </div>
          )}

          {result && (
            <>
              <div className="grid grid-tiles" style={{ width: '100%' }}>
                <Tile label={COPY.speed.download} icon="↓" value={formatMbps(result.downloadMbps).split(' ')[0]} unit="Mbps" tone="ok" />
                <Tile label={COPY.speed.upload} icon="↑" value={formatMbps(result.uploadMbps).split(' ')[0]} unit="Mbps" />
                <Tile label={COPY.speed.ping} icon="⏱️" value={Math.round(result.pingMs)} unit="ms" foot={`تذبذب ${result.jitterMs.toFixed(1)} ms`} />
              </div>

              <div style={{ width: '100%' }}>
                <KeyValue
                  entries={[
                    [COPY.speed.server, <span className="ltr">{result.serverLabel}</span>],
                    [
                      'طريقة القياس',
                      result.method === 'simulated'
                        ? 'وضع تجريبي (خط وهمي بمعايير واقعية)'
                        : result.method === 'browser-direct'
                          ? 'من المتصفح مباشرة'
                          : result.method === 'device-local'
                            ? 'على الجهاز (نقل حقيقي — محلي أو بموافقتك)'
                            : 'من الجسر المحلي (نقل حقيقي)',
                    ],
                    ['وقت القياس', formatClock(result.testedAt)],
                    ['مدة الاختبار', `${(result.durationMs / 1000).toFixed(1)} ثانية`],
                  ]}
                />
              </div>
            </>
          )}

          {!result && !speedTest.running && (
            <p className="small muted center" style={{ maxWidth: 520 }}>
              يقيس التطبيق التنزيل والرفع فعليًا. زمن الاستجابة يُقاس بمتوسط عدة محاولات، والتذبذب من فرق القياسات —
              بدون أي أرقام تجميلية.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
