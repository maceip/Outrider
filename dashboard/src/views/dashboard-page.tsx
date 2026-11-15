"use client";

import {DashboardToolbar} from "../widgets/dashboard-toolbar";
import {EmployeesTable} from "../widgets/employees-table";
import {KpiRow} from "../widgets/kpi-row";
import {SalesPerformanceCard} from "../widgets/sales-performance-card";
import {TrafficSourceCard} from "../widgets/traffic-source-card";

export function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8">
      <DashboardToolbar />
      <KpiRow />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SalesPerformanceCard />
        <TrafficSourceCard />
      </div>
      <EmployeesTable />
    </div>
  );
}
