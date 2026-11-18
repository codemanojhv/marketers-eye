import { ArrowUpRight, BarChart3, CircleHelp, FileSearch, Layers3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

export interface DashboardBundle {
  brand: string;
  target: { domain?: string | null; input: string };
  generatedAt: string;
  scorecard: { channel: string; status: string; strength: number; evidence: string[] }[];
  evidence: { id: string; source: string; kind: string; title: string }[];
  unknowns: { channel: string; reason: string; manualCheck?: string }[];
  content: { platform: string; evidence?: string }[];
}

const channelNames: Record<string, string> = {
  paid_meta: "Paid · Meta", paid_google: "Paid · Google", paid_linkedin: "Paid · LinkedIn",
  paid_reddit: "Paid · Reddit", paid_tiktok: "Paid · TikTok", paid_apple: "Paid · Apple",
  organic_tiktok: "TikTok", organic_instagram: "Instagram", organic_youtube: "YouTube",
  organic_x: "X", organic_linkedin: "LinkedIn page", seo: "SEO", geo: "AI search",
  founder_led: "Founder-led", reddit_marketing: "Reddit marketing", community: "Community",
  launches: "Launches", app_store: "App stores", lifecycle: "Lifecycle", affiliate: "Affiliate",
  sales_led: "Sales-led",
};

const platformNames: Record<string, string> = {
  meta_ads: "Meta ads", google_ads: "Google ads", linkedin_ads: "LinkedIn ads",
  apple_ads: "Apple Search Ads", tiktok: "TikTok", instagram: "Instagram",
  youtube: "YouTube", x: "X", linkedin: "LinkedIn", reddit: "Reddit",
};
const sourceNames: Record<string, string> = {
  website: "Website", tracking: "Tracking", seo: "SEO", wayback: "Wayback Machine",
  appstore: "App Store", meta_ads: "Meta ads", google_ads: "Google Ads",
  linkedin_ads: "LinkedIn Ads", reddit_ads: "Reddit Ads", tiktok: "TikTok",
  instagram: "Instagram", youtube: "YouTube", x: "X", linkedin: "LinkedIn",
  threads: "Threads", founders: "Founders", reddit: "Reddit", hackernews: "Hacker News",
  producthunt: "Product Hunt", wikidata: "Wikidata", apple_ads: "Apple Search Ads",
};

const channelConfig: ChartConfig = {
  strength: { label: "Signal strength", color: "var(--chart-1)" },
};
const sourceConfig: ChartConfig = {
  records: { label: "Evidence records", color: "var(--chart-2)" },
};
const contentConfig: ChartConfig = {
  items: { label: "Items found", color: "var(--chart-3)" },
};

function displayName(value: string, names: Record<string, string>) {
  return names[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function safeLink(value?: string) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function openEvidence(ids: string[]) {
  if (ids.length) window.marketersEyeOpenEvidence?.(ids);
}

function SignalChart({ bundle }: { bundle: DashboardBundle }) {
  const assessed = bundle.scorecard.filter(channel => channel.status !== "unknown").length;
  const rows = bundle.scorecard
    .filter(channel => channel.status !== "unknown")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 9)
    .map(channel => ({
      label: displayName(channel.channel, channelNames),
      strength: channel.strength,
      status: channel.status,
      evidence: channel.evidence,
    }));

  return (
    <Card className="me-card">
      <CardHeader className="me-card-header">
        <div>
          <CardTitle className="me-card-title">Channel signals</CardTitle>
          <CardDescription>Heuristic strength · 0–3. This is not campaign performance.</CardDescription>
        </div>
        <Badge variant="outline" className="me-count-badge">{rows.length} of {assessed} shown</Badge>
      </CardHeader>
      <CardContent className="me-chart-content">
        {rows.length ? (
          <ChartContainer config={channelConfig} className="me-chart h-[286px]" initialDimension={{ width: 640, height: 286 }}>
            <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 10, top: 4, bottom: 0 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 5" />
              <XAxis type="number" domain={[0, 3]} ticks={[0, 1, 2, 3]} allowDecimals={false} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={112} tickLine={false} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar dataKey="strength" radius={5} maxBarSize={22} cursor="pointer" isAnimationActive={false} onClick={item => openEvidence(item.payload?.evidence ?? [])}>
                {rows.map(row => <Cell key={row.label} fill={row.status === "active" ? "var(--chart-1)" : row.status === "likely" ? "var(--chart-2)" : row.status === "dormant" ? "var(--chart-3)" : "var(--chart-4)"} />)}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : <div className="me-empty">No channel signals were confirmed in this run.</div>}
        <div className="me-chart-footnote">
          <div className="me-status-legend" aria-label="Channel status legend">
            {[["active", "Active"], ["likely", "Likely"], ["dormant", "Dormant"], ["none", "None found"]].map(([status, label]) => <span key={status}><i className={`me-status-dot me-status-${status}`} />{label}</span>)}
          </div>
          <Button variant="ghost" size="sm" onClick={() => openEvidence(rows.flatMap(row => row.evidence))}>View evidence</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CountChart({
  title,
  description,
  config,
  rows,
  valueKey,
  total,
  empty,
}: {
  title: string;
  description: string;
  config: ChartConfig;
  rows: { label: string; [key: string]: string | number | string[] }[];
  valueKey: string;
  total: number;
  empty: string;
}) {
  return (
    <Card className="me-card">
      <CardHeader className="me-card-header">
        <div><CardTitle className="me-card-title">{title}</CardTitle><CardDescription>{description}</CardDescription></div>
        <Badge variant="outline" className="me-count-badge">{total.toLocaleString()} total</Badge>
      </CardHeader>
      <CardContent className="me-chart-content">
        {rows.length ? (
          <ChartContainer config={config} className="me-chart h-[286px]" initialDimension={{ width: 520, height: 286 }}>
            <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 5" />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={112} tickLine={false} axisLine={false} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar dataKey={valueKey} fill={`var(--color-${valueKey})`} radius={5} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        ) : <div className="me-empty">{empty}</div>}
      </CardContent>
    </Card>
  );
}

function Unknowns({ bundle }: { bundle: DashboardBundle }) {
  const unknowns = bundle.unknowns.slice(0, 6);
  return (
    <Card className="me-card">
      <CardHeader className="me-card-header">
        <div><CardTitle className="me-card-title">Needs a closer look</CardTitle><CardDescription>Unknown means not confirmed, not inactive.</CardDescription></div>
        <Badge variant="outline" className="me-count-badge">{bundle.unknowns.length} open</Badge>
      </CardHeader>
      <CardContent>
        {unknowns.length ? <ul className="me-unknowns">
          {unknowns.map((item, index) => {
            const link = safeLink(item.manualCheck);
            return <li key={`${item.channel}-${index}`}>
              <div className="me-unknown-copy"><strong>{displayName(item.channel, channelNames)}</strong><p>{item.reason}</p></div>
              {link ? <a className="me-source-link" href={link} target="_blank" rel="noreferrer" aria-label={`Check ${displayName(item.channel, channelNames)} source`}><ArrowUpRight size={16} /></a> : null}
            </li>;
          })}
        </ul> : <div className="me-empty me-empty-short">No open unknowns were recorded.</div>}
        {bundle.unknowns.length > unknowns.length ? <p className="me-more-note">Showing {unknowns.length} of {bundle.unknowns.length} items.</p> : null}
      </CardContent>
    </Card>
  );
}

export function Dashboard({ bundle }: { bundle: DashboardBundle }) {
  const assessed = bundle.scorecard.filter(channel => channel.status !== "unknown").length;
  const unknownChannels = new Set(bundle.unknowns.map(item => item.channel)).size;
  const sources = Object.entries(bundle.evidence.reduce<Record<string, number>>((counts, item) => {
    counts[item.source] = (counts[item.source] ?? 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([source, records]) => ({ label: displayName(source, sourceNames), records }));
  const platforms = Object.entries(bundle.content.reduce<Record<string, number>>((counts, item) => {
    counts[item.platform] = (counts[item.platform] ?? 0) + 1;
    return counts;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([platform, items]) => ({ label: displayName(platform, platformNames), items }));
  const stats = [
    { label: "Evidence records", value: bundle.evidence.length, caption: "observations + derivations", icon: FileSearch },
    { label: "Channels assessed", value: `${assessed} / ${bundle.scorecard.length}`, caption: "checked in this run", icon: BarChart3 },
    { label: "Content found", value: bundle.content.length, caption: "posts, videos, ads, threads", icon: Layers3 },
    { label: "Unknown channels", value: unknownChannels, caption: "worth a manual check", icon: CircleHelp },
  ];
  const host = bundle.target.domain || bundle.target.input;

  return <div className="me-dashboard">
    <header className="me-dashboard-head">
      <div><p className="me-overline">MARKETING SNAPSHOT</p><h1>{bundle.brand}</h1><p className="me-dashboard-subtitle">{host}<span>·</span>Collected {new Date(bundle.generatedAt).toLocaleDateString()}</p></div>
      <div className="me-head-mark" aria-hidden="true"><BarChart3 size={19} /><span>Evidence-led view</span></div>
    </header>
    <section className="me-stats" aria-label="Run summary">
      {stats.map(({ label, value, caption, icon: Icon }) => <Card className="me-stat-card" key={label}>
        <CardContent className="me-stat-content"><div className="me-stat-copy"><span>{label}</span><strong>{value}</strong><small>{caption}</small></div><span className="me-stat-icon"><Icon size={19} aria-hidden="true" /></span></CardContent>
      </Card>)}
    </section>
    <section className="me-charts" aria-label="Marketing evidence visualizations">
      <SignalChart bundle={bundle} />
      <CountChart title="Evidence by source" description={`Collected records; top ${sources.length} sources shown.`} config={sourceConfig} rows={sources} valueKey="records" total={bundle.evidence.length} empty="No evidence records were collected." />
      <CountChart title="Content by platform" description={`Collected items; top ${platforms.length} shown, not engagement.`} config={contentConfig} rows={platforms} valueKey="items" total={bundle.content.length} empty="No posts, videos, ads, or threads were found." />
      <Unknowns bundle={bundle} />
    </section>
    <p className="me-disclaimer">Evidence is a snapshot of public sources. Channel strength is a heuristic summary; content and evidence counts describe collected items.</p>
  </div>;
}
