/**
 * WorkbookShell — the Excel-style frame for the whole ERP.
 *
 *  ┌───────────────────────────────────────────────┐
 *  │ HF Transport · Workbook / Sheet · API · user   │
 *  ├──────┬────────────────────────────────────────┤
 *  │ rail │  active sheet (grid / screen / view)    │
 *  ├──────┴────────────────────────────────────────┤
 *  │  ▸ Sheet1  Sheet2  Sheet3 …  (bottom tabs)     │
 *  └───────────────────────────────────────────────┘
 *
 * Left rail = workbooks. Bottom tabs = the sheets in the active workbook.
 * Nothing was removed: every legacy tab is a sheet here (grid, mounted screen,
 * or an embedded EnterpriseDashboard tab body).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, LogOut, Menu, Bell, X, RefreshCw } from "lucide-react";
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
  const readFocus = (): { ledgerId?: number; partyId?: number } | null => {
    const u = new URLSearchParams(window.location.search);
    const l = Number(u.get("focusLedger"));
    const p = Number(u.get("focusParty"));
    if (l) return { ledgerId: l };
    if (p) return { partyId: p };
    return null;
  };
  const [focus, setFocus] = useState<{ ledgerId?: number; partyId?: number } | null>(readFocus);
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
    if (focus?.ledgerId) url.searchParams.set("focusLedger", String(focus.ledgerId));
    if (focus?.partyId) url.searchParams.set("focusParty", String(focus.partyId));
    window.history.replaceState(null, "", url.toString());
  }, [nav, focus]);

  const activeWb: WorkbookDef | undefined =
    visibleWorkbooks.find((w) => w.id === nav.wb) ?? visibleWorkbooks[0];
  const activeSheet: SheetDef | undefined =
    activeWb?.sheets.find((s) => s.id === nav.sheet) ?? activeWb?.sheets[0];

  const go = (wbId: string, sheetId?: string, focusObj?: { ledgerId?: number; partyId?: number } | null) => {
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
        return <TruckLedgers showFeedback={showFeedback} focusLedgerId={focus?.ledgerId} />;
      case "Parties":
        return <Parties showFeedback={showFeedback} focusPartyId={focus?.partyId} />;
      case "DuesAlerts":
        return <DuesAlerts showFeedback={showFeedback} onOpenParty={(id) => go("khata", "parties", { partyId: id })} />;
      case "ReceiptSearch":
        return (
          <ReceiptSearch
            showFeedback={showFeedback}
            onOpen={(f) => (f.partyId ? go("khata", "parties", { partyId: f.partyId }) : go("khata", "truck_ledgers", { ledgerId: f.ledgerId }))}
          />
        );
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
        return <Partners showFeedback={showFeedback} />;
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
        return <PartnerPnL showFeedback={showFeedback} onOpenParty={(id) => go("khata", "parties", { partyId: id })} />;
      case "PersonalExpenses":
        return <PersonalExpenses showFeedback={showFeedback} />;
      case "Zakat":
        return <Zakat showFeedback={showFeedback} />;
      case "CashBook":
        return <CashBook showFeedback={showFeedback} />;
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

  return (
    <div className="h-screen w-full flex flex-col bg-[#F8FBF9] overflow-hidden print:h-auto print:overflow-visible print:block">
      {/* top bar */}
      <header className="h-12 shrink-0 border-b border-[#E5E7EB] bg-white px-3 flex items-center gap-3 print:hidden">
        <button
          onClick={() => setRailOpen((o) => !o)}
          className="p-1.5 rounded-md hover:bg-[#F4F6FA] text-[#4B5563]"
          title="Toggle workbooks"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <img src="/hfk-logo.png" alt="HFK Enterprises" className="h-6 w-[46px] min-w-[46px] shrink-0 object-contain" />
          <span className="text-[13px] font-extrabold tracking-tight uppercase text-[#24539B] hidden sm:inline">HFK Enterprises</span>
          <span className="text-[#9CA3AF]">/</span>
          <span className="text-[12px] font-semibold">{activeWb?.label}</span>
          <span className="text-[#9CA3AF]">/</span>
          <span className="text-[12px] text-[#4B5563] truncate">{activeSheet?.label}</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={hardRefresh}
          title="Refresh this sheet · تازہ کریں"
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold border bg-white border-[#E5E7EB] text-[#4B5563] hover:bg-[#F4F6FA]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`} /> Refresh
        </button>
        <button
          onClick={() => setAlertsOpen(true)}
          title="Alerts"
          className={`relative flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold border ${
            alertCount && alertCount.total > 0
              ? "bg-[#DC2626] border-[#B91C1C] text-white"
              : "bg-white border-[#E5E7EB] text-[#4B5563]"
          }`}
        >
          <Bell className="w-3.5 h-3.5" style={alertCount && alertCount.total > 0 ? { color: "#fff", stroke: "#fff" } : undefined} />
          {alertCount ? alertCount.total : 0}
          {alertCount && alertCount.critical > 0 && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#991B1B] animate-pulse" />
          )}
        </button>
        <button
          onClick={fetchHealth}
          className={`flex items-center gap-1.5 border rounded-full px-2.5 py-1 font-mono text-[10px] ${
            apiHealth ? "bg-[#DCFCE7] border-[#16A34A]" : "bg-[#FEE2E2] border-[#DC2626]"
          }`}
        >
          <Activity className={`w-3 h-3 ${apiHealthLoading ? "animate-spin" : ""}`} />
          {apiHealth ? "ONLINE" : "OFFLINE"}
        </button>
        <div className="flex items-center gap-2 pl-1">
          <div className="w-7 h-7 rounded-full bg-[#E9EEF5] border border-[#BFD3EC] flex items-center justify-center font-mono text-[10px] font-bold uppercase">
            {dbUser.name ? dbUser.name.slice(0, 2) : "OP"}
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="text-[11px] font-semibold truncate max-w-[140px]">{dbUser.name || "Operator"}</div>
            <div className="text-[9px] font-mono text-[#4B5563] capitalize">{dbUser.role}</div>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-md hover:bg-[#FEE2E2] text-[#B91C1C]"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex print:block print:h-auto">
        {/* workbook rail */}
        {railOpen && (
          <nav className="w-[132px] shrink-0 border-r border-[#E5E7EB] bg-white overflow-y-auto py-2 print:hidden">
            {visibleWorkbooks.map((wb) => {
              const Icon = wb.icon;
              const on = wb.id === activeWb?.id;
              return (
                <button
                  key={wb.id}
                  onClick={() => go(wb.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold border-l-2 ${
                    on
                      ? "border-[#24539B] bg-[#E9EEF5]"
                      : "border-transparent text-[#4B5563] hover:bg-[#F4F6FA]"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{wb.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* sheet content */}
        <main className="flex-1 min-w-0 min-h-0 bg-[#F8FBF9] overflow-hidden print:h-auto print:overflow-visible print:block">
          {activeSheet ? (
            renderSheet(activeSheet)
          ) : (
            <div className="p-6 text-sm text-[#6B7280]">No sheet available for your role.</div>
          )}
        </main>
      </div>

      {/* bottom sheet tabs (Excel style) */}
      {activeWb && (
        <div className="h-9 shrink-0 border-t border-[#E5E7EB] bg-[#F3F7F4] flex items-stretch overflow-x-auto scrollbar-none print:hidden">
          {activeWb.sheets.map((s) => {
            const on = s.id === activeSheet?.id;
            return (
              <button
                key={s.id}
                onClick={() => { setNav((n) => ({ ...n, sheet: s.id })); setFocus(null); }}
                className={`px-3 text-[11px] font-medium whitespace-nowrap border-r border-[#E5E7EB] -mt-px ${
                  on
                    ? "bg-white border-t-2 border-t-[#24539B] font-semibold"
                    : "bg-[#EEF1F6] text-[#4B5563] hover:bg-[#F4F6FA]"
                }`}
              >
                {s.label}
                {s.kind === "entity" && <span className="ml-1 text-[#24539B]">▦</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* alerts drawer */}
      {alertsOpen && (
        <div className="fixed inset-0 z-[60] flex" onMouseDown={() => setAlertsOpen(false)}>
          <div className="flex-1 bg-black/20" />
          <div
            className="w-[460px] max-w-[94vw] bg-white h-full shadow-2xl border-l border-[#E5E7EB] flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-12 border-b border-[#E5E7EB] bg-[#DC2626]">
              <span className="font-bold text-white flex items-center gap-2">
                <Bell className="w-4 h-4" style={{ color: "#fff", stroke: "#fff" }} /> Alerts
              </span>
              <button onClick={() => setAlertsOpen(false)}>
                <X className="w-4 h-4" style={{ color: "#fff", stroke: "#fff" }} />
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
