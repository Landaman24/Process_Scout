/**
 * Daily inquiry counts as a CSS-based bar chart. Pure HTML/CSS — no SVG,
 * no preserveAspectRatio quirks. Each column is a flex item with a percentage-
 * height bar; labels render as HTML at fixed pixel sizes so they stay legible
 * regardless of container width.
 */

interface Datum {
  day: string; // ISO YYYY-MM-DD
  count: number;
}

interface Props {
  data: Datum[];
  height?: number;
  // When true, label every bar; otherwise label every Nth so they don't overlap.
  labelEveryDay?: boolean;
}

export function DailyInquiriesChart({ data, height = 200, labelEveryDay }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-base text-muted-foreground italic py-6 text-center">
        No data in this window.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  // Reserve ~22px above bars for the count label, ~24px below for the date.
  const COUNT_BAND = 22;
  const LABEL_BAND = 24;
  const barAreaHeight = height - COUNT_BAND - LABEL_BAND;
  const labelStep = labelEveryDay ?? data.length <= 14 ? 1 : Math.ceil(data.length / 10);

  return (
    <div className="w-full" style={{ height }}>
      <div className="flex items-end gap-1 px-1" style={{ height: COUNT_BAND + barAreaHeight }}>
        {data.map((d) => {
          const pct = (d.count / max) * 100;
          // Always reserve a sliver if non-zero so a 1-of-50 bar is still visible.
          const barHeight = d.count > 0 ? Math.max((pct / 100) * barAreaHeight, 2) : 0;
          return (
            <div
              key={d.day}
              className="flex-1 flex flex-col items-center justify-end min-w-0"
              title={`${formatDay(d.day)}: ${d.count} ${d.count === 1 ? "inquiry" : "inquiries"}`}
            >
              {d.count > 0 ? (
                <div className="text-xs text-zinc-700 font-medium leading-none mb-1">
                  {d.count}
                </div>
              ) : (
                <div className="h-[14px]" />
              )}
              <div
                className="w-full bg-zinc-900 rounded-sm"
                style={{ height: barHeight }}
              />
            </div>
          );
        })}
      </div>
      <div
        className="flex gap-1 px-1 mt-1 border-t border-zinc-200"
        style={{ height: LABEL_BAND }}
      >
        {data.map((d, i) => {
          const showLabel = i % labelStep === 0 || i === data.length - 1;
          return (
            <div
              key={d.day}
              className="flex-1 text-[11px] text-zinc-500 text-center pt-1.5 truncate min-w-0"
            >
              {showLabel ? formatDay(d.day) : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
