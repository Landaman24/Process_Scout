import { Activity, BarChart3, FileText, LayoutDashboard, MessagesSquare } from "lucide-react";
import { useState } from "react";

import { cn } from "../lib/utils";
import { Containers } from "./cse/Containers";
import { Costs } from "./cse/Costs";
import { Inquiries } from "./cse/Inquiries";
import { Overview } from "./cse/Overview";
import { Prompts } from "./cse/Prompts";

type Tab = "overview" | "prompts" | "costs" | "containers" | "inquiries";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "prompts", label: "Prompt versions", icon: <FileText className="h-4 w-4" /> },
  { id: "costs", label: "Cost log", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "containers", label: "Containers", icon: <Activity className="h-4 w-4" /> },
  { id: "inquiries", label: "Inquiry log", icon: <MessagesSquare className="h-4 w-4" /> },
];

export function CSEDashboard() {
  const [active, setActive] = useState<Tab>("overview");

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 md:px-8 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">CSE Console</h1>
        <p className="text-muted-foreground text-base mt-1">
          Operations view for prompt versions, costs, container health, and the full inquiry log.
        </p>
      </div>

      <div className="border-b px-4 md:px-8 overflow-x-auto">
        <div className="flex gap-1 -mb-px min-w-max">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                active === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-8">
        {active === "overview" && <Overview />}
        {active === "prompts" && <Prompts />}
        {active === "costs" && <Costs />}
        {active === "containers" && <Containers />}
        {active === "inquiries" && <Inquiries />}
      </div>
    </div>
  );
}
