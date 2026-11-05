import { useId } from "react";
import { drawFigure, type Figure } from "@/lib/figure-core";
import { RichText } from "@/components/blocks";
import { iconCredit, useBioicons } from "@/lib/bioicons";

/** An exam figure on "paper": always white with dark ink (so it reads like a real exam in dark mode too). */
export function FigureView({ figure, className = "" }: { figure: Figure; className?: string }) {
  const clipId = useId();
  const icons = useBioicons();
  let body: React.ReactNode = null;
  let credit = "";
  if (figure.type === "table") {
    body = (
      <div className="overflow-x-auto">
        <table className="mx-auto border-collapse text-sm text-neutral-900">
          {figure.headers.length > 0 && <thead><tr>{figure.headers.map((h, i) => <th key={i} className="border border-neutral-400 bg-neutral-100 px-3 py-1.5 font-semibold"><RichText text={h} /></th>)}</tr></thead>}
          <tbody>{figure.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-neutral-400 px-3 py-1.5 text-center"><RichText text={String(c)} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  } else if (figure.type === "crop") {
    body = figure.src ? <img src={figure.src} alt="Figure from the notes" className="mx-auto max-h-80 max-w-full" /> : <p className="py-6 text-center text-xs text-neutral-500">Figure unavailable</p>;
  } else {
    const d = drawFigure(figure);
    if (d) credit = iconCredit(d.prims.flatMap((p) => (p.t === "image" ? [p.name] : [])), icons);
    if (d) {
      body = (
        <svg viewBox={`0 0 ${d.w} ${d.h}`} className="mx-auto block h-auto w-full max-w-[560px]" role="img" aria-label={figure.type === "graph" ? figure.title ?? "Graph" : "Figure"} fontFamily="ui-sans-serif, system-ui, sans-serif">
          {d.clip && <clipPath id={clipId}><rect x={d.clip.x} y={d.clip.y} width={d.clip.w} height={d.clip.h} /></clipPath>}
          {d.prims.map((p, i) => {
            if (p.t === "path") return <path key={i} d={p.d} stroke={p.stroke ?? "none"} fill={p.fill ?? "none"} strokeWidth={p.w ?? 1} strokeDasharray={p.dash ? "6 5" : undefined} opacity={p.op} strokeLinejoin="round" strokeLinecap="round" clipPath={p.clip && d.clip ? `url(#${clipId})` : undefined} />;
            if (p.t === "circle") return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill ?? "none"} stroke={p.stroke} />;
            if (p.t === "image") { const ic = icons.get(p.name); return ic ? <image key={i} href={ic.src} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="xMidYMid meet" /> : <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill="#f3f4f6" stroke="#d1d5db" />; }
            return <text key={i} x={p.x} y={p.y} fontSize={p.size ?? 12} textAnchor={p.anchor ?? "start"} fill={p.fill ?? "#111827"} fontWeight={p.bold ? 700 : 400} transform={p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined}>{p.s}</text>;
          })}
        </svg>
      );
    }
  }
  const cap = "caption" in figure ? figure.caption : undefined;
  return (
    <figure className={`rounded-xl border border-border bg-white p-3 text-neutral-900 ${className}`}>
      {body}
      {cap && <figcaption className="mt-2 text-center text-xs text-neutral-600"><RichText text={cap} /></figcaption>}
      {credit && <p className="mt-1 text-center text-[10px] text-neutral-400">{credit}</p>}
    </figure>
  );
}
