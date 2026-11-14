"use client";

import {Card} from "@heroui/react";
import {BarChart} from "@heroui-pro/react/bar-chart";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

export function TopChannelsCard() {
  const {snapshot, unlocked} = useOutrider();

  const data = useMemo(() => {
    const items = snapshot?.catalog_items ?? [];
    const counts = new Map<string, number>();

    for (const item of items) {
      const source = item.upstream_name ?? `local (${item.kind})`;

      counts.set(source, (counts.get(source) ?? 0) + 1);
    }

    return [...counts.entries()].map(([source, count]) => ({count, source}));
  }, [snapshot?.catalog_items]);

  return (
    <Card className="h-full rounded-2xl">
      <Card.Header>
        <Card.Title className="text-base text-balance">Catalog Items by Source</Card.Title>
        <Card.Description>Persisted tools and skills registered in SQLite.</Card.Description>
      </Card.Header>
      <Card.Content>
        {data.length === 0 ? (
          <p className="text-muted py-12 text-center text-xs">
            {unlocked ? "0 catalog items registered." : "Unlock to inspect catalog sources."}
          </p>
        ) : (
          <BarChart data={data} height={240} layout="vertical">
            <BarChart.Grid horizontal={false} />
            <BarChart.XAxis allowDecimals={false} tickMargin={4} type="number" />
            <BarChart.YAxis dataKey="source" tickMargin={4} type="category" width={120} />
            <BarChart.Bar
              barSize={16}
              dataKey="count"
              fill="var(--chart-3)"
              isAnimationActive={false}
              name="Items"
              radius={[0, 8, 8, 0]}
            />
            <BarChart.Tooltip content={<BarChart.TooltipContent />} />
          </BarChart>
        )}
      </Card.Content>
    </Card>
  );
}
