import type { Chart } from '@daily-loop/shared';
import { strings } from '../strings';

const W = 320;
const H = 180;
const PAD = { top: 10, right: 8, bottom: 22, left: 34 };

/**
 * A small candlestick chart drawn as plain SVG (no chart library: a few hundred bytes instead of
 * tens of KB on a cheap phone).
 *
 * Rising candles are hollow and falling candles are filled, the classic convention, so they can be
 * told apart without relying on green and red alone.
 */
export function ChartView({ chart }: { chart: Chart }) {
  const { candles, highlightLast } = chart;
  const lows = candles.map((c) => c[2]);
  const highs = candles.map((c) => c[1]);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const margin = (max - min) * 0.06 || 1;
  const lo = min - margin;
  const hi = max + margin;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / candles.length;
  const bodyW = Math.max(3, slot * 0.6);
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
  const start = candles[0]![3];
  const lastX = x(candles.length - 1);

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={strings.chartAria(candles.length)}
        preserveAspectRatio="xMidYMid meet"
      >
        {highlightLast && (
          <rect
            className="chart__highlight"
            x={lastX - slot / 2}
            y={PAD.top}
            width={slot}
            height={plotH}
            rx={3}
          />
        )}

        {/* Price labels and the starting level (100). */}
        <text className="chart__label" x={PAD.left - 4} y={y(max) + 4} textAnchor="end">
          {max.toFixed(0)}
        </text>
        <text className="chart__label" x={PAD.left - 4} y={y(min) + 4} textAnchor="end">
          {min.toFixed(0)}
        </text>
        <line
          className="chart__start"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(start)}
          y2={y(start)}
        />
        <text className="chart__label" x={PAD.left - 4} y={y(start) + 4} textAnchor="end">
          {start.toFixed(0)}
        </text>

        {candles.map(([open, high, low, close], i) => {
          const up = close >= open;
          const top = y(Math.max(open, close));
          const bodyH = Math.max(1.5, Math.abs(y(open) - y(close)));
          return (
            <g key={i} className={up ? 'candle candle--up' : 'candle candle--down'}>
              <line x1={x(i)} x2={x(i)} y1={y(high)} y2={y(low)} />
              <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={bodyH} />
            </g>
          );
        })}

        <text className="chart__label" x={x(0)} y={H - 6} textAnchor="middle">
          {strings.chartDay(1)}
        </text>
        <text className="chart__label" x={lastX} y={H - 6} textAnchor="end">
          {strings.chartDay(candles.length)}
        </text>
      </svg>
      <figcaption className="chart__caption">{strings.chartCaption}</figcaption>
    </figure>
  );
}
