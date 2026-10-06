/**
 * WorkbookShell — the Excel-style frame for the whole ERP.
 *
 *  ┌──────────┬────────────────────────────────────┐
 *  │ HFK      │ Module › Page        ⟳  🔔  ● user  │
 *  │ ▾ Fleet  ├────────────────────────────────────┤
 *  │   Trips  │                                    │
 *  │   …      │   the page                         │
 *  │ ▸ Ledgers│                                    │
 *  └──────────┴────────────────────────────────────┘
 *
 * A Zoho-style sidebar: each module (workbook) opens its pages (sheets); it folds to icons, and on
 * a phone it slides in from the menu button.
 * Nothing was removed: every legacy tab is a sheet here (grid, mounted screen,
 * or an embedded EnterpriseDashboard tab body).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LogOut, Menu, Bell, X, RefreshCw, ChevronDown } from "lucide-react";
import { DbUser } from "../../types.ts";
import { enterpriseFetch } from "../../../client/api.ts";
import { hasPermission, Resource } from "../../lib/rbac.ts";
import { WORKBOOKS, WorkbookDef, SheetDef } from "./workbookConfig.tsx";
import EntitySheet from "../sheets/EntitySheet.tsx";
import EnterpriseDashboard from "../EnterpriseDashboard.tsx";
import AlertsCenter from "../common/AlertsCenter.tsx";
import FuelTheftAudit from "../fleet/FuelTheftAudit.tsx";
import MonthlyReport from "../fleet/MonthlyReport.tsx";
import FleetSetupImport from "../fleet/FleetSetupImport.tsx";
import SmsGatewaySettings from "../fleet/SmsGatewaySettings.tsx";
import GpsProviderSettings from "../fleet/GpsProviderSettings.tsx";
import TripFuelHistory from "../fleet/TripFuelHistory.tsx";
import PartnerPnL from "../fleet/PartnerPnL.tsx";
import PersonalExpenses from "../fleet/PersonalExpenses.tsx";
import Zakat from "../fleet/Zakat.tsx";
import CashBook from "../fleet/CashBook.tsx";
import BooksCheck from "../fleet/BooksCheck.tsx";
import Books from "../fleet/Books.tsx";
import Banks from "../fleet/Banks.tsx";
import Statements from "../fleet/Statements.tsx";
import Tax from "../fleet/Tax.tsx";
import AccountingHome from "../fleet/AccountingHome.tsx";
import AIAccountant from "../fleet/AIAccountant.tsx";
import NewInvoice from "../fleet/NewInvoice.tsx";
import InvoicesList from "../fleet/InvoicesList.tsx";
import QuotationsList from "../fleet/QuotationsList.tsx";
import CompanyProfile from "../fleet/CompanyProfile.tsx";

import SmartDispatch from "../fleet/SmartDispatch.tsx";
import LiveTrackingMap from "../fleet/LiveTrackingMap.tsx";
import GpsTracking from "../fleet/GpsTracking.tsx";
import DataPortal from "../fleet/DataPortal.tsx";
import TruckLedgers from "../fleet/TruckLedgers.tsx";
import Parties from "../fleet/Parties.tsx";
import Partners from "../fleet/Partners.tsx";
import DuesAlerts from "../fleet/DuesAlerts.tsx";
import ReceiptSearch from "../fleet/ReceiptSearch.tsx";
import KhataOverview from "../fleet/KhataOverview.tsx";
import FinanceOverview from "../fleet/FinanceOverview.tsx";
import BillsPaymentsExpenses from "../fleet/BillsPaymentsExpenses.tsx";
import FleetSearch from "../fleet/FleetSearch.tsx";
import FleetDesk from "../fleet/FleetDesk.tsx";
import FleetAssetValue from "../fleet/FleetAssetValue.tsx";
import SystemReset from "../fleet/SystemReset.tsx";
import FinanceDashboard from "../fleet/FinanceDashboard.tsx";
import HRMSDashboard from "../fleet/HRMSDashboard.tsx";
import FuelIntelligence from "../fleet/FuelIntelligence.tsx";
import FleetMaintenance from "../fleet/FleetMaintenance.tsx";
import CustomerPortal from "../fleet/CustomerPortal.tsx";
import VendorPortal from "../fleet/VendorPortal.tsx";
import ExecutiveBI from "../fleet/ExecutiveBI.tsx";
import AIAssistant from "../fleet/AIAssistant.tsx";

interface Props {
  dbUser: DbUser;
  showFeedback: (type: "success" | "error", message: string) => void;
  handleLogout: () => void;
  apiHealth: boolean;
  apiHealthLoading: boolean;
  fetchHealth: () => void;
  /** everything EnterpriseDashboard needs for its embedded tab bodies */
  legacyProps: any;
}

const LS_KEY = "hf_workbook_nav_v1";

export default function WorkbookShell({
  dbUser,
  showFeedback,
  handleLogout,
  apiHealth,
  apiHealthLoading,
  fetchHealth,
  legacyProps,
}: Props) {
  const role = dbUser?.role;

  const sheetVisible = useCallback(
    (s: SheetDef) => !s.resource || hasPermission(role, s.resource as Resource, "read"),
    [role],
  );

  const visibleWorkbooks = useMemo(
    () =>
      WORKBOOKS.map((wb) => ({ ...wb, sheets: wb.sheets.filter(sheetVisible) })).filter(
        (wb) => wb.sheets.length > 0,
      ),
    [sheetVisible],
  );

  // ---- nav state (localStorage + ?wb=&sheet= deep link) --------------------
  const readInitial = (): { wb: string; sheet: string } => {
    const url = new URLSearchParams(window.location.search);
    const qWb = url.get("wb");
    const qSheet = url.get("sheet");
    if (qWb && visibleWorkbooks.some((w) => w.id === qWb)) {
      const wb = visibleWorkbooks.find((w) => w.id === qWb)!;
      return { wb: qWb, sheet: wb.sheets.some((s) => s.id === qSheet) ? qSheet! : wb.sheets[0].id };
    }
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (saved && visibleWorkbooks.some((w) => w.id === saved.wb)) {
        const wb = visibleWorkbooks.find((w) => w.id === saved.wb)!;
        if (wb.sheets.some((s) => s.id === saved.sheet)) return saved;
        return { wb: saved.wb, sheet: wb.sheets[0].id };
      }
    } catch {
      /* ignore */
    }
    const first = visibleWorkbooks[0];
    return { wb: first?.id ?? "fleet", sheet: first?.sheets[0]?.id ?? "" };
  };

  const [nav, setNav] = useState(readInitial);
  // deep-link focus: which ledger / party a sheet should open on
  const readFocus = (): { ledgerId?: number; partyId?: number; entryId?: number; date?: string; tripId?: number } | null => {
    const u = new URLSearchParams(window.location.search);
    const l = Number(u.get("focusLedger"));
    const p = Number(u.get("focusParty"));
    const e = Number(u.get("focusEntry")) || undefined;
    const d = u.get("focusDate");
    const t = Number(u.get("focusTrip"));
    if (t) return { tripId: t };
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return { date: d };
    if (l) return { ledgerId: l, entryId: e };
    if (p) return { partyId: p, entryId: e };
    return null;
  };
  const [focus, setFocus] = useState<{ ledgerId?: number; partyId?: number; entryId?: number; date?: string; tripId?: number } | null>(readFocus);
  const [railOpen, setRailOpen] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const hardRefresh = () => {
    setRefreshKey((k) => k + 1); // remounts the active sheet -> every screen re-fetches
    setSpinning(true);
    setTimeout(() => setSpinning(false), 600);
  };
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertCount, setAlertCount] = useState<{ total: number; critical: number; high: number } | null>(null);

  // poll the alert feed for the header badge
  useEffect(() => {
    let alive = true;
    const pull = () =>
      enterpriseFetch("/api/alerts")
        .then((d) => alive && setAlertCount(d.counts))
        .catch(() => {});
    pull();
    const t = setInterval(pull, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [alertsOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(nav));
    } catch {
      /* ignore */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("wb", nav.wb);
    url.searchParams.set("sheet", nav.sheet);
    url.searchParams.delete("focusLedger");
    url.searchParams.delete("focusParty");
    url.searchParams.delete("focusEntry");
    url.searchParams.delete("focusDate");
    url.searchParams.delete("focusTrip");
    if (focus?.tripId) url.searchParams.set("focusTrip", String(focus.tripId));
    if (focus?.ledgerId) url.searchParams.set("focusLedger", String(focus.ledgerId));
    if (focus?.partyId) url.searchParams.set("focusParty", String(focus.partyId));
    if (focus?.entryId) url.searchParams.set("focusEntry", String(focus.entryId));
    if (focus?.date) url.searchParams.set("focusDate", focus.date);
    window.history.replaceState(null, "", url.toString());
  }, [nav, focus]);

  const activeWb: WorkbookDef | undefined =
    visibleWorkbooks.find((w) => w.id === nav.wb) ?? visibleWorkbooks[0];
  const activeSheet: SheetDef | undefined =
    activeWb?.sheets.find((s) => s.id === nav.sheet) ?? activeWb?.sheets[0];

  const go = (wbId: string, sheetId?: string, focusObj?: { ledgerId?: number; partyId?: number; entryId?: number; date?: string; tripId?: number } | null) => {
    const wb = visibleWorkbooks.find((w) => w.id === wbId);
    if (!wb) return;
    setNav({ wb: wbId, sheet: sheetId && wb.sheets.some((s) => s.id === sheetId) ? sheetId : wb.sheets[0].id });
    setFocus(focusObj || null);
  };

  // ---- component sheet resolver ------------------------------------------
  const renderComponent = (id: string) => {
    switch (id) {
      case "SmartDispatch":
        return <SmartDispatch showFeedback={showFeedback} />;
      case "LiveTrackingMap":
        return <LiveTrackingMap showFeedback={showFeedback} role={role} />;
      case "GpsTracking":
        return <GpsTracking showFeedback={showFeedback} role={role} />;
      case "DataPortal":
        return <DataPortal showFeedback={showFeedback} />;
      case "TruckLedgers":
        return <TruckLedgers showFeedback={showFeedback} focusLedgerId={focus?.ledgerId} focusEntryId={focus?.entryId} onNavigate={(w, s, f) => go(w, s, f)} />;
      case "Parties":
        return <Parties showFeedback={showFeedback} focusPartyId={focus?.partyId} focusEntryId={focus?.entryId}  onNavigate={(w, s, f) => go(w, s, f)} />;
      case "DuesAlerts":
        return <DuesAlerts showFeedback={showFeedback} onOpenParty={(id) => go("khata", "parties", { partyId: id })} />;
      case "ReceiptSearch":
        return (
          <ReceiptSearch
            showFeedback={showFeedback}
            onOpen={(f) => (f.partyId ? go("khata", "parties", { partyId: f.partyId }) : go("khata", "truck_ledgers", { ledgerId: f.ledgerId }))}
          />
        );
      case "FleetDesk":
        return <FleetDesk showFeedback={showFeedback} focusTripId={focus?.tripId} />;
      case "FleetSearch":
        return <FleetSearch showFeedback={showFeedback} onOpenLedger={(ledgerId) => go("khata", "truck_ledgers", { ledgerId })} />;
      case "FleetAssetValue":
        return <FleetAssetValue showFeedback={showFeedback} />;
      case "SystemReset":
        return <SystemReset showFeedback={showFeedback} isSuperAdmin={role === "Super Admin"} />;
      case "FinanceDashboard":
        return <FinanceDashboard dbUser={dbUser} showFeedback={showFeedback} onNavigate={(w, s) => go(w, s)} />;
      case "FinanceOverview":
        return <FinanceOverview showFeedback={showFeedback} onNavigate={(w, s) => go(w, s)} />;
      case "BillsPaymentsExpenses":
        return <BillsPaymentsExpenses showFeedback={showFeedback} />;
      case "KhataOverview":
        return <KhataOverview showFeedback={showFeedback} onNavigate={(w, s) => go(w, s)} />;
      case "Partners":
        return <Partners showFeedback={showFeedback} onNavigate={(w, sh, f) => go(w, sh, f)} />;
      case "HRMSDashboard":
        return <HRMSDashboard dbUser={dbUser} showFeedback={showFeedback} />;
      case "FuelIntelligence":
        return <FuelIntelligence showFeedback={showFeedback} />;
      case "FleetMaintenance":
        return <FleetMaintenance showFeedback={showFeedback} />;
      case "CustomerPortal":
        return <CustomerPortal showFeedback={showFeedback} />;
      case "VendorPortal":
        return <VendorPortal showFeedback={showFeedback} />;
      case "ExecutiveBI":
        return <ExecutiveBI showFeedback={showFeedback} />;
      case "AIAssistant":
        return <AIAssistant showFeedback={showFeedback} />;
      case "AlertsCenter":
        return <AlertsCenter showFeedback={showFeedback} onNavigate={(w, s, f) => go(w, s, f)} />;
      case "FuelTheftAudit":
        return <FuelTheftAudit showFeedback={showFeedback} />;
      case "MonthlyReport":
        return <MonthlyReport showFeedback={showFeedback} />;
      case "FleetSetupImport":
        return <FleetSetupImport showFeedback={showFeedback} onImported={() => go(nav.wb, nav.sheet)} />;
      case "SmsGatewaySettings":
        return <SmsGatewaySettings showFeedback={showFeedback} />;
      case "GpsProviderSettings":
        return <GpsProviderSettings showFeedback={showFeedback} />;
      case "TripFuelHistory":
        return <TripFuelHistory showFeedback={showFeedback} />;
      case "PartnerPnL":
        return <PartnerPnL showFeedback={showFeedback} onNavigate={(w, sh, f) => go(w, sh, f)} focusLedgerId={focus?.ledgerId} />;
      case "PersonalExpenses":
        return <PersonalExpenses showFeedback={showFeedback} />;
      case "Zakat":
        return <Zakat showFeedback={showFeedback} />;
      case "CashBook":
        return <CashBook showFeedback={showFeedback} onNavigate={(w, s, f) => go(w, s, f)} focusDate={focus?.date} />;
      case "Books":
        return <Books showFeedback={showFeedback} onNavigate={(w, s, f) => go(w, s, f)} />;
      case "Banks":
        return <Banks showFeedback={showFeedback} />;
      case "Statements":
        return <Statements showFeedback={showFeedback} />;
      case "Tax":
        return <Tax showFeedback={showFeedback} />;
      case "AIAccountant":
        return <AIAccountant showFeedback={showFeedback} onNavigate={(w, s, f) => go(w, s, f)} />;
      case "AccountingHome":
        return <AccountingHome showFeedback={showFeedback} onNavigate={(w, s, f) => go(w, s, f)} />;
      case "BooksCheck":
        return <BooksCheck showFeedback={showFeedback} onNavigate={(w, s, f) => go(w, s, f)} />;
      case "NewInvoice":
        return <NewInvoice showFeedback={showFeedback} />;
      case "InvoicesList":
        return <InvoicesList showFeedback={showFeedback} />;
      case "QuotationsList":
        return <QuotationsList showFeedback={showFeedback} />;
      case "CompanyProfile":
        return <CompanyProfile showFeedback={showFeedback} />;
      default:
        return <div className="p-6 text-sm">Unknown screen: {id}</div>;
    }
  };

  const renderSheet = (sheet: SheetDef) => {
    if (sheet.kind === "entity") {
      return (
        <div className="h-full p-3" key={`ent-${sheet.entityKey}-${refreshKey}`}>
          <EntitySheet
            entityKey={sheet.entityKey!}
            title={sheet.label}
            noImport={sheet.noImport}
            showFeedback={showFeedback}
          />
        </div>
      );
    }
    if (sheet.kind === "embed") {
      return (
        <div className="h-full overflow-y-auto" key={`emb-${sheet.tab}-${refreshKey}`}>
          <EnterpriseDashboard
            {...legacyProps}
            dbUser={dbUser}
            showFeedback={showFeedback}
            handleLogout={handleLogout}
            apiHealth={apiHealth}
            apiHealthLoading={apiHealthLoading}
            fetchHealth={fetchHealth}
            embedded
            activeTabOverride={sheet.tab}
          />
        </div>
      );
    }
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6" key={`cmp-${sheet.component}-${refreshKey}`}>
        {renderComponent(sheet.component!)}
      </div>
    );
  };

  // ---- navigation: a sidebar of modules, each opening its pages (Zoho-style) -------------
  const [mobileNav, setMobileNav] = useState(false);
  const [openWbs, setOpenWbs] = useState<Set<string>>(() => new Set(nav.wb ? [nav.wb] : []));
  useEffect(() => {
    if (activeWb) setOpenWbs((s) => (s.has(activeWb.id) ? s : new Set([...s, activeWb.id])));
  }, [activeWb?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const en = (label: string) => label.split(" · ")[0];
  const pickSheet = (wbId: string, sheetId: string) => {
    setNav({ wb: wbId, sheet: sheetId });
    setFocus(null);
    setMobileNav(false);
  };
  const toggleWb = (wb: WorkbookDef) => {
    if (!railOpen) {
      setRailOpen(true);
      setOpenWbs(new Set([wb.id]));
      if (wb.id !== activeWb?.id) pickSheet(wb.id, wb.sheets[0].id);
      return;
    }
    setOpenWbs((s) => {
      const n = new Set(s);
      n.has(wb.id) ? n.delete(wb.id) : n.add(wb.id);
      return n;
    });
    if (wb.id !== activeWb?.id) pickSheet(wb.id, wb.sheets[0].id);
  };

  const sidebar = (collapsed: boolean) => (
    <div className="h-full flex flex-col bg-[#13294B] text-white">
      <div className={`h-14 shrink-0 flex items-center gap-2.5 border-b border-white/10 ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <div className="w-8 h-8 shrink-0 rounded-lg bg-white flex items-center justify-center overflow-hidden">
          <img src="/hfk-logo.png" alt="HFK" className="w-7 h-7 object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-bold tracking-wide text-white truncate">HFK Enterprises</div>
            <div className="text-[10px] text-white/60 truncate">Transport ERP · Quetta</div>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto py-2 sidebar-scroll">
        {visibleWorkbooks.map((wb) => {
          const Icon = wb.icon;
          const isActive = wb.id === activeWb?.id;
          const isOpen = !collapsed && openWbs.has(wb.id);
          return (
            <div key={wb.id} className="px-2">
              <button
                onClick={() => toggleWb(wb)}
                title={collapsed ? wb.label : undefined}
                className={`w-full flex items-center gap-2.5 rounded-lg ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"} text-[13px] font-medium ${
                  isActive ? "bg-white/12 text-white" : "text-white/75 hover:bg-white/8 hover:text-white"
                }`}
                style={isActive ? { backgroundColor: "rgba(255,255,255,.12)" } : undefined}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left truncate">{wb.label}</span>
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 opacity-60 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </>
                )}
              </button>
              {isOpen && (
                <div className="mt-0.5 mb-1.5 ml-[22px] border-l border-white/15 pl-2 space-y-px">
                  {wb.sheets.map((s) => {
                    const on = isActive && s.id === activeSheet?.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => pickSheet(wb.id, s.id)}
                        title={s.label}
                        className={`w-full text-left rounded-md px-2.5 py-1.5 text-[12.5px] truncate ${on ? "bg-white text-[#13294B] font-semibold" : "text-white/70 hover:text-white hover:bg-white/8"}`}
                        style={on ? { color: "#13294B" } : undefined}
                      >
                        {en(s.label)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {!collapsed && (
        <div className="shrink-0 border-t border-white/10 px-4 py-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-[11px] font-bold uppercase text-white">
            {dbUser.name ? dbUser.name.slice(0, 2) : "OP"}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[12px] font-semibold text-white truncate">{dbUser.name || "Operator"}</div>
            <div className="text-[10px] text-white/60 capitalize truncate">{dbUser.role}</div>
          </div>
          <button onClick={handleLogout} title="Sign out" className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen w-full flex bg-[#F4F6FA] overflow-hidden print:h-auto print:overflow-visible print:block">
      {/* sidebar — desktop */}
      <aside className={`hidden md:block shrink-0 transition-[width] duration-150 print:hidden ${railOpen ? "w-60" : "w-16"}`} style={{ backgroundColor: "#13294B", borderRight: 0 }}>
        {sidebar(!railOpen)}
      </aside>
      {/* sidebar — phone */}
      {mobileNav && (
        <div className="md:hidden fixed inset-0 z-50 flex print:hidden">
          <div className="w-72 max-w-[85vw] h-full shadow-2xl">{sidebar(false)}</div>
          <div className="flex-1 bg-black/30" onClick={() => setMobileNav(false)} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col print:block">
        {/* top bar */}
        <header className="h-14 shrink-0 border-b border-[#E3E8EF] bg-white px-3 md:px-5 flex items-center gap-3 print:hidden">
          <button
            onClick={() => (window.innerWidth < 768 ? setMobileNav(true) : setRailOpen((o) => !o))}
            className="p-2 -ml-1 rounded-lg hover:bg-[#F1F4F9] text-[#4B5563]"
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-[#6B7280] truncate">{activeWb?.label}</div>
            <div className="text-[15px] font-semibold text-[#111827] truncate leading-tight" dir="auto">{activeSheet?.label}</div>
          </div>
          <button onClick={hardRefresh} title="Refresh this page · تازہ کریں" className="p-2 rounded-lg text-[#4B5563] hover:bg-[#F1F4F9]">
            <RefreshCw className={`w-[18px] h-[18px] ${spinning ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => setAlertsOpen(true)} title="Alerts" className="relative p-2 rounded-lg text-[#4B5563] hover:bg-[#F1F4F9]">
            <Bell className="w-[18px] h-[18px]" />
            {alertCount && alertCount.total > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#D70006] text-white text-[10px] font-bold flex items-center justify-center">
                {alertCount.total > 99 ? "99+" : alertCount.total}
              </span>
            )}
          </button>
          <button
            onClick={fetchHealth}
            title={apiHealth ? "Connected to the server" : "Not connected — click to retry"}
            className={`hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${apiHealth ? "border-[#CFE3D6] bg-[#F1F8F4] text-[#166534]" : "border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]"}`}
          >
            <span className={`w-2 h-2 rounded-full ${apiHealth ? "bg-[#16A34A]" : "bg-[#D70006]"} ${apiHealthLoading ? "animate-pulse" : ""}`} style={{ backgroundColor: apiHealth ? "#16A34A" : "#D70006" }} />
            {apiHealth ? "Online" : "Offline"}
          </button>
          <div className="w-8 h-8 rounded-full bg-[#EAF0F8] border border-[#C9D7EC] flex items-center justify-center text-[11px] font-bold uppercase text-[#24539B] md:hidden">
            {dbUser.name ? dbUser.name.slice(0, 2) : "OP"}
          </div>
        </header>

        {/* the page */}
        <main className="flex-1 min-w-0 min-h-0 bg-[#F4F6FA] overflow-hidden print:h-auto print:overflow-visible print:block">
          {activeSheet ? renderSheet(activeSheet) : <div className="p-6 text-sm text-[#6B7280]">No page available for your role.</div>}
        </main>
      </div>

      {/* alerts drawer */}
      {alertsOpen && (
        <div className="fixed inset-0 z-[60] flex" onMouseDown={() => setAlertsOpen(false)}>
          <div className="flex-1 bg-black/20" />
          <div className="w-[460px] max-w-[94vw] bg-white h-full shadow-2xl border-l border-[#E3E8EF] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 h-14 border-b border-[#E3E8EF]">
              <span className="font-semibold text-[#111827] flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#D70006]" /> Alerts · الرٹس
              </span>
              <button onClick={() => setAlertsOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F1F4F9] text-[#4B5563]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-3">
              <AlertsCenter
                compact
                showFeedback={showFeedback}
                onNavigate={(w, s, f) => {
                  go(w, s, f);
                  setAlertsOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
