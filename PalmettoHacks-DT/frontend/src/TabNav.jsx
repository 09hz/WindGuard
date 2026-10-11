import { useEffect, useState } from "react";
import { LayoutDashboard, Wind } from "lucide-react";

const TABS = [
  { id: "dashboard", label: "Dashboard", hash: "", icon: LayoutDashboard },
  { id: "simulator", label: "Simulator", hash: "#simulator", icon: Wind },
];

function tabFromHash() {
  return window.location.hash === "#simulator" ? "simulator" : "dashboard";
}

export function useActiveTab() {
  const [tab, setTab] = useState(tabFromHash);
  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return tab;
}

export default function TabNav({ active }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1">
      {TABS.map(({ id, label, hash, icon: Icon }) => (
        <a
          key={id}
          href={hash || "#"}
          aria-current={active === id ? "page" : undefined}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${active === id ? "bg-teal/[0.12] text-teal" : "text-slate-400 hover:text-slate-200"}`}
        >
          <Icon size={13} />
          {label}
        </a>
      ))}
    </nav>
  );
}
