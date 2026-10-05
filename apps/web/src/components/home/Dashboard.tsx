// The dashboard is deliberately registry-driven: the server prepares the small, serialisable
// category model and the responsive client view only decides how to arrange it.
import { GROUPS, toolsForCatalogPage } from "@onestop/tool-registry";
import { DashboardView } from "@/components/home/DashboardView";
import { firstNameOf, timeOfDayGreeting } from "@/lib/greeting";

export function Dashboard({ name }: { name: string | null }) {
  const first = firstNameOf(name);
  const greeting = `Good ${timeOfDayGreeting()}${first ? `, ${first}` : ""}`;
  const groups = GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    icon: group.icon,
    blurb: group.blurb,
    count: toolsForCatalogPage(group.id).length,
  }));

  return <DashboardView greeting={greeting} groups={groups} />;
}
