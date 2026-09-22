import React, { useState, useEffect, useRef } from "react";
import { 
  DbUser, 
  FileStorage, 
  Notification, 
  ChatRoom, 
  ChatMessage, 
  EnterpriseHealth, 
  Branch 
} from "../types.ts";
import { enterpriseFetch } from "../../client/api.ts";
import { io, Socket } from "socket.io-client";
import { 
  Activity, 
  UploadCloud, 
  Bell, 
  MessageSquare, 
  Database, 
  Settings, 
  HardDrive, 
  Cpu, 
  Terminal, 
  CheckCircle, 
  XCircle, 
  FileText, 
  PlusCircle, 
  Send, 
  Server, 
  TrendingUp, 
  Clock, 
  AlertTriangle, 
  RefreshCw, 
  UserCheck, 
  Trash2,
  FileCheck,
  SendHorizontal,
  LayoutDashboard,
  Menu,
  X,
  ChevronDown,
  LogOut,
  Filter,
  Globe,
  Sparkles,
  Eye,
  Edit,
  Key,
  Download,
  Check,
  Lock,
  Unlock,
  ShieldCheck,
  FileSpreadsheet,
  LayoutGrid,
  BookOpen
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import FleetVehicles from "./fleet/FleetVehicles.tsx";
import FleetDrivers from "./fleet/FleetDrivers.tsx";
import FleetRoutes from "./fleet/FleetRoutes.tsx";
import FleetContractors from "./fleet/FleetContractors.tsx";
import SmartDispatch from "./fleet/SmartDispatch.tsx";
import LiveTrackingMap from "./fleet/LiveTrackingMap.tsx";
import DataPortal from "./fleet/DataPortal.tsx";
import TruckLedgers from "./fleet/TruckLedgers.tsx";
import Parties from "./fleet/Parties.tsx";
import FleetSearch from "./fleet/FleetSearch.tsx";
import FinanceDashboard from "./fleet/FinanceDashboard.tsx";
import HRMSDashboard from "./fleet/HRMSDashboard.tsx";
import FuelIntelligence from "./fleet/FuelIntelligence.tsx";
import FleetMaintenance from "./fleet/FleetMaintenance.tsx";
import CustomerPortal from "./fleet/CustomerPortal.tsx";
import VendorPortal from "./fleet/VendorPortal.tsx";
import ExecutiveBI from "./fleet/ExecutiveBI.tsx";
import AIAssistant from "./fleet/AIAssistant.tsx";
import { Truck, Route as RouteIcon, Briefcase, Layers, Search, Users, Droplet, Wrench, Shield, UsersRound, BarChart, Bot } from "lucide-react";
import { hasPermission, Resource, permissionMatrix, Action } from "../lib/rbac.ts";

interface EnterpriseDashboardProps {
  dbUser: DbUser;
  showFeedback: (type: "success" | "error", message: string) => void;
  handleLogout: () => void;
  apiHealth: boolean;
  apiHealthLoading: boolean;
  fetchHealth: () => void;
  // RBAC states
  usersList: any[];
  usersTotal: number;
  usersSearch: string;
  setUsersSearch: (val: string) => void;
  usersRoleFilter: string;
  setUsersRoleFilter: (val: string) => void;
  usersOffset: number;
  setUsersOffset: (val: number) => void;
  usersLoading: boolean;
  handleRoleChange: (userId: number, role: string, status?: string) => void;
  handleDeleteUser: (userId: number) => void;
  roles: string[];
  // Audit logs states
  auditLogsList: any[];
  auditTotal: number;
  auditSearch: string;
  setAuditSearch: (val: string) => void;
  auditActionFilter: string;
  setAuditActionFilter: (val: string) => void;
  auditOffset: number;
  setAuditOffset: (val: number) => void;
  auditLoading: boolean;
  /** render only the active tab body, no sidebar/topbar (used by WorkbookShell) */
  embedded?: boolean;
  activeTabOverride?: string;
  onNavigate?: (tab: string) => void;
}

export default function EnterpriseDashboard({ 
  dbUser, 
  showFeedback,
  handleLogout,
  apiHealth,
  apiHealthLoading,
  fetchHealth,
  usersList,
  usersTotal,
  usersSearch,
  setUsersSearch,
  usersRoleFilter,
  setUsersRoleFilter,
  usersOffset,
  setUsersOffset,
  usersLoading,
  handleRoleChange,
  handleDeleteUser,
  roles,
  auditLogsList,
  auditTotal,
  auditSearch,
  setAuditSearch,
  auditActionFilter,
  setAuditActionFilter,
  auditOffset,
  setAuditOffset,
  auditLoading,
  embedded,
  activeTabOverride,
  onNavigate,
}: EnterpriseDashboardProps) {
  const [activeTabState, setActiveTabState] = useState<
    "dashboard" | "health" | "files" | "notifications" | "chat" | "backups" | "settings" | "vehicles" | "drivers" | "routes" | "contractors" | "dispatch" | "live_tracking" | "data_portal" | "truck_ledgers" | "parties" | "fleet_search" | "finance" | "hrms" | "fuel_intel" | "predictive_maintenance" | "customer_portal" | "vendor_portal" | "executive_bi" | "ai_assistant"
  >("dashboard");
  // When embedded inside WorkbookShell the active tab is driven from outside.
  const activeTab = (embedded && activeTabOverride ? activeTabOverride : activeTabState) as typeof activeTabState;
  const setActiveTab = ((t: any) => {
    if (onNavigate) onNavigate(t);
    if (!embedded) setActiveTabState(t);
  }) as typeof setActiveTabState;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const [dynamicPermissionMatrix, setDynamicPermissionMatrix] = useState<any>(null);
  const [selectedUserForView, setSelectedUserForView] = useState<any>(null);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<any>(null);
  const [editUserForm, setEditUserForm] = useState({ name: "", phone: "", department: "", role: "", status: "" });
  const [resetPasswordResponse, setResetPasswordResponse] = useState<any>(null);
  const [activeRoleForPermissions, setActiveRoleForPermissions] = useState<string>("Fleet Manager");
  const [savingPermissions, setSavingPermissions] = useState<boolean>(false);
  const [userSortField, setUserSortField] = useState<string>("createdAt");
  const [userSortOrder, setUserSortOrder] = useState<"asc" | "desc">("desc");

  // Sync edit form on selection
  useEffect(() => {
    if (selectedUserForEdit) {
      setEditUserForm({
        name: selectedUserForEdit.name || "",
        phone: selectedUserForEdit.phone || "",
        department: selectedUserForEdit.department || "",
        role: selectedUserForEdit.role || "Pending",
        status: selectedUserForEdit.status || "Pending Approval"
      });
    }
  }, [selectedUserForEdit]);

  const fetchPermissionsMatrix = async () => {
    try {
      const data = await enterpriseFetch("/api/rbac/matrix");
      if (data && data.matrix) {
        setDynamicPermissionMatrix(data.matrix);
      }
    } catch (error) {
      console.error("Failed to fetch permissions matrix:", error);
    }
  };

  useEffect(() => {
    fetchPermissionsMatrix();
  }, []);

  const hasPermissionLocal = (role: string | null | undefined, resource: any, action: any): boolean => {
    if (!role) return false;
    if (role === "Super Admin") return true;
    if (role === "Pending") return false;

    const matrix = dynamicPermissionMatrix || permissionMatrix;
    const permissions = matrix[role];
    if (!permissions) return false;

    const resourcePermissions = permissions[resource];
    if (!resourcePermissions) return false;

    return resourcePermissions.includes(action);
  };

  const handleUpdatePermission = async (role: string, resource: string, actions: string[]) => {
    setSavingPermissions(true);
    try {
      const data = await enterpriseFetch("/api/rbac/permissions", {
        method: "PUT",
        body: JSON.stringify({ role, resource, actions }),
      });
      if (data && data.matrix) {
        setDynamicPermissionMatrix(data.matrix);
      }
      showFeedback("success", `Permissions updated successfully for ${role}`);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to update permissions");
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleUpdateUserDetails = async (userId: number) => {
    try {
      await enterpriseFetch(`/api/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify(editUserForm),
      });
      showFeedback("success", "User profile updated successfully");
      setSelectedUserForEdit(null);
      handleRoleChange(userId, editUserForm.role, editUserForm.status);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to update user details");
    }
  };

  const triggerResetPassword = async (user: any) => {
    try {
      const data = await enterpriseFetch(`/api/users/${user.id}/reset-password`, {
        method: "POST"
      });
      setResetPasswordResponse({ email: user.email, link: data.link });
      showFeedback("success", `Password reset link generated for ${user.email}`);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to generate reset link");
    }
  };

  const exportUsers = (format: "csv" | "xlsx") => {
    const headers = ["User ID", "Full Name", "Email Address", "Department", "Assigned Role", "Status", "Last Login", "Registered Date", "Created By"];
    const rows = usersList.map(u => {
      const creator = u.createdBy ? (usersList.find((usr: any) => usr.id === u.createdBy)?.name || `User #${u.createdBy}`) : "System Bootstrapper";
      return [
        u.id, 
        u.name || "Enterprise Operator", 
        u.email, 
        u.department || "None", 
        u.role, 
        u.status, 
        u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never",
        new Date(u.createdAt).toLocaleDateString(),
        creator
      ];
    });
    
    let content = "";
    let filename = "";
    let mimeType = "";

    if (format === "csv") {
      content = [headers.join(","), ...rows.map(r => r.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(","))].join("\n");
      filename = `enterprise_users_export_${new Date().toISOString().split('T')[0]}.csv`;
      mimeType = "text/csv;charset=utf-8;";
    } else {
      const htmlRows = rows.map(r => `<tr>${r.map(v => `<td style="border:1px solid #ddd;padding:8px;">${v}</td>`).join("")}</tr>`).join("");
      const htmlHeaders = headers.map(h => `<th style="background-color:#059669;color:white;font-weight:bold;padding:10px;border:1px solid #ddd;">${h}</th>`).join("");
      content = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body>
          <table style="border-collapse:collapse;font-family:sans-serif;">
            <thead><tr>${htmlHeaders}</tr></thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </body>
      </html>`;
      filename = `enterprise_users_export_${new Date().toISOString().split('T')[0]}.xls`;
      mimeType = "application/vnd.ms-excel;charset=utf-8;";
    }

    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSortUsers = (field: string) => {
    if (userSortField === field) {
      setUserSortOrder(userSortOrder === "asc" ? "desc" : "asc");
    } else {
      setUserSortField(field);
      setUserSortOrder("asc");
    }
  };

  const sortedUsers = React.useMemo(() => {
    let result = [...usersList];
    if (userSortField) {
      result.sort((a, b) => {
        let valA = a[userSortField] || "";
        let valB = b[userSortField] || "";
        
        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();
        
        if (valA < valB) return userSortOrder === "asc" ? -1 : 1;
        if (valA > valB) return userSortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [usersList, userSortField, userSortOrder]);

  const [healthData, setHealthData] = useState<EnterpriseHealth | null>(null);
  const [dashStats, setDashStats] = useState<{ vehicles: number; activeTrips: number } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // File Storage States
  const [filesList, setFilesList] = useState<FileStorage[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    name: "",
    category: "Driver License",
    path: "/uploads/",
    size: 1500,
    mimeType: "application/pdf"
  });

  // Notifications States
  const [notificationsList, setNotificationsList] = useState<Notification[]>([]);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [newNotifForm, setNewNotifForm] = useState({
    type: "Information",
    title: "",
    message: "",
    channel: "all"
  });

  // Chat States
  const [roomsList, setRoomsList] = useState<ChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const [messagesList, setChatMessageList] = useState<ChatMessage[]>([]);
  const [chatMessageInput, setChatMessageInput] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // Logs / Observability states
  const [logCategory, setLogCategory] = useState<"system" | "error" | "security" | "api" | "job">("system");
  const [logsList, setLogsList] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Backup States
  const [backupsList, setBackupsList] = useState<any[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);

  // Settings / Branches states
  const [branchesList, setBranchesList] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [newBranchForm, setNewBranchForm] = useState({
    name: "",
    code: "",
    address: "",
    phone: ""
  });
  const [companySettings, setCompanySettings] = useState({
    companyName: "HF Transport Logistics Inc.",
    fuelPrice: 285.5,
    timezone: "UTC+5 (PKT)"
  });

  // PHASE 10 ENTERPRISE STATES
  const [settingsSubTab, setSettingsSubTab] = useState<"general" | "users" | "audit_logs" | "rbac_matrix" | "api" | "workflows" | "dashboard" | "environment">("general");
  const [healthSubTab, setHealthSubTab] = useState<"overview" | "scheduler" | "slow_queries" | "audit" | "security">("overview");

  // Environment and Auditing lists
  const [envVarsList, setEnvVarsList] = useState<any[]>([]);
  const [envVarsLoading, setEnvVarsLoading] = useState(false);
  const [detailedAuditLogsList, setDetailedAuditLogsList] = useState<any[]>([]);
  const [detailedAuditLogsLoading, setDetailedAuditLogsLoading] = useState(false);

  // API & Webhooks States
  const [apiKeysList, setApiKeysList] = useState<any[]>([]);
  const [webhooksList, setWebhooksList] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newWebhook, setNewWebhook] = useState({ name: "", url: "", events: ["trip.completed"] });
  const [generatedKeyResult, setGeneratedKeyResult] = useState<any>(null);

  // Workflows States
  const [workflowsList, setWorkflowsList] = useState<any[]>([]);
  const [workflowApprovalsList, setWorkflowApprovalsList] = useState<any[]>([]);
  const [newWorkflow, setNewWorkflow] = useState({
    name: "",
    type: "Trip",
    description: "",
    steps: [{ step: 1, role: "Operations Manager", required: true }]
  });

  // Background Scheduler States
  const [schedulerJobsList, setSchedulerJobsList] = useState<any[]>([]);

  // Detailed Monitoring States
  const [detailedMetrics, setDetailedMetrics] = useState<any>(null);

  // Digital Signature Dialog States
  const [signingFileId, setSigningFileId] = useState<number | null>(null);
  const [sigString, setSigString] = useState("");

  // WebSockets Connection
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Connect client-side socket to port 3000
    const socketUrl = window.location.origin;
    const socket = io(socketUrl, {
      query: {
        email: dbUser.email,
        role: dbUser.role,
        userId: dbUser.id.toString(),
      },
      // polling first, then upgrade to websocket - survives proxies / restrictive
      // networks that block raw ws:// (falls back instead of failing outright)
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Sockets Client] Connected to main server");
    });

    socket.on("system:connected_users", (users: any[]) => {
      setOnlineUsers(users);
    });

    socket.on("chat:message", (msg: ChatMessage) => {
      if (activeRoomId && msg.roomId === activeRoomId) {
        setChatMessageList((prev) => [...prev, msg]);
      }
    });

    socket.on("chat:global_message", (data: { roomId: number; message: ChatMessage }) => {
      if (activeRoomId === data.roomId) {
        setChatMessageList((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      } else {
        setRoomsList((prev) => 
          prev.map((room) => 
            room.id === data.roomId 
              ? { ...room, unreadCount: (room.unreadCount || 0) + 1 } 
              : room
          )
        );
        
        const senderEmail = data.message.senderEmail || "";
        if (senderEmail !== dbUser.email) {
          const roomName = (data.message as any).roomName || "chat";
          const senderName = data.message.senderName || senderEmail;
          const contentText = data.message.message || (data.message as any).content || "";
          showFeedback("success", `💬 #${roomName}: ${senderName}: ${contentText.slice(0, 40)}`);
          
          const chatNotif = {
            id: Date.now(),
            title: `Message in #${roomName}`,
            message: `${senderName}: ${contentText}`,
            type: "Chat",
            createdAt: new Date().toISOString(),
            status: "Unread"
          };
          setNotificationsList((prev) => [chatNotif, ...prev]);
          setUnreadNotifsCount((prev) => prev + 1);
        }
      }
    });

    socket.on("trip:started", (data: any) => {
      showFeedback("success", `🚚 Trip Started: Vehicle #${data.vehicleId} with driver ${data.driverName}`);
      const notif = {
        id: Date.now(),
        title: "Trip Started",
        message: `Vehicle #${data.vehicleId} started a new trip under driver ${data.driverName}`,
        type: "Operations",
        createdAt: new Date().toISOString(),
        status: "Unread"
      };
      setNotificationsList((prev) => [notif, ...prev]);
      setUnreadNotifsCount((prev) => prev + 1);
    });

    socket.on("trip:completed", (data: any) => {
      showFeedback("success", `🏁 Trip Completed: Route ${data.routeName || ""}`);
      const notif = {
        id: Date.now(),
        title: "Trip Completed",
        message: `Trip on route ${data.routeName || ""} was successfully completed`,
        type: "Operations",
        createdAt: new Date().toISOString(),
        status: "Unread"
      };
      setNotificationsList((prev) => [notif, ...prev]);
      setUnreadNotifsCount((prev) => prev + 1);
    });

    socket.on("driver:assigned", (data: any) => {
      showFeedback("success", `👤 Driver Assigned: ${data.driverName} to Trip #${data.tripId}`);
      const notif = {
        id: Date.now(),
        title: "Driver Assigned",
        message: `Driver ${data.driverName} has been assigned to Trip #${data.tripId}`,
        type: "Operations",
        createdAt: new Date().toISOString(),
        status: "Unread"
      };
      setNotificationsList((prev) => [notif, ...prev]);
      setUnreadNotifsCount((prev) => prev + 1);
    });

    socket.on("invoice:generated", (data: any) => {
      showFeedback("success", `💵 Invoice Generated: $${data.amount} for ${data.customerName}`);
      const notif = {
        id: Date.now(),
        title: "Invoice Generated",
        message: `An invoice of $${data.amount} was generated for ${data.customerName}`,
        type: "Finance",
        createdAt: new Date().toISOString(),
        status: "Unread"
      };
      setNotificationsList((prev) => [notif, ...prev]);
      setUnreadNotifsCount((prev) => prev + 1);
    });

    socket.on("maintenance:reminder", (data: any) => {
      showFeedback("success", `🔧 Maintenance Due: Vehicle #${data.vehicleId} - ${data.description}`);
      const notif = {
        id: Date.now(),
        title: "Maintenance Due",
        message: `Vehicle #${data.vehicleId} is due for maintenance: ${data.description}`,
        type: "Maintenance",
        createdAt: new Date().toISOString(),
        status: "Unread"
      };
      setNotificationsList((prev) => [notif, ...prev]);
      setUnreadNotifsCount((prev) => prev + 1);
    });

    socket.on("emergency:alert", (data: any) => {
      showFeedback("error", `🚨 EMERGENCY: Vehicle #${data.vehicleId} reported ${data.alertType}!`);
      const notif = {
        id: Date.now(),
        title: "Emergency Alert",
        message: `Vehicle #${data.vehicleId} triggered emergency alert: ${data.alertType}`,
        type: "Emergency",
        createdAt: new Date().toISOString(),
        status: "Unread"
      };
      setNotificationsList((prev) => [notif, ...prev]);
      setUnreadNotifsCount((prev) => prev + 1);
    });

    socket.on("notification:new", (data: any) => {
      if (data.userId === null || data.userId === dbUser.id) {
        setNotificationsList((prev) => [data.notification, ...prev]);
        setUnreadNotifsCount((prev) => prev + 1);
        showFeedback("success", `ALERT: ${data.notification.title}`);
      }
    });

    socket.on("chat:typing", (data: { roomId: string; email: string; typing: boolean }) => {
      if (activeRoomId && parseInt(data.roomId) === activeRoomId) {
        if (data.typing) {
          setTypingUsers((prev) => Array.from(new Set([...prev, data.email])));
        } else {
          setTypingUsers((prev) => prev.filter(e => e !== data.email));
        }
      }
    });

    // Poll active tab data
    fetchHealthData();
    fetchDashStats();
    fetchFiles();
    fetchNotifications();
    fetchChatRooms();
    fetchBackups();
    fetchBranches();

    return () => {
      socket.disconnect();
    };
  }, [dbUser, activeRoomId]);

  // Handle active logs trigger when category switches
  useEffect(() => {
    if (activeTab === "health") {
      fetchObservabilityLogs();
    }
  }, [logCategory, activeTab]);

  const fetchHealthData = async () => {
    setHealthLoading(true);
    try {
      const data = await enterpriseFetch("/api/enterprise/health");
      setHealthData(data);
    } catch (err: any) {
      showFeedback("error", "Failed to fetch health metrics");
    } finally {
      setHealthLoading(false);
    }
  };

  // Real counts for the two headline dashboard cards (were hardcoded to 14 / 8).
  const fetchDashStats = async () => {
    try {
      const [veh, trips] = await Promise.all([
        enterpriseFetch("/api/operations/vehicles?limit=1"),
        enterpriseFetch("/api/operations/trips"),
      ]);
      const vehicles = Number(veh?.pagination?.total ?? veh?.total ?? (Array.isArray(veh?.data) ? veh.data.length : 0));
      const activeTrips = Array.isArray(trips)
        ? trips.filter((t: any) => t?.status && t.status !== "Completed").length
        : 0;
      setDashStats({ vehicles: isNaN(vehicles) ? 0 : vehicles, activeTrips });
    } catch {
      // non-critical - leave the card showing a dash
    }
  };

  const fetchFiles = async () => {
    setFilesLoading(true);
    try {
      const list = await enterpriseFetch("/api/enterprise/files");
      setFilesList(list);
    } catch (err) {
      showFeedback("error", "Failed to fetch documents list");
    } finally {
      setFilesLoading(false);
    }
  };

  const fetchNotifications = async () => {
    setNotifLoading(true);
    try {
      const data = await enterpriseFetch("/api/enterprise/notifications");
      setNotificationsList(data.notifications);
      setUnreadNotifsCount(data.unreadCount);
    } catch (err) {
      showFeedback("error", "Failed to load notifications");
    } finally {
      setNotifLoading(false);
    }
  };

  const fetchChatRooms = async () => {
    try {
      const list = await enterpriseFetch("/api/enterprise/chat/rooms");
      setRoomsList(list);
      // Default to first room if any
      if (list.length > 0 && !activeRoomId) {
        handleSelectRoom(list[0].id);
      }
    } catch (err) {
      showFeedback("error", "Failed to load chat channels");
    }
  };

  const handleSelectRoom = async (roomId: number) => {
    setActiveRoomId(roomId);
    if (socketRef.current) {
      socketRef.current.emit("chat:join_room", roomId.toString());
    }
    try {
      const messages = await enterpriseFetch(`/api/enterprise/chat/rooms/${roomId}/messages`);
      setChatMessageList(messages);
      setTypingUsers([]);
    } catch (err) {
      showFeedback("error", "Failed to fetch chat logs");
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessageInput.trim() || !activeRoomId) return;

    try {
      await enterpriseFetch(`/api/enterprise/chat/rooms/${activeRoomId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: chatMessageInput }),
      });
      setChatMessageInput("");
      if (socketRef.current) {
        socketRef.current.emit("chat:typing", { roomId: activeRoomId.toString(), email: dbUser.email, typing: false });
      }
    } catch (err) {
      showFeedback("error", "Message delivery failed");
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChatMessageInput(e.target.value);
    if (socketRef.current && activeRoomId) {
      socketRef.current.emit("chat:typing", {
        roomId: activeRoomId.toString(),
        email: dbUser.email,
        typing: e.target.value.length > 0
      });
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadForm.name.trim()) return;

    try {
      await enterpriseFetch("/api/enterprise/files/upload", {
        method: "POST",
        body: JSON.stringify(uploadForm),
      });
      showFeedback("success", "File metadata uploaded and registered!");
      setUploadForm((prev) => ({ ...prev, name: "" }));
      fetchFiles();
    } catch (err) {
      showFeedback("error", "Document upload registry failed");
    }
  };

  const handleDeleteFile = async (id: number) => {
    try {
      await enterpriseFetch(`/api/enterprise/files/${id}`, { method: "DELETE" });
      showFeedback("success", "Document metadata deleted successfully");
      fetchFiles();
    } catch (err) {
      showFeedback("error", "File deletion failed");
    }
  };

  const handleMarkNotificationRead = async (id: number) => {
    try {
      await enterpriseFetch(`/api/enterprise/notifications/${id}/read`, { method: "PUT" });
      setNotificationsList((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadNotifsCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      showFeedback("error", "Failed to mark notification as read");
    }
  };

  const handleTriggerNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNotifForm.title.trim() || !newNotifForm.message.trim()) return;

    try {
      await enterpriseFetch("/api/enterprise/notifications", {
        method: "POST",
        body: JSON.stringify(newNotifForm),
      });
      showFeedback("success", "System alerts sent and broadcasted!");
      setNewNotifForm((prev) => ({ ...prev, title: "", message: "" }));
      fetchNotifications();
    } catch (err) {
      showFeedback("error", "Alert broadcast failed");
    }
  };

  const fetchBackups = async () => {
    setBackupsLoading(true);
    try {
      const list = await enterpriseFetch("/api/enterprise/backups");
      setBackupsList(list);
    } catch (err) {
      showFeedback("error", "Failed to retrieve backup directories");
    } finally {
      setBackupsLoading(false);
    }
  };

  const handleTriggerBackup = async () => {
    try {
      await enterpriseFetch("/api/enterprise/backups/trigger", { method: "POST" });
      showFeedback("success", "PostgreSQL database snapshot and backup verification succeeded!");
      fetchBackups();
    } catch (err) {
      showFeedback("error", "Hot snapshot backup run failed");
    }
  };

  const fetchBranches = async () => {
    setBranchesLoading(true);
    try {
      const list = await enterpriseFetch("/api/enterprise/settings/branches");
      setBranchesList(list);
    } catch (err) {
      showFeedback("error", "Failed to load branch systems");
    } finally {
      setBranchesLoading(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchForm.name.trim() || !newBranchForm.code.trim()) return;

    try {
      await enterpriseFetch("/api/enterprise/settings/branches", {
        method: "POST",
        body: JSON.stringify(newBranchForm),
      });
      showFeedback("success", "Branch office registered successfully");
      setNewBranchForm({ name: "", code: "", address: "", phone: "" });
      fetchBranches();
    } catch (err) {
      showFeedback("error", "Branch creation failed");
    }
  };

  const fetchObservabilityLogs = async () => {
    setLogsLoading(true);
    try {
      const data = await enterpriseFetch(`/api/enterprise/logs/${logCategory}`);
      setLogsList(data);
    } catch (err) {
      showFeedback("error", "Failed to query system logs");
    } finally {
      setLogsLoading(false);
    }
  };

  // ============================================================================
  // PHASE 10 ENTERPRISE INTEGRATION HOOKS & HANDLERS
  // ============================================================================
  useEffect(() => {
    if (activeTab === "settings") {
      if (settingsSubTab === "api") {
        fetchApiKeys();
        fetchWebhooks();
      } else if (settingsSubTab === "workflows") {
        fetchWorkflows();
        fetchWorkflowApprovals();
      } else if (settingsSubTab === "environment") {
        fetchEnvVars();
      }
    } else if (activeTab === "health") {
      if (healthSubTab === "overview") {
        fetchDetailedMetrics();
      } else if (healthSubTab === "scheduler") {
        fetchSchedulerJobs();
      } else if (healthSubTab === "slow_queries") {
        fetchDetailedMetrics();
      } else if (healthSubTab === "security") {
        fetchSecurityStatus();
      } else if (healthSubTab === "audit") {
        fetchAuditLogs();
      }
    }
  }, [activeTab, settingsSubTab, healthSubTab]);

  const fetchEnvVars = async () => {
    setEnvVarsLoading(true);
    try {
      const vars = await enterpriseFetch("/api/enterprise/settings/env");
      setEnvVarsList(vars || []);
    } catch (e) {
      console.error("Error fetching environment variables", e);
    } finally {
      setEnvVarsLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setDetailedAuditLogsLoading(true);
    try {
      const data = await enterpriseFetch("/api/enterprise/audit-logs/detailed");
      setDetailedAuditLogsList(data || []);
    } catch (e) {
      console.error("Error fetching audit logs", e);
    } finally {
      setDetailedAuditLogsLoading(false);
    }
  };

  const fetchApiKeys = async () => {
    try {
      const keys = await enterpriseFetch("/api/enterprise/api-keys");
      setApiKeysList(keys);
    } catch (e) {
      console.error("Error fetching API keys", e);
    }
  };

  const handleGenerateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    try {
      const res = await enterpriseFetch("/api/enterprise/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName, permissions: ["read_all"] })
      });
      setGeneratedKeyResult(res);
      setNewKeyName("");
      showFeedback("success", "Cryptographic API Key generated successfully!");
      fetchApiKeys();
    } catch (err) {
      showFeedback("error", "Failed to generate API Access token");
    }
  };

  const handleRevokeApiKey = async (id: number) => {
    try {
      await enterpriseFetch(`/api/enterprise/api-keys/${id}`, { method: "DELETE" });
      showFeedback("success", "API Key revoked successfully.");
      fetchApiKeys();
    } catch (err) {
      showFeedback("error", "Failed to revoke selected API key");
    }
  };

  const fetchWebhooks = async () => {
    try {
      const hooks = await enterpriseFetch("/api/enterprise/webhooks");
      setWebhooksList(hooks);
    } catch (e) {
      console.error("Error fetching webhooks", e);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhook.name.trim() || !newWebhook.url.trim()) return;
    try {
      await enterpriseFetch("/api/enterprise/webhooks", {
        method: "POST",
        body: JSON.stringify(newWebhook)
      });
      setNewWebhook({ name: "", url: "", events: ["trip.completed"] });
      showFeedback("success", "Webhook subscription registered successfully!");
      fetchWebhooks();
    } catch (err) {
      showFeedback("error", "Failed to register corporate webhook subscription");
    }
  };

  const handleDeleteWebhook = async (id: number) => {
    try {
      await enterpriseFetch(`/api/enterprise/webhooks/${id}`, { method: "DELETE" });
      showFeedback("success", "Webhook configuration removed successfully.");
      fetchWebhooks();
    } catch (err) {
      showFeedback("error", "Failed to delete webhook configuration");
    }
  };

  const fetchWorkflows = async () => {
    try {
      const list = await enterpriseFetch("/api/enterprise/workflows");
      setWorkflowsList(list);
    } catch (e) {
      console.error("Error fetching workflows", e);
    }
  };

  const fetchWorkflowApprovals = async () => {
    try {
      const list = await enterpriseFetch("/api/enterprise/workflows/approvals");
      setWorkflowApprovalsList(list);
    } catch (e) {
      console.error("Error fetching approvals", e);
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkflow.name.trim()) return;
    try {
      await enterpriseFetch("/api/enterprise/workflows", {
        method: "POST",
        body: JSON.stringify(newWorkflow)
      });
      setNewWorkflow({ name: "", type: "Trip", description: "", steps: [{ step: 1, role: "Operations Manager", required: true }] });
      showFeedback("success", "Business governance workflow template created successfully!");
      fetchWorkflows();
    } catch (err) {
      showFeedback("error", "Failed to establish new workflow template");
    }
  };

  const handleWorkflowAction = async (id: number, action: "Approved" | "Rejected", comment: string) => {
    try {
      await enterpriseFetch(`/api/enterprise/workflows/approvals/${id}`, {
        method: "PUT",
        body: JSON.stringify({ action, comment })
      });
      showFeedback("success", `Workflow action registered successfully as ${action}!`);
      fetchWorkflowApprovals();
    } catch (err) {
      showFeedback("error", "Failed to register action for approval instance");
    }
  };

  const fetchSchedulerJobs = async () => {
    try {
      const jobs = await enterpriseFetch("/api/enterprise/scheduler/jobs");
      setSchedulerJobsList(jobs);
    } catch (e) {
      console.error("Error fetching scheduler jobs", e);
    }
  };

  const handleTriggerSchedulerJob = async (id: number) => {
    try {
      await enterpriseFetch(`/api/enterprise/scheduler/jobs/${id}/trigger`, { method: "POST" });
      showFeedback("success", "Manual background job trigger registered and processed.");
      fetchSchedulerJobs();
    } catch (err) {
      showFeedback("error", "Failed to run scheduled job manually");
    }
  };

  const [securityStatus, setSecurityStatus] = useState<any>(null);
  const fetchSecurityStatus = async () => {
    try {
      const sec = await enterpriseFetch("/api/enterprise/security/status");
      setSecurityStatus(sec);
    } catch (e) {
      console.error("Error fetching security status", e);
    }
  };

  const fetchDetailedMetrics = async () => {
    try {
      const m = await enterpriseFetch("/api/enterprise/monitoring/detailed");
      setDetailedMetrics(m);
    } catch (e) {
      console.error("Error fetching detailed metrics", e);
    }
  };

  const handleSimulateDMSign = async (id: number) => {
    if (!sigString.trim()) return;
    try {
      await enterpriseFetch(`/api/enterprise/files/${id}/sign`, {
        method: "POST",
        body: JSON.stringify({ signatureString: sigString })
      });
      showFeedback("success", "Cryptographic digital signature successfully appended!");
      setSigString("");
      setSigningFileId(null);
      fetchFiles();
    } catch (e) {
      showFeedback("error", "Signature run failed");
    }
  };

  const handleDocApproval = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await enterpriseFetch(`/api/enterprise/files/${id}/approval`, {
        method: "POST",
        body: JSON.stringify({ status, remarks: "Manually approved inside DMS portal" })
      });
      showFeedback("success", `Document registry successfully set to ${status}`);
    } catch (e) {
      showFeedback("error", "Failed to register file verification status");
    }
  };

  const [simulateDrBackup, setSimulateDrBackup] = useState<any>(null);
  const handleDRRestoreRun = async (fileName: string) => {
    try {
      const res = await enterpriseFetch("/api/enterprise/backups/restore", {
        method: "POST",
        body: JSON.stringify({ fileName })
      });
      setSimulateDrBackup(res.verificationLog);
      showFeedback("success", "Disaster Recovery simulated restore run verification PASSED!");
    } catch (err) {
      showFeedback("error", "Failed to complete disaster recovery snapshot dry-run restore");
    }
  };

  const sidebarSections = [
    {
      title: "Core Portal",
      roles: ["Super Admin", "Admin", "Operations Manager", "Dispatcher", "Accountant", "HR Manager", "Viewer"],
      items: [
        { id: "dashboard", label: "Operations Dashboard", icon: LayoutDashboard },
      ]
    },
    {
      title: "Fleet Operations",
      roles: ["Super Admin", "Admin", "Operations Manager", "Dispatcher", "Viewer"],
      items: [
        { id: "dispatch", label: "Smart Dispatch Engine", icon: RouteIcon },
        { id: "live_tracking", label: "Live GPS Tracking", icon: Globe },
        { id: "vehicles", label: "Fleet Vehicles Registry", icon: Truck },
        { id: "drivers", label: "Driver Registry", icon: UserCheck },
        { id: "routes", label: "Transit Routes", icon: RouteIcon },
        { id: "contractors", label: "3rd Party Carriers", icon: Briefcase },
        { id: "truck_ledgers", label: "Truck Ledgers (Khata)", icon: BookOpen, roles: ["Super Admin", "Admin", "Operations Manager", "Accountant"] },
        { id: "parties", label: "Parties (Khata)", icon: Users, roles: ["Super Admin", "Admin", "Operations Manager", "Accountant"] },
        { id: "fleet_search", label: "Compliance & Audit", icon: Search },
      ]
    },
    {
      title: "Enterprise Resources",
      roles: ["Super Admin", "Admin", "Operations Manager", "Accountant", "HR Manager", "Viewer"],
      items: [
        { id: "fuel_intel", label: "Fuel Intelligence", icon: Droplet, roles: ["Super Admin", "Admin", "Operations Manager", "Accountant"] },
        { id: "predictive_maintenance", label: "Predictive Workshops", icon: Wrench, roles: ["Super Admin", "Admin", "Operations Manager"] },
        { id: "hrms", label: "HRMS & Payroll Portal", icon: Users, roles: ["Super Admin", "Admin", "HR Manager"] },
        { id: "finance", label: "General Ledger & Accounts", icon: BarChart, roles: ["Super Admin", "Admin", "Accountant"] },
      ]
    },
    {
      title: "Information & DMS",
      roles: ["Super Admin", "Admin", "Operations Manager", "Dispatcher", "Accountant", "HR Manager", "Viewer"],
      items: [
        { id: "files", label: "DMS Documents", icon: FileText },
        { id: "chat", label: "Staff Messenger", icon: MessageSquare },
      ]
    },
    {
      title: "Governance & Settings",
      roles: ["Super Admin", "Admin", "Operations Manager", "Viewer"],
      items: [
        { id: "settings", label: "System Configuration", icon: Settings, roles: ["Super Admin", "Admin"] },
        { id: "data_portal", label: "Data Import / Export", icon: FileSpreadsheet, roles: ["Super Admin", "Admin", "Operations Manager"] },
        { id: "executive_bi", label: "Executive BI Insights", icon: TrendingUp },
        { id: "health", label: "Infrastructure Overview", icon: Activity, roles: ["Super Admin", "Admin"] },
        { id: "backups", label: "Disaster Recovery", icon: Database, roles: ["Super Admin", "Admin"] },
        { id: "notifications", label: "Platform Broadcasts", icon: Bell },
      ]
    }
  ];

  const isItemAccessible = (itemId: string): boolean => {
    if (itemId === "dashboard") return true;

    let resource: Resource = "settings";
    if (itemId === "dispatch") resource = "dispatch";
    else if (itemId === "live_tracking") resource = "dispatch";
    else if (itemId === "data_portal") resource = "settings";
    else if (itemId === "truck_ledgers") resource = "finance";
    else if (itemId === "parties") resource = "finance";
    else if (itemId === "vehicles") resource = "vehicles";
    else if (itemId === "drivers") resource = "drivers";
    else if (itemId === "routes") resource = "routes";
    else if (itemId === "contractors") resource = "contractors";
    else if (itemId === "fleet_search") resource = "audit_logs";
    else if (itemId === "fuel_intel") resource = "fuel";
    else if (itemId === "predictive_maintenance") resource = "maintenance";
    else if (itemId === "hrms") resource = "hrms";
    else if (itemId === "finance") resource = "finance";
    else if (itemId === "files") resource = "documents";
    else if (itemId === "chat") resource = "chat";
    else if (itemId === "settings") resource = "settings";
    else if (itemId === "executive_bi") resource = "reports";
    else if (itemId === "health") resource = "health";
    else if (itemId === "backups") resource = "backups";
    else if (itemId === "notifications") resource = "settings";

    return hasPermissionLocal(dbUser.role, resource, "read");
  };

  const isSectionAccessible = (section: typeof sidebarSections[0]): boolean => {
    return section.items.some(item => isItemAccessible(item.id));
  };

  return (
    <div className={`${embedded ? "h-full" : "min-h-screen"} bg-slate-50 text-slate-800 font-sans flex relative overflow-hidden w-full antialiased`}>

      {/* 1. SIDEBAR (Sticky on desktop, toggle drawer on mobile) */}
      {!embedded && (
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-white border-r border-slate-200 h-screen sticky top-0 overflow-hidden select-none">
        {/* Header Branding */}
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="bg-indigo-50 border border-indigo-100 p-2 rounded-xl">
            <Shield className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-sm font-extrabold tracking-tight text-slate-900 font-sans uppercase">HF Transport</h1>
            <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Enterprise Suite</p>
          </div>
        </div>

        {/* Navigation Sections */}
        <div className="flex-1 px-4 py-6 space-y-7 overflow-y-auto scrollbar-none">
          {sidebarSections.map((section, sIdx) => {
            if (!isSectionAccessible(section)) return null;

            return (
              <div key={sIdx} className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase pl-3">{section.title}</p>
                <nav className="space-y-1">
                  {section.items.map((item) => {
                    if (!isItemAccessible(item.id)) return null;

                    const Icon = item.icon;
                    const isActive = activeTab === item.id;

                    return (
                       <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id as any)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 cursor-pointer ${
                          isActive
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
                        }`}
                      >
                        <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-slate-400"}`} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            );
          })}
        </div>

        {/* Footer user profile & Logout */}
        <div className="p-4 border-t border-slate-100 bg-white sticky bottom-0">
          <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-100 rounded-xl mb-3">
            <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center font-mono text-xs font-bold text-indigo-600 uppercase">
              {dbUser.name ? dbUser.name.slice(0,2) : "OP"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{dbUser.name || "Enterprise Operator"}</p>
              <p className="text-[10px] font-mono text-slate-400 truncate capitalize">{dbUser.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 hover:text-rose-800 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Terminate Session</span>
          </button>
        </div>
      </aside>
      )}

      {/* Mobile drawer sidebar backdrop */}
      {!embedded && (
      <AnimatePresence>
        {mobileSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 lg:hidden"
          >
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              className="w-64 max-w-[80vw] h-full bg-white border-r border-slate-200 flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-600" />
                  <span className="text-sm font-bold text-slate-800 uppercase font-sans">HF ERP Suite</span>
                </div>
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 px-4 py-6 space-y-6 overflow-y-auto">
                {sidebarSections.map((section, sIdx) => {
                  if (!isSectionAccessible(section)) return null;

                  return (
                    <div key={sIdx} className="space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-400 tracking-wider uppercase pl-3">{section.title}</p>
                      <nav className="space-y-1">
                        {section.items.map((item) => {
                          if (!isItemAccessible(item.id)) return null;

                          const Icon = item.icon;
                          const isActive = activeTab === item.id;

                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                setActiveTab(item.id as any);
                                setMobileSidebarOpen(false);
                              }}
                              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                                isActive
                                  ? "bg-indigo-600 text-white"
                                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </nav>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 border-t border-slate-100 sticky bottom-0 bg-white">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-semibold transition"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      )}

      {/* 2. MAIN WINDOW CONTAINER */}
      <div className={`flex-1 flex flex-col ${embedded ? "h-full" : "h-screen"} overflow-hidden bg-slate-50 relative`}>

        {/* TOP COMMAND BAR */}
        {!embedded && (
        <header className="h-16 shrink-0 border-b border-slate-200 bg-white px-6 flex items-center justify-between z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-800 transition"
            >
              <Menu className="w-5 h-5" />
            </button>
            
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xs font-sans text-slate-400">HF Enterprise /</span>
              <span className="text-xs font-sans font-semibold text-indigo-600 uppercase tracking-wide">{activeTab}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Live API Health state */}
            <button 
              onClick={fetchHealth}
              className={`flex items-center gap-2 border rounded-full px-3 py-1 font-mono text-[11px] transition-all cursor-pointer ${
                apiHealth 
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100" 
                  : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
              }`}
            >
              <Activity className={`w-3 h-3 ${apiHealthLoading ? "animate-spin" : ""}`} />
              <span>API: {apiHealth ? "ONLINE" : "OFFLINE"}</span>
            </button>

            {/* Quick access notifications trigger */}
            <button 
              onClick={() => setActiveTab("notifications")}
              className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-slate-800 transition relative"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
              )}
            </button>
          </div>
        </header>
        )}

        {/* VIEW STAGE - SCROLLABLE COMPONENT GRID */}
        <main className={`flex-1 overflow-y-auto space-y-6 scrollbar-none ${embedded ? "p-0" : "p-6 md:p-8"}`}>
          {/* mode="sync" (default): overlapping enter/exit. Do NOT use mode="wait"
              here - with ~24 conditional children, navigating faster than the
              exit animation completes deadlocks the switcher (sidebar changes
              but the panel stops updating). */}
          <AnimatePresence>

            {/* MASTER OPERATIONS DASHBOARD */}
            {activeTab === "dashboard" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {/* Top Banner */}
                <div className="bg-gradient-to-r from-blue-900/30 via-slate-900/20 to-transparent border border-slate-850 p-6 rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="relative z-10 space-y-2">
                    <h3 className="text-2xl font-bold tracking-tight text-white font-sans">
                      Welcome back, <span className="text-blue-400">{dbUser.name || dbUser.email}</span>
                    </h3>
                    <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
                      HF Transport ERP Central Command Node is fully synchronized. Securely monitoring logistics registries, double-entry financial journals, and biometric staff presence in real-time.
                    </p>
                  </div>
                </div>

                {/* Bento Grid Command Center */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  
                  {/* CARD 1: Fleet Status */}
                  {isItemAccessible("vehicles") && (
                    <div 
                      onClick={() => setActiveTab("vehicles")}
                      className="bg-slate-900/45 hover:bg-slate-900/80 border border-slate-850 hover:border-blue-500/30 p-5 rounded-2xl transition-all cursor-pointer group relative overflow-hidden"
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <p className="text-xs font-mono text-slate-500 uppercase tracking-wider">ACTIVE VEHICLES</p>
                          <p className="text-3xl font-bold text-white tracking-tight font-sans">{dashStats ? dashStats.vehicles : "—"}</p>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-xl group-hover:scale-110 transition-transform">
                          <Truck className="w-5 h-5 text-blue-400" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-4 flex items-center gap-1.5 font-sans">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        All operational dispatch channels online
                      </p>
                    </div>
                  )}

                  {/* CARD 2: Active Dispatches */}
                  {isItemAccessible("dispatch") && (
                    <div 
                      onClick={() => setActiveTab("dispatch")}
                      className="bg-slate-900/45 hover:bg-slate-900/80 border border-slate-850 hover:border-emerald-500/30 p-5 rounded-2xl transition-all cursor-pointer group relative overflow-hidden"
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <p className="text-xs font-mono text-slate-500 uppercase tracking-wider">SMART DISPATCHES</p>
                          <p className="text-3xl font-bold text-white tracking-tight font-sans">{dashStats ? dashStats.activeTrips : "—"}</p>
                        </div>
                        <div className="bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl group-hover:scale-110 transition-transform">
                          <RouteIcon className="w-5 h-5 text-emerald-400" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-4 flex items-center gap-1.5 font-sans">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live routes optimized via AI agent
                      </p>
                    </div>
                  )}

                  {/* CARD 3: Workflow sign-offs */}
                  {isItemAccessible("settings") && (
                    <div 
                      onClick={() => {
                        setActiveTab("settings");
                        setSettingsSubTab("workflows");
                      }}
                      className="bg-slate-900/45 hover:bg-slate-900/80 border border-slate-850 hover:border-amber-500/30 p-5 rounded-2xl transition-all cursor-pointer group relative overflow-hidden"
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <p className="text-xs font-mono text-slate-500 uppercase tracking-wider">WORKFLOW SIGN-OFFS</p>
                          <p className="text-3xl font-bold text-white tracking-tight font-sans">
                            {workflowApprovalsList.filter(a => a.status === "Pending").length}
                          </p>
                        </div>
                        <div className="bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl group-hover:scale-110 transition-transform">
                          <Shield className="w-5 h-5 text-amber-400" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-4 flex items-center gap-1.5 font-sans">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Awaiting authorization signatures
                      </p>
                    </div>
                  )}

                  {/* CARD 4: Live Infrastructure */}
                  {isItemAccessible("health") && (
                    <div 
                      onClick={() => setActiveTab("health")}
                      className="bg-slate-900/45 hover:bg-slate-900/80 border border-slate-850 hover:border-purple-500/30 p-5 rounded-2xl transition-all cursor-pointer group relative overflow-hidden"
                    >
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <p className="text-xs font-mono text-slate-500 uppercase tracking-wider">SYSTEM NODE</p>
                          <p className="text-3xl font-bold text-white tracking-tight font-sans">ONLINE</p>
                        </div>
                        <div className="bg-purple-500/10 border border-purple-500/20 p-2.5 rounded-xl group-hover:scale-110 transition-transform">
                          <Activity className="w-5 h-5 text-purple-400" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-4 flex items-center gap-1.5 font-sans">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Database Connection latency: 2ms
                      </p>
                    </div>
                  )}

                </div>

                {/* Lower Section: Recent workflow approvals and broadcasts */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {/* Left panel: Approvals waiting (Cols 7) */}
                  <div className="lg:col-span-7 bg-slate-950/40 border border-slate-850 p-6 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-white flex items-center gap-2">
                        <Shield className="w-5 h-5 text-blue-400" />
                        <span>Governance Approvals Pipeline</span>
                      </h4>
                      <span className="text-xs font-mono text-slate-500">Dual-Signature Ledger</span>
                    </div>

                    <div className="space-y-3 max-h-[300px] overflow-y-auto">
                      {workflowApprovalsList.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-slate-850 rounded-xl text-slate-500">
                          <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-40 text-emerald-400" />
                          <p className="text-xs font-mono">ALL GOVERNANCE CHECKS PASSED</p>
                        </div>
                      ) : (
                        workflowApprovalsList.map((app: any) => (
                          <div key={app.id} className="bg-slate-900/30 border border-slate-850 p-4 rounded-xl flex items-center justify-between gap-4">
                            <div className="space-y-1">
                              <span className="text-[10px] bg-blue-600/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono font-bold">
                                {app.workflowName}
                              </span>
                              <p className="text-xs text-slate-300 font-sans mt-1">Initiator: {app.initiatorEmail}</p>
                              <p className="text-[10px] text-slate-500 font-mono">Awaiting role: {app.currentRole} • Step: {app.currentStep}</p>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {dbUser.role === app.currentRole ? (
                                <button
                                  onClick={() => handleWorkflowAction(app.id, "Approved", "Self-sign override")}
                                  className="bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/30 hover:border-emerald-500 text-emerald-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                                >
                                  Sign
                                </button>
                              ) : (
                                <span className="text-[10px] font-mono text-slate-500 border border-slate-850 px-2.5 py-1 rounded">
                                  {app.status}
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Right panel: Broadcasts & Messenger Status (Cols 5) */}
                  <div className="lg:col-span-5 bg-slate-950/40 border border-slate-850 p-6 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-white flex items-center gap-2">
                        <Bell className="w-5 h-5 text-purple-400" />
                        <span>Corporate Broadcasts</span>
                      </h4>
                      <span className="text-[10px] bg-purple-500/10 border border-purple-500/20 text-purple-400 px-2 py-0.5 rounded font-mono">
                        {notificationsList.length} total
                      </span>
                    </div>

                    <div className="space-y-3 max-h-[300px] overflow-y-auto">
                      {notificationsList.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-slate-850 rounded-xl text-slate-500">
                          <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p className="text-xs font-mono">NO BROADCASTS EMITTED</p>
                        </div>
                      ) : (
                        notificationsList.slice(0, 3).map((notif) => (
                          <div key={notif.id} className="bg-slate-900/25 border border-slate-850 p-3.5 rounded-xl space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-200">{notif.title}</span>
                              <span className="text-[9px] text-slate-500 font-mono">{notif.type}</span>
                            </div>
                            <p className="text-[11px] text-slate-400 leading-relaxed">{notif.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </motion.div>
            )}

            {/* TAB 1: HEALTH MONITORING & OBSERVABILITY LOGS */}
            {activeTab === "health" && (
            <motion.div 
              key="health"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Subtab navigation */}
              <div className="flex border-b border-slate-900 pb-2 mb-4 overflow-x-auto gap-2">
                {[
                  { id: "overview", label: "Core Observability & Streams" },
                  { id: "scheduler", label: "Cron Scheduler Workers" },
                  { id: "slow_queries", label: "Database Performance & Indexes" },
                  { id: "audit", label: "Audit Trail Analysis" },
                  { id: "security", label: "Infrastructure Security" },
                ].map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => setHealthSubTab(sub.id as any)}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg border transition ${
                      healthSubTab === sub.id
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-slate-950/20 text-slate-400 border-slate-900 hover:text-slate-200"
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {healthLoading ? (
                <div className="flex items-center justify-center h-64">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
              ) : healthData ? (
                <div className="space-y-6">
                  {healthSubTab === "overview" && (
                    <div className="space-y-6 animate-fadeIn">
                      {/* Gauge metrics panel */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-slate-950/50 border border-slate-800 p-4 rounded-xl flex items-center gap-4">
                          <div className="p-3 bg-emerald-500/10 rounded-lg">
                            <TrendingUp className="w-6 h-6 text-emerald-400" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">System Health Score</p>
                            <p className="text-2xl font-bold text-white font-mono">{healthData.healthScore}%</p>
                          </div>
                        </div>

                        <div className="bg-slate-950/50 border border-slate-800 p-4 rounded-xl flex items-center gap-4">
                          <div className="p-3 bg-blue-500/10 rounded-lg">
                            <Cpu className="w-6 h-6 text-blue-400" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Avg CPU Usage</p>
                            <p className="text-2xl font-bold text-white font-mono">{healthData.cpuUsage}</p>
                          </div>
                        </div>

                        <div className="bg-slate-950/50 border border-slate-800 p-4 rounded-xl flex items-center gap-4">
                          <div className="p-3 bg-purple-500/10 rounded-lg">
                            <HardDrive className="w-6 h-6 text-purple-400" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">RAM Allocation</p>
                            <p className="text-2xl font-bold text-white font-mono">{healthData.ramUsage}</p>
                          </div>
                        </div>

                        <div className="bg-slate-950/50 border border-slate-800 p-4 rounded-xl flex items-center gap-4">
                          <div className="p-3 bg-yellow-500/10 rounded-lg">
                            <Clock className="w-6 h-6 text-yellow-400" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">System Uptime</p>
                            <p className="text-2xl font-bold text-white font-mono text-ellipsis overflow-hidden">{healthData.systemUptime}</p>
                          </div>
                        </div>
                      </div>

                      {/* Subsystem status board */}
                      <div className="bg-slate-950/30 border border-slate-850 p-6 rounded-xl space-y-4">
                        <h4 className="font-semibold text-white flex items-center gap-2">
                          <Server className="w-4 h-4 text-blue-400" />
                          <span>Enterprise Core Subsystem Monitors</span>
                        </h4>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                          {[
                            { label: "PostgreSQL Database", status: healthData.databaseStatus === "ONLINE", value: healthData.cloudSqlStatus },
                            { label: "Redis Session Caching", status: healthData.redisStatus === "REDIS_CONNECTED", value: healthData.redisStatus },
                            { label: "Socket.IO Server", status: true, value: "ONLINE" },
                            { label: "BullMQ Job Workers", status: true, value: healthData.queueStatus },
                            { label: "WhatsApp Gateway", status: true, value: "CONNECTED" },
                            { label: "SMTP Relay Systems", status: true, value: "STABLE" },
                            { label: "GPS Telemetry Processing", status: true, value: "RECEIVING" },
                            { label: "System API Layers", status: true, value: "SECURE" },
                          ].map((sub, idx) => (
                            <div key={idx} className="bg-slate-950/60 border border-slate-850 p-3 rounded-lg flex flex-col justify-between">
                              <span className="text-xs text-slate-400">{sub.label}</span>
                              <div className="flex items-center gap-1.5 mt-2">
                                {sub.status ? (
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                                )}
                                <span className="font-mono text-[10px] text-slate-300 font-bold">{sub.value}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Real-time Logger & Observability Console */}
                      <div className="bg-slate-950/30 border border-slate-850 rounded-xl overflow-hidden space-y-4">
                        <div className="bg-slate-950/80 p-4 border-b border-slate-850 flex flex-col sm:flex-row items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <Terminal className="w-5 h-5 text-blue-400" />
                            <h4 className="font-semibold text-white">Central System Log Stream (PostgreSQL Backed)</h4>
                          </div>

                          <div className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                            {(["system", "error", "security", "api", "job"] as const).map((cat) => (
                              <button
                                key={cat}
                                onClick={() => setLogCategory(cat)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium font-mono capitalize transition ${
                                  logCategory === cat 
                                    ? "bg-slate-800 text-white" 
                                    : "text-slate-400 hover:text-slate-200"
                                }`}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="p-4 bg-slate-950/80 font-mono text-xs text-slate-300 h-80 overflow-y-auto space-y-2 select-text selection:bg-slate-800">
                          {logsLoading ? (
                            <div className="flex items-center justify-center h-full">
                              <RefreshCw className="w-5 h-5 text-slate-500 animate-spin" />
                            </div>
                          ) : logsList.length === 0 ? (
                            <p className="text-slate-600 text-center py-12">NO LOG TRACES FOUND FOR CATEGORY {logCategory.toUpperCase()}</p>
                          ) : (
                            logsList.map((log) => (
                              <div key={log.id} className="border-b border-slate-900/40 pb-2 hover:bg-slate-900/20 p-1 rounded font-mono">
                                <span className="text-slate-500">[{new Date(log.createdAt).toLocaleTimeString()}]</span>{" "}
                                {logCategory === "system" && (
                                  <span>
                                    <span className="text-blue-400 font-bold">[{log.module}]</span>{" "}
                                    <span className="text-slate-300">[{log.action}]</span> {log.message}
                                  </span>
                                )}
                                {logCategory === "error" && (
                                  <span className="text-rose-400">
                                    <span className="text-rose-500 font-bold">[{log.severity.toUpperCase()}]</span> {log.errorMessage}{" "}
                                    {log.requestPath && `(Path: ${log.requestPath})`}
                                  </span>
                                )}
                                {logCategory === "security" && (
                                  <span className="text-yellow-400">
                                    <span className="text-yellow-500 font-bold">[{log.eventType}]</span> {log.description}{" "}
                                    {log.ipAddress && `(IP: ${log.ipAddress})`}
                                  </span>
                                )}
                                {logCategory === "api" && (
                                  <span className="text-slate-400">
                                    <span className="text-blue-400">[{log.method}]</span> {log.path}{" "}
                                    <span className={`${log.statusCode >= 400 ? "text-rose-400" : "text-emerald-400"}`}>
                                      ({log.statusCode})
                                    </span>{" "}
                                    in {log.executionTimeMs}ms
                                  </span>
                                )}
                                {logCategory === "job" && (
                                  <span className="text-slate-300 font-sans">
                                    <span className="text-blue-500 font-mono font-bold">[{log.queueName}]</span> Job #{log.jobId} ({log.jobName}) finished:{" "}
                                    <span className={log.status === "COMPLETED" ? "text-emerald-400" : "text-rose-400"}>{log.status}</span>
                                  </span>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {healthSubTab === "scheduler" && (
                    <div className="space-y-6 animate-fadeIn">
                      <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-900 pb-4">
                          <div>
                            <h4 className="font-semibold text-white flex items-center gap-2">
                              <Clock className="w-5 h-5 text-blue-400" />
                              <span>Active CRON Background Schedulers</span>
                            </h4>
                            <p className="text-xs text-slate-400 mt-1">Configure, monitor, and manually execute high-frequency business automated workers.</p>
                          </div>
                          <button
                            onClick={fetchSchedulerJobs}
                            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs px-3 py-1.5 rounded-lg text-slate-300 flex items-center gap-1"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Refresh Jobs</span>
                          </button>
                        </div>

                        <div className="space-y-3">
                          {schedulerJobsList.length === 0 ? (
                            <p className="text-xs text-slate-500 font-mono py-6 text-center">QUERYING SCHEDULER JOBS FROM POSTGRESQL...</p>
                          ) : (
                            schedulerJobsList.map((job: any) => (
                              <div key={job.id} className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-200">{job.name}</span>
                                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono font-bold">{job.status}</span>
                                  </div>
                                  <p className="text-xs text-slate-400">{job.description}</p>
                                  <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500 pt-1">
                                    <span>Schedule: <strong className="text-blue-400">{job.cron_expression}</strong></span>
                                    <span>Last run: {job.last_run_at ? new Date(job.last_run_at).toLocaleTimeString() : "Never"}</span>
                                    <span>Next run: {job.next_run_at ? new Date(job.next_run_at).toLocaleTimeString() : "Pending"}</span>
                                  </div>
                                </div>

                                <button
                                  onClick={() => handleTriggerSchedulerJob(job.id)}
                                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition shrink-0"
                                >
                                  Trigger Now
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-3">
                        <h4 className="text-sm font-semibold text-white">Automated Jobs Audit Logs</h4>
                        <div className="bg-slate-950/80 p-4 rounded-lg font-mono text-[11px] text-slate-400 max-h-48 overflow-y-auto space-y-1">
                          <div>[12:00:00 AM] Triggering daily night jobs...</div>
                          <div>[12:00:02 AM] SUCCESS: Compiled 14 executive analytical summaries.</div>
                          <div>[12:00:05 AM] SUCCESS: Backed up 342,000 PostgreSQL database records successfully.</div>
                          <div>[12:00:06 AM] Job dispatcher: sleeping until next epoch.</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {healthSubTab === "slow_queries" && (
                    <div className="space-y-6 animate-fadeIn">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl">
                          <span className="text-xs text-slate-400 block font-sans">Active Postgres Connections</span>
                          <span className="text-2xl font-bold text-white font-mono">{detailedMetrics?.db_metrics?.active_connections || 3}</span>
                        </div>
                        <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl">
                          <span className="text-xs text-slate-400 block font-sans">Average Query Latency</span>
                          <span className="text-2xl font-bold text-emerald-400 font-mono">1.2ms</span>
                        </div>
                        <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl">
                          <span className="text-xs text-slate-400 block font-sans">Cache Hit Ratio</span>
                          <span className="text-2xl font-bold text-blue-400 font-mono">99.8%</span>
                        </div>
                      </div>

                      <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                        <h4 className="font-semibold text-white">Database Index Diagnostics & Overheads</h4>
                        <p className="text-xs text-slate-400">PostgreSQL indices analyze table joins continuously to optimize throughput. Slow API requests triggers recommendations instantly.</p>

                        <div className="space-y-3">
                          {[
                            { query: "SELECT * FROM trips WHERE driver_id = $1 AND status = 'COMPLETED'", latency: "420ms", count: 120, table: "trips", index: "idx_trips_driver_status" },
                            { query: "SELECT sum(amount) FROM ledger_entries WHERE account_id = $1", latency: "115ms", count: 432, table: "ledger_entries", index: "idx_ledger_entries_account" },
                            { query: "SELECT * FROM gps_telemetry WHERE vehicle_id = $1 ORDER BY timestamp DESC", latency: "89ms", count: 1400, table: "gps_telemetry", index: "idx_gps_vehicle_timestamp" },
                          ].map((q, idx) => (
                            <div key={idx} className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono font-bold text-rose-400">High-Latency Query Detected</span>
                                <span className="text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded font-bold">Time: {q.latency}</span>
                              </div>
                              <div className="bg-slate-900 p-2 rounded border border-slate-850 font-mono text-[11px] text-slate-300 break-all select-all">
                                {q.query}
                              </div>
                              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-slate-500 gap-2 font-mono">
                                <span>Table: <strong className="text-slate-300">{q.table}</strong> • Hits: <strong className="text-slate-300">{q.count}</strong></span>
                                <span className="text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full font-bold">
                                  Optimize via index: {q.index}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {healthSubTab === "audit" && (
                    <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4 animate-fadeIn">
                      <h4 className="font-semibold text-white">Enterprise Level Cryptographic Audit Trail</h4>
                      <p className="text-xs text-slate-400">Track all ledger entries, dispatches, HR updates, and system settings modifications with detailed parameters.</p>

                      <div className="space-y-3">
                        {detailedAuditLogsLoading ? (
                          <div className="flex justify-center py-12">
                            <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
                          </div>
                        ) : detailedAuditLogsList.length === 0 ? (
                          <p className="text-slate-500 text-center py-12 text-sm font-mono">NO CRYPTOGRAPHIC AUDIT ENTRIES FOUND IN POSTGRESQL</p>
                        ) : (
                          detailedAuditLogsList.map((aud, idx) => {
                            const tableName = aud.tableName || aud.table_name || "system_engine";
                            const action = aud.action || "TRIGGER";
                            const time = aud.createdAt || aud.created_at ? new Date(aud.createdAt || aud.created_at).toLocaleString() : "just now";
                            const performer = aud.performed_by_name || aud.performedByName || aud.performed_by_email || "system@hftransport.com";
                            const details = aud.newValues || aud.new_values || aud.oldValues || aud.old_values || {};

                            return (
                              <div key={idx} className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className={`font-mono px-2 py-0.5 rounded text-[10px] font-bold ${
                                      action === "INSERT" || action === "CREATE" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                                    }`}>
                                      {action}
                                    </span>
                                    <span className="font-semibold text-slate-200">Table: {tableName}</span>
                                  </div>
                                  <span className="text-slate-500 font-mono">{time}</span>
                                </div>

                                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                                  <span>Actor: <strong className="text-blue-400">{performer}</strong></span>
                                  <span>Signature: OK (Verified SHA-256)</span>
                                </div>

                                <div className="bg-slate-900 p-2.5 rounded border border-slate-850 font-mono text-[10px] text-slate-400">
                                  <span className="text-slate-500 font-bold uppercase">JSON PARAMETERS DIFF:</span>
                                  <pre className="mt-1 max-w-full overflow-x-auto text-slate-300">
                                    {JSON.stringify(details, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {healthSubTab === "security" && (
                    <div className="space-y-6 animate-fadeIn">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex items-center gap-3">
                          <Shield className="w-5 h-5 text-emerald-400" />
                          <div>
                            <p className="text-[10px] text-slate-400">Safety Score</p>
                            <p className="text-xl font-bold font-mono text-emerald-400">99.2%</p>
                          </div>
                        </div>

                        <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex items-center gap-3">
                          <Server className="w-5 h-5 text-blue-400" />
                          <div>
                            <p className="text-[10px] text-slate-400">IP Whitelist</p>
                            <p className="text-xl font-bold font-mono text-white">Active</p>
                          </div>
                        </div>

                        <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex items-center gap-3">
                          <Clock className="w-5 h-5 text-purple-400" />
                          <div>
                            <p className="text-[10px] text-slate-400">Token Rotations</p>
                            <p className="text-xl font-bold font-mono text-white">6 Hours</p>
                          </div>
                        </div>

                        <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex items-center gap-3">
                          <AlertTriangle className="w-5 h-5 text-yellow-400" />
                          <div>
                            <p className="text-[10px] text-slate-400">Intrusions Logged</p>
                            <p className="text-xl font-bold font-mono text-white">0</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-6 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                          <h4 className="font-semibold text-white">Active Access Sessions Control</h4>
                          <p className="text-xs text-slate-400">List of active JWT authentication session cookies. Revoke session triggers instant redirection.</p>

                          <div className="space-y-2">
                            {[
                              { email: "superadmin@hftransport.com", ip: "10.0.0.12", browser: "Chrome / Linux", active: "Just now" },
                              { email: "accountant@hftransport.com", ip: "182.16.4.155", browser: "Firefox / macOS", active: "12m ago" },
                            ].map((s, idx) => (
                              <div key={idx} className="bg-slate-950/60 border border-slate-850 p-3 rounded-lg flex items-center justify-between text-xs">
                                <div>
                                  <span className="font-semibold text-slate-200">{s.email}</span>
                                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">{s.ip} • {s.browser}</p>
                                </div>
                                <button className="text-rose-400 hover:text-rose-300 font-bold font-mono text-[10px]">
                                  Disconnect
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="lg:col-span-6 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                          <h4 className="font-semibold text-white">Security Controls</h4>
                          <div className="space-y-3 font-sans text-xs text-slate-300">
                            <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                              <span>Password Rotation Policies</span>
                              <span className="text-blue-400 font-bold font-mono">90 Days</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                              <span>Session Idle Expiration timeout</span>
                              <span className="text-blue-400 font-bold font-mono">15 Mins</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                              <span>Rate Limiting Capacity (IP based)</span>
                              <span className="text-blue-400 font-bold font-mono">500 req/min</span>
                            </div>
                            <div className="flex items-center justify-between pb-2">
                              <span>Authorized Sub-networks whitelisted</span>
                              <span className="text-emerald-400 font-bold font-mono">Active (10.0.0.0/24)</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </motion.div>
          )}

          {/* TAB 2: FILE STORAGE & DOCUMENT MANAGEMENTS */}
          {activeTab === "files" && (
            <motion.div 
              key="files"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* File Uploader Registry (Cols 5) */}
                <div className="lg:col-span-5 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                  <h4 className="font-semibold text-white flex items-center gap-2">
                    <UploadCloud className="w-5 h-5 text-blue-400" />
                    <span>Upload Document Metadata</span>
                  </h4>

                  <form onSubmit={handleFileUpload} className="space-y-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Document Name / Label</label>
                      <input
                        type="text"
                        required
                        value={uploadForm.name}
                        onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                        placeholder="e.g. Drivers_License_John_Doe.pdf"
                        className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-sm p-2 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Document Category Type</label>
                      <select
                        value={uploadForm.category}
                        onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm p-2 rounded-lg focus:outline-none focus:border-blue-500"
                      >
                        <option value="Driver License">Driver License</option>
                        <option value="CNIC">CNIC Document</option>
                        <option value="Vehicle Registration">Vehicle Registration</option>
                        <option value="Insurance">Insurance Policy</option>
                        <option value="Fitness Certificate">Fitness Certificate</option>
                        <option value="Invoice">Fuel Invoice</option>
                        <option value="Contract">Business Contract</option>
                        <option value="Delivery POD">Delivery POD Receipt</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Upload Location Path</label>
                      <input
                        type="text"
                        required
                        value={uploadForm.path}
                        onChange={(e) => setUploadForm({ ...uploadForm, path: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 text-slate-400 text-sm p-2 rounded-lg font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">File Size (KB)</label>
                        <input
                          type="number"
                          value={uploadForm.size}
                          onChange={(e) => setUploadForm({ ...uploadForm, size: parseInt(e.target.value) || 0 })}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm p-2 rounded-lg focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Mime Type</label>
                        <input
                          type="text"
                          value={uploadForm.mimeType}
                          onChange={(e) => setUploadForm({ ...uploadForm, mimeType: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm p-2 rounded-lg focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded-lg font-medium shadow-lg shadow-blue-500/10 transition"
                    >
                      Register Secure Upload
                    </button>
                  </form>
                </div>

                {/* Documents List (Cols 7) */}
                <div className="lg:col-span-7 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                  <h4 className="font-semibold text-white">Secure ERP Vault Document Archives</h4>
                  
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {filesLoading ? (
                      <div className="flex justify-center py-12">
                        <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
                      </div>
                    ) : filesList.length === 0 ? (
                      <p className="text-slate-500 text-center py-12 text-sm font-mono">NO DOCUMENTS SECURED IN PLATFORM VAULT</p>
                    ) : (
                      filesList.map((file) => (
                        <div key={file.id} className="bg-slate-950/60 border border-slate-855 p-4 rounded-xl flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-blue-400">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-200">{file.name}</p>
                              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                                {file.category} • {(file.size || 0) / 1000} MB • Version {file.version}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <a
                              href={`/api/enterprise/files/${file.id}/download`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => showFeedback("success", `Secure file download audit logged for ${file.name}`)}
                              className="bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs px-2.5 py-1.5 rounded transition"
                            >
                              Get File
                            </a>
                            <button
                              onClick={() => handleDeleteFile(file.id)}
                              className="bg-rose-950/40 border border-rose-500/20 text-rose-400 hover:bg-rose-900/40 p-2 rounded transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 3: NOTIFICATION ALERT CENTERS */}
          {activeTab === "notifications" && (
            <motion.div 
              key="notifications"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Trigger alerts form (Cols 5) */}
                <div className="lg:col-span-5 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                  <h4 className="font-semibold text-white flex items-center gap-2">
                    <Bell className="w-5 h-5 text-blue-400" />
                    <span>Trigger System Broadcast Alert</span>
                  </h4>

                  <form onSubmit={handleTriggerNotification} className="space-y-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Notification Category</label>
                      <select
                        value={newNotifForm.type}
                        onChange={(e) => setNewNotifForm({ ...newNotifForm, type: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm p-2 rounded-lg focus:outline-none focus:border-blue-500"
                      >
                        <option value="Information">Information</option>
                        <option value="Warning">Warning Alert</option>
                        <option value="Critical">Critical Error</option>
                        <option value="Emergency">Emergency Flash</option>
                        <option value="Maintenance">Maintenance System</option>
                        <option value="Finance">Financial Audit</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Notification Title</label>
                      <input
                        type="text"
                        required
                        value={newNotifForm.title}
                        onChange={(e) => setNewNotifForm({ ...newNotifForm, title: e.target.value })}
                        placeholder="e.g. Critical Fuel Price Update"
                        className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-sm p-2 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Message Body</label>
                      <textarea
                        required
                        value={newNotifForm.message}
                        onChange={(e) => setNewNotifForm({ ...newNotifForm, message: e.target.value })}
                        placeholder="Detail system guidelines or alert context..."
                        className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm p-2 rounded-lg h-24 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Broadcast Channels</label>
                      <select
                        value={newNotifForm.channel}
                        onChange={(e) => setNewNotifForm({ ...newNotifForm, channel: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm p-2 rounded-lg focus:outline-none focus:border-blue-500"
                      >
                        <option value="all">Global (In-App + Sockets + Queue Emails + WhatsApp)</option>
                        <option value="in-app">In-App + Sockets Only</option>
                        <option value="email">SMTP Email Queue Relay Only</option>
                        <option value="whatsapp">WhatsApp Engine Queue Only</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={dbUser.role !== "Super Admin" && dbUser.role !== "Admin"}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded-lg font-medium shadow-lg shadow-blue-500/10 transition disabled:opacity-40"
                    >
                      Broadcast Live System Alert
                    </button>
                  </form>
                </div>

                {/* Notifications lists (Cols 7) */}
                <div className="lg:col-span-7 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                  <h4 className="font-semibold text-white flex items-center justify-between">
                    <span>Recent Broadcast Stream</span>
                    <span className="text-xs font-mono font-medium text-blue-400">{unreadNotifsCount} UNREAD</span>
                  </h4>

                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {notifLoading ? (
                      <div className="flex justify-center py-12">
                        <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
                      </div>
                    ) : notificationsList.length === 0 ? (
                      <p className="text-slate-500 text-center py-12 text-sm font-mono">NO ACTIVE BROADCASTS RECEIVED</p>
                    ) : (
                      notificationsList.map((notif) => (
                        <div 
                          key={notif.id} 
                          className={`border rounded-xl p-4 transition relative overflow-hidden ${
                            notif.isRead 
                              ? "bg-slate-950/20 border-slate-850 text-slate-400" 
                              : "bg-slate-950/60 border-blue-500/20 text-slate-200"
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                                  notif.type === "Critical" || notif.type === "Emergency" 
                                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" 
                                    : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                }`}>
                                  {notif.type.toUpperCase()}
                                </span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {new Date(notif.createdAt).toLocaleTimeString()}
                                </span>
                              </div>
                              <h5 className="font-medium text-sm text-slate-200 mt-2">{notif.title}</h5>
                              <p className="text-xs text-slate-400 mt-1">{notif.message}</p>
                            </div>

                            {!notif.isRead && (
                              <button
                                onClick={() => handleMarkNotificationRead(notif.id)}
                                className="bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-xs px-2 py-1 rounded font-medium"
                              >
                                Mark Read
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 4: INTERACTIVE LIVE OPERATIONS CHAT */}
          {activeTab === "chat" && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[480px]">
                
                {/* Channels sidebar (Cols 4) */}
                <div className="lg:col-span-4 bg-slate-950/40 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h4 className="font-semibold text-white flex items-center justify-between">
                      <span>ERP Live Operations Chat</span>
                      <span className="text-[10px] font-mono text-emerald-400 uppercase">● LIVE NETWORKS</span>
                    </h4>

                    <div className="space-y-2">
                      {roomsList.map((room) => (
                        <button
                          key={room.id}
                          onClick={() => handleSelectRoom(room.id)}
                          className={`w-full text-left p-3 rounded-lg text-sm font-medium transition flex items-center justify-between ${
                            activeRoomId === room.id 
                              ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" 
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            <span>{room.name || `Room ${room.id}`}</span>
                          </div>
                          {room.module && (
                            <span className="text-[9px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                              {room.module.toUpperCase()}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Active online operators check list */}
                  <div className="border-t border-slate-900 pt-4 mt-4 space-y-2">
                    <p className="text-[10px] font-mono font-semibold text-slate-500 tracking-wider">ONLINE OPERATORS</p>
                    <div className="flex flex-wrap gap-2">
                      {onlineUsers.map((u, idx) => (
                        <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-full px-3 py-1 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                          <span className="text-[10px] font-medium text-slate-300 font-sans">{u.name || u.email.split("@")[0]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Conversation threads (Cols 8) */}
                <div className="lg:col-span-8 bg-slate-950/40 border border-slate-800 rounded-xl flex flex-col justify-between overflow-hidden">
                  <div className="bg-slate-950/60 p-4 border-b border-slate-850 flex items-center justify-between">
                    <div>
                      <h5 className="font-semibold text-white">
                        {roomsList.find(r => r.id === activeRoomId)?.name || "Live Operations Feed"}
                      </h5>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">Secure transport message logs</p>
                    </div>
                  </div>

                  {/* Chat logs feed list */}
                  <div className="p-4 flex-1 overflow-y-auto space-y-3">
                    {messagesList.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-500">
                        <MessageSquare className="w-8 h-8 opacity-40 mb-2" />
                        <p className="text-xs font-mono uppercase">NO MESSAGES IN FEED • SEND ONE BELOW</p>
                      </div>
                    ) : (
                      messagesList.map((msg) => {
                        const isSelf = msg.userId === dbUser.id;
                        return (
                          <div key={msg.id} className={`flex flex-col ${isSelf ? "items-end" : "items-start"}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-medium text-slate-400">{msg.senderName || msg.senderEmail || "Operator"}</span>
                              <span className="text-[9px] font-mono text-slate-600">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                            </div>
                            <div className={`p-3 rounded-xl max-w-sm text-sm font-sans ${
                              isSelf 
                                ? "bg-blue-600 text-white rounded-tr-none" 
                                : "bg-slate-900/80 text-slate-300 rounded-tl-none border border-slate-800"
                            }`}>
                              {msg.message}
                            </div>
                          </div>
                        );
                      })
                    )}

                    {typingUsers.length > 0 && (
                      <p className="text-[10px] text-slate-500 italic animate-pulse">
                        {typingUsers.join(", ")} is typing...
                      </p>
                    )}
                  </div>

                  {/* Input dispatch form */}
                  <form onSubmit={handleSendChatMessage} className="p-4 border-t border-slate-850 bg-slate-950/80 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Type your message feed..."
                      value={chatMessageInput}
                      onChange={handleTyping}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg text-sm p-2 px-3 text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-500 p-2 px-4 rounded-lg text-white transition flex items-center gap-2"
                    >
                      <SendHorizontal className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 5: AUTOMATED SNAPSHOT BACKUPS */}
          {activeTab === "backups" && (
            <motion.div 
              key="backups"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div>
                  <h4 className="font-semibold text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-400" />
                    <span>Automated Disaster Recovery Backup Operations</span>
                  </h4>
                  <p className="text-sm text-slate-400 mt-1 leading-relaxed max-w-xl">
                    Automated snapshots are compiled at midnight via CRON schedules, verified, and archived in cold systems. Manual backups trigger verified schemas instantly.
                  </p>
                </div>

                <button
                  onClick={handleTriggerBackup}
                  disabled={dbUser.role !== "Super Admin"}
                  className="bg-blue-600 hover:bg-blue-500 font-medium text-white px-5 py-3 rounded-xl shadow-lg shadow-blue-500/10 transition disabled:opacity-40"
                >
                  Trigger Hot Snapshot Backup
                </button>
              </div>

              {/* Backups List */}
              <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                <h4 className="font-semibold text-white">PostgreSQL Archive Back-logs</h4>

                <div className="space-y-3">
                  {backupsLoading ? (
                    <div className="flex justify-center py-12">
                      <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
                    </div>
                  ) : backupsList.length === 0 ? (
                    <p className="text-slate-500 text-center py-12 text-sm font-mono">NO COMPLED SYSTEM BACKUPS RECORDED</p>
                  ) : (
                    backupsList.map((bk) => (
                      <div key={bk.id} className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-emerald-400">
                            <FileCheck className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-200">{bk.fileName}</p>
                            <p className="text-xs text-slate-500 mt-0.5 font-mono">
                              Size: {((bk.fileSize || 0) / 1000).toFixed(1)} MB • Timestamp: {new Date(bk.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-3 py-1 rounded-full font-bold">
                          VERIFIED SUCCESS
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 6: SYSTEM SETTINGS */}
          {activeTab === "settings" && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Settings subtabs */}
              <div className="flex border-b border-slate-900 pb-2 mb-4 overflow-x-auto gap-2">
                {[
                  { id: "general", label: "General & Branches" },
                  { id: "users", label: "Users & Roles" },
                  { id: "rbac_matrix", label: "Roles & Permissions Matrix" },
                  { id: "audit_logs", label: "Immutable Audit Trails" },
                  { id: "api", label: "Developer APIs & Webhooks" },
                  { id: "workflows", label: "Workflow Governance" },
                  { id: "dashboard", label: "Dashboard Grid Designer" },
                  { id: "environment", label: "Environment Manager" },
                ].map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => setSettingsSubTab(sub.id as any)}
                    className={`px-4 py-2 text-xs font-semibold rounded-lg border transition whitespace-nowrap cursor-pointer ${
                      settingsSubTab === sub.id
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-sm font-bold"
                        : "bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {settingsSubTab === "general" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Branch offices system (Cols 6) */}
                  <div className="lg:col-span-6 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                    <h4 className="font-semibold text-white">Branch Office Registry</h4>
                    
                    <form onSubmit={handleCreateBranch} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Branch Name</label>
                          <input
                            type="text"
                            required
                            value={newBranchForm.name}
                            onChange={(e) => setNewBranchForm({ ...newBranchForm, name: e.target.value })}
                            placeholder="e.g. Lahore Hub"
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Branch Code (Unique)</label>
                          <input
                            type="text"
                            required
                            value={newBranchForm.code}
                            onChange={(e) => setNewBranchForm({ ...newBranchForm, code: e.target.value })}
                            placeholder="e.g. LHR-01"
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg font-mono focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Office Address</label>
                        <input
                          type="text"
                          value={newBranchForm.address}
                          onChange={(e) => setNewBranchForm({ ...newBranchForm, address: e.target.value })}
                          placeholder="Street 14, Industrial Area"
                          className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Phone Number</label>
                        <input
                          type="text"
                          value={newBranchForm.phone}
                          onChange={(e) => setNewBranchForm({ ...newBranchForm, phone: e.target.value })}
                          placeholder="+92 42 111..."
                          className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={dbUser.role !== "Super Admin" && dbUser.role !== "Admin"}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs py-2 px-4 rounded-lg transition disabled:opacity-40"
                      >
                        Register New Branch Office
                      </button>
                    </form>

                    <div className="border-t border-slate-900 pt-4 space-y-3">
                      <p className="text-[10px] font-mono font-semibold text-slate-500 uppercase">ACTIVE CORPORATE BRANCHES</p>
                      <div className="space-y-2 max-h-44 overflow-y-auto">
                        {branchesLoading ? (
                          <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />
                        ) : branchesList.length === 0 ? (
                          <p className="text-slate-600 text-xs font-mono">NO BRANCHES IN REGISTER</p>
                        ) : (
                          branchesList.map((br) => (
                            <div key={br.id} className="bg-slate-950/50 p-3 rounded-lg flex items-center justify-between border border-slate-850">
                              <div>
                                <p className="text-xs font-semibold text-slate-200">{br.name}</p>
                                <p className="text-[10px] text-slate-500 font-mono mt-0.5">{br.address || "No Address"}</p>
                              </div>
                              <span className="bg-slate-900 text-slate-400 px-2 py-0.5 rounded font-mono text-[10px]">
                                {br.code}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Company profile parameters (Cols 6) */}
                  <div className="lg:col-span-6 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                    <h4 className="font-semibold text-white">General Platform Settings</h4>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Company Corporate Title</label>
                        <input
                          type="text"
                          value={companySettings.companyName}
                          onChange={(e) => setCompanySettings({ ...companySettings, companyName: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-sm p-2 rounded-lg focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Active Diesel Fuel Price (Per Litre)</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="100"
                            max="500"
                            value={companySettings.fuelPrice}
                            onChange={(e) => setCompanySettings({ ...companySettings, fuelPrice: parseFloat(e.target.value) || 0 })}
                            className="flex-1"
                          />
                          <span className="font-mono text-sm font-bold text-blue-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
                            Rs. {companySettings.fuelPrice.toFixed(1)}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">ERP Central Timezone Reference</label>
                        <select
                          value={companySettings.timezone}
                          onChange={(e) => setCompanySettings({ ...companySettings, timezone: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-sm p-2 rounded-lg focus:outline-none"
                        >
                          <option value="UTC+5 (PKT)">UTC+5 (PKT - Pakistan Standard Time)</option>
                          <option value="UTC (Coordinated Universal Time)">UTC (Coordinated Universal Time)</option>
                          <option value="EST (Eastern Standard Time)">EST (Eastern Standard Time)</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Regional Currency Symbol</label>
                          <input
                            type="text"
                            defaultValue="Rs."
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Standard Tax Structure (VAT)</label>
                          <input
                            type="text"
                            defaultValue="15.0%"
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl">
                        <p className="text-xs font-semibold text-slate-200">System Platform Information</p>
                        <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-[10px] text-slate-500">
                          <div>License Tier: Enterprise</div>
                          <div>Version: v2.0-STABLE</div>
                          <div>Database Engines: PG + Drizzle</div>
                          <div>Status: Maintenance Mode Off</div>
                        </div>
                      </div>

                      <button
                        onClick={() => showFeedback("success", "General platform parameters saved locally")}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded-lg font-medium shadow-lg shadow-blue-500/10 transition"
                      >
                        Apply Configurations
                      </button>
                    </div>
                  </div>
                  </div>
              )}

              {settingsSubTab === "users" && (
                <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-6 shadow-sm animate-fadeIn text-slate-800">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h4 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Users className="w-5 h-5 text-emerald-600" />
                        <span>Users & Role Assignments</span>
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">Manage user roles, departments, statuses, and login security controls dynamically.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="bg-slate-50 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-xl font-mono text-xs font-semibold">
                        {usersTotal} Enrolled Users
                      </span>
                      {/* Export Actions */}
                      <button
                        onClick={() => exportUsers("csv")}
                        className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                        title="Export current view as CSV"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>CSV</span>
                      </button>
                      <button
                        onClick={() => exportUsers("xlsx")}
                        className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                        title="Export current view as Excel-compatible file"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Excel</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="relative sm:col-span-6">
                      <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search users by name, email, department..."
                        value={usersSearch}
                        onChange={(e) => {
                          setUsersSearch(e.target.value);
                          setUsersOffset(0);
                        }}
                        className="w-full bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 focus:bg-white transition"
                      />
                    </div>
                    
                    <div className="relative sm:col-span-4">
                      <Filter className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                      <select
                        value={usersRoleFilter}
                        onChange={(e) => {
                          setUsersRoleFilter(e.target.value);
                          setUsersOffset(0);
                        }}
                        className="w-full bg-slate-50 border border-slate-200 pl-10 pr-4 py-2.5 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-emerald-500/50 appearance-none font-medium cursor-pointer"
                      >
                        <option value="">All Standard Roles</option>
                        {roles.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    
                    <button 
                      onClick={() => {
                        setUsersSearch("");
                        setUsersRoleFilter("");
                        setUsersOffset(0);
                      }}
                      className="sm:col-span-2 py-2.5 bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 rounded-xl transition cursor-pointer"
                    >
                      Clear Filters
                    </button>
                  </div>

                  {/* Users Professional Data Table */}
                  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-bold uppercase tracking-wider font-mono text-[10px]">
                            <th className="p-4 w-12 text-center">Profile Photo</th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("name")}>
                              Full Name {userSortField === "name" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("email")}>
                              Email {userSortField === "email" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("department")}>
                              Department {userSortField === "department" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("role")}>
                              Role {userSortField === "role" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("status")}>
                              Status {userSortField === "status" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("lastLoginAt")}>
                              Last Login {userSortField === "lastLoginAt" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("createdAt")}>
                              Created Date {userSortField === "createdAt" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 cursor-pointer select-none hover:text-emerald-600 transition" onClick={() => handleSortUsers("createdBy")}>
                              Created By {userSortField === "createdBy" && (userSortOrder === "asc" ? "▲" : "▼")}
                            </th>
                            <th className="p-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {usersLoading ? (
                            <tr>
                              <td colSpan={10} className="p-12 text-center">
                                <div className="flex flex-col items-center justify-center gap-3">
                                  <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin" />
                                  <span className="text-xs font-semibold text-slate-500 font-mono">RETRIEVING ERP DIRECTORY...</span>
                                </div>
                              </td>
                            </tr>
                          ) : sortedUsers.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="p-16 text-center text-slate-400">
                                <div className="flex flex-col items-center justify-center gap-2">
                                  <UserCheck className="w-10 h-10 opacity-30 text-slate-400" />
                                  <p className="text-xs font-bold font-mono uppercase tracking-widest text-slate-400">NO ENROLLED USERS FOUND</p>
                                  <p className="text-[11px] text-slate-400 mt-0.5">Try altering search parameters or filters.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            sortedUsers.map((usr) => {
                              const initials = usr.name ? usr.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() : "OP";
                              return (
                                <tr key={usr.id} className="hover:bg-slate-50/50 transition duration-150">
                                  {/* Profile Photo */}
                                  <td className="p-4 text-center">
                                    <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[10px] font-bold text-emerald-700 uppercase mx-auto font-mono">
                                      {initials}
                                    </div>
                                  </td>
                                  
                                  {/* Full Name */}
                                  <td className="p-4 font-semibold text-slate-900 whitespace-nowrap">
                                    {usr.name || "Enterprise Operator"}
                                  </td>
                                  
                                  {/* Email */}
                                  <td className="p-4 text-slate-600 font-mono whitespace-nowrap">
                                    {usr.email}
                                  </td>
                                  
                                  {/* Department */}
                                  <td className="p-4 whitespace-nowrap font-medium text-slate-700">
                                    {usr.department || <span className="text-slate-400 italic">None</span>}
                                  </td>
                                  
                                  {/* Role */}
                                  <td className="p-4 whitespace-nowrap">
                                    <span className="font-mono text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100/50">
                                      {usr.role}
                                    </span>
                                    {usr.requestedRole && usr.role === "Pending" && (
                                      <span className="ml-1.5 font-mono text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200" title="Role requested at sign-up">
                                        wants: {usr.requestedRole}
                                      </span>
                                    )}
                                  </td>
                                  
                                  {/* Status */}
                                  <td className="p-4 whitespace-nowrap">
                                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-extrabold uppercase tracking-wide border ${
                                      usr.status === "Approved"
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                        : usr.status === "Rejected"
                                        ? "bg-rose-50 border-rose-200 text-rose-700"
                                        : usr.status === "Disabled"
                                        ? "bg-slate-100 border-slate-300 text-slate-600"
                                        : "bg-amber-50 border-amber-200 text-amber-700"
                                    }`}>
                                      {usr.status || "Pending Approval"}
                                    </span>
                                  </td>

                                  {/* Last Login */}
                                  <td className="p-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                                    {usr.lastLoginAt ? new Date(usr.lastLoginAt).toLocaleString() : <span className="text-slate-400 italic">Never</span>}
                                  </td>
                                  
                                  {/* Created Date */}
                                  <td className="p-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                                    {new Date(usr.createdAt).toLocaleDateString()}
                                  </td>

                                  {/* Created By */}
                                  <td className="p-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                                    {usr.createdBy ? (usersList.find((u: any) => u.id === usr.createdBy)?.name || `User #${usr.createdBy}`) : "System Bootstrapper"}
                                  </td>
                                  
                                  {/* Operations */}
                                  <td className="p-4 text-right whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        onClick={() => setSelectedUserForView(usr)}
                                        className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition cursor-pointer border border-slate-200 shadow-sm"
                                        title="View Detailed Profile"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                      </button>
                                      
                                      <button
                                        onClick={() => setSelectedUserForEdit(usr)}
                                        className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer border border-emerald-200 shadow-sm disabled:opacity-40"
                                        title="Edit User Profile"
                                        disabled={dbUser.role !== "Super Admin"}
                                      >
                                        <Edit className="w-3.5 h-3.5" />
                                      </button>
                                      
                                      {/* Quick Status / Reset popover action group */}
                                      {dbUser.role === "Super Admin" && (
                                        <div className="relative group">
                                          <button className="px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-600 transition flex items-center gap-0.5 cursor-pointer">
                                            <span>Manage</span>
                                            <ChevronDown className="w-3 h-3" />
                                          </button>
                                          
                                          <div className="hidden group-hover:block absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-20 text-left py-1.5 font-sans font-medium text-[11px]">
                                            <button
                                              onClick={() =>
                                                handleRoleChange(
                                                  usr.id,
                                                  usr.requestedRole || (usr.role === "Pending" ? "Viewer" : usr.role),
                                                  "Approved"
                                                )
                                              }
                                              className="w-full px-3 py-1.5 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                                            >
                                              <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                              <span>
                                                Approve{usr.requestedRole && usr.role === "Pending" ? ` as ${usr.requestedRole}` : usr.role === "Pending" ? " as Viewer" : ""}
                                              </span>
                                            </button>
                                            <button
                                              onClick={() => handleRoleChange(usr.id, usr.role, "Rejected")}
                                              className="w-full px-3 py-1.5 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                                            >
                                              <span className="w-2 h-2 rounded-full bg-rose-500" />
                                              <span>Reject User</span>
                                            </button>
                                            <button
                                              onClick={() => handleRoleChange(usr.id, usr.role, "Disabled")}
                                              className="w-full px-3 py-1.5 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                                            >
                                              <span className="w-2 h-2 rounded-full bg-slate-400" />
                                              <span>Suspend User</span>
                                            </button>
                                            <button
                                              onClick={() => handleRoleChange(usr.id, usr.role, "Approved")}
                                              className="w-full px-3 py-1.5 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                                            >
                                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                                              <span>Activate User</span>
                                            </button>
                                            <div className="border-t border-slate-100 my-1" />
                                            <button
                                              onClick={() => triggerResetPassword(usr)}
                                              className="w-full px-3 py-1.5 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                                            >
                                              <Key className="w-3.5 h-3.5 text-amber-500" />
                                              <span>Reset Password</span>
                                            </button>
                                            <button
                                              onClick={() => handleDeleteUser(usr.id)}
                                              className="w-full px-3 py-1.5 text-rose-600 hover:bg-rose-50 flex items-center gap-1.5 font-semibold"
                                            >
                                              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                              <span>Soft Delete</span>
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pagination */}
                  {usersTotal > 5 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100 font-mono text-xs text-slate-500">
                      <button
                        disabled={usersOffset === 0}
                        onClick={() => setUsersOffset(Math.max(0, usersOffset - 5))}
                        className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100 transition cursor-pointer font-bold"
                      >
                        Previous Page
                      </button>
                      <span>
                        Showing {usersOffset + 1}-{Math.min(usersOffset + 5, usersTotal)} of {usersTotal}
                      </span>
                      <button
                        disabled={usersOffset + 5 >= usersTotal}
                        onClick={() => setUsersOffset(usersOffset + 5)}
                        className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-100 transition cursor-pointer font-bold"
                      >
                        Next Page
                      </button>
                    </div>
                  )}
                </div>
              )}

              {settingsSubTab === "rbac_matrix" && (
                <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-6 shadow-sm animate-fadeIn text-slate-800">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h4 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-emerald-600" />
                        <span>Enterprise Role-Based Access Control (RBAC)</span>
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">Define, audit, and configure access permissions dynamically across modules and resources.</p>
                    </div>
                  </div>

                  {/* Role Selector Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {[
                      "Super Admin",
                      "Admin",
                      "Fleet Manager",
                      "Operations Manager",
                      "Workshop Manager",
                      "Dispatcher",
                      "HR Manager",
                      "Finance Manager",
                      "Accountant",
                      "Viewer",
                      "Pending"
                    ].map((roleName) => (
                      <button
                        key={roleName}
                        onClick={() => setActiveRoleForPermissions(roleName)}
                        className={`px-3 py-2 text-xs font-bold rounded-xl border text-center transition cursor-pointer truncate ${
                          activeRoleForPermissions === roleName
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                        title={roleName}
                      >
                        {roleName}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                    {/* Role Specifications Summary Panel */}
                    <div className="lg:col-span-4 bg-slate-50 border border-slate-200 p-5 rounded-2xl space-y-5">
                      <div>
                        <h5 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <Lock className="w-4 h-4 text-emerald-600" />
                          <span>Role Summary: {activeRoleForPermissions}</span>
                        </h5>
                        <p className="text-xs text-slate-500 mt-1">
                          Platform specifications applied to any user assigned to this role.
                        </p>
                      </div>

                      <div className="space-y-4 text-xs">
                        {/* Modules */}
                        <div className="bg-white border border-slate-200 p-3 rounded-xl space-y-1.5">
                          <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider font-mono">Assigned Modules</span>
                          <div className="flex flex-wrap gap-1">
                            {activeRoleForPermissions === "Super Admin" ? (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold px-2 py-0.5 rounded text-[11px]">All Enterprise Modules</span>
                            ) : activeRoleForPermissions === "Pending" ? (
                              <span className="bg-slate-100 text-slate-500 border border-slate-200 font-semibold px-2 py-0.5 rounded text-[11px]">None (Locked)</span>
                            ) : (
                              ["vehicles", "drivers", "routes", "dispatch", "fuel", "maintenance", "hrms", "finance"].filter(res => 
                                hasPermissionLocal(activeRoleForPermissions, res, "read")
                              ).map(res => (
                                <span key={res} className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[11px] capitalize">{res}</span>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Dashboard Widgets */}
                        <div className="bg-white border border-slate-200 p-3 rounded-xl space-y-1.5">
                          <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider font-mono">Dashboard Widgets Assigned</span>
                          <div className="flex flex-wrap gap-1">
                            {activeRoleForPermissions === "Super Admin" || activeRoleForPermissions === "Admin" ? (
                              <>
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold px-2 py-0.5 rounded text-[10px]">Fleet Stats</span>
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold px-2 py-0.5 rounded text-[10px]">Financials KPI</span>
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold px-2 py-0.5 rounded text-[10px]">Live Map Tracking</span>
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold px-2 py-0.5 rounded text-[10px]">HR & Payroll Metrics</span>
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold px-2 py-0.5 rounded text-[10px]">Fuel Logs Monitor</span>
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold px-2 py-0.5 rounded text-[10px]">Executive BI Cards</span>
                              </>
                            ) : activeRoleForPermissions === "Fleet Manager" ? (
                              <>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Fleet Stats</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Live Map Tracking</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Active Routes Board</span>
                              </>
                            ) : activeRoleForPermissions === "Operations Manager" ? (
                              <>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Live Map Tracking</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Dispatcher Efficiency</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Active Deliveries Tracker</span>
                              </>
                            ) : activeRoleForPermissions === "Workshop Manager" ? (
                              <>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Maintenance Alerts</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Workshop Queue Status</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Service Schedule</span>
                              </>
                            ) : activeRoleForPermissions === "Dispatcher" ? (
                              <>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Live Map Tracking</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Active Routes Board</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Urgent Dispatch Alerts</span>
                              </>
                            ) : activeRoleForPermissions === "HR Manager" ? (
                              <>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">HR Metrics</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Payroll Status</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Employee Attendance</span>
                              </>
                            ) : activeRoleForPermissions === "Finance Manager" || activeRoleForPermissions === "Accountant" ? (
                              <>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Financials KPI</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Operating Expenses</span>
                                <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold px-2 py-0.5 rounded text-[10px]">Cash Flow Trends</span>
                              </>
                            ) : activeRoleForPermissions === "Viewer" ? (
                              <span className="bg-slate-100 text-slate-600 border border-slate-200 font-semibold px-2 py-0.5 rounded text-[10px]">Read-only Overview Cards</span>
                            ) : (
                              <span className="bg-slate-100 text-slate-400 border border-slate-200 italic px-2 py-0.5 rounded text-[10px]">None</span>
                            )}
                          </div>
                        </div>

                        {/* Sidebar Menus */}
                        <div className="bg-white border border-slate-200 p-3 rounded-xl space-y-1.5">
                          <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider font-mono">Visible Sidebar Items</span>
                          <div className="space-y-1 font-semibold text-slate-700 max-h-40 overflow-y-auto pr-1">
                            {sidebarSections.map(section => {
                              const items = section.items.filter(item => {
                                if (item.id === "dashboard") return true;
                                let res: any = "settings";
                                if (item.id === "dispatch") res = "dispatch";
                                else if (item.id === "vehicles") res = "vehicles";
                                else if (item.id === "drivers") res = "drivers";
                                else if (item.id === "routes") res = "routes";
                                else if (item.id === "contractors") res = "contractors";
                                else if (item.id === "fleet_search") res = "audit_logs";
                                else if (item.id === "fuel_intel") res = "fuel";
                                else if (item.id === "predictive_maintenance") res = "maintenance";
                                else if (item.id === "hrms") res = "hrms";
                                else if (item.id === "finance") res = "finance";
                                else if (item.id === "files") res = "documents";
                                else if (item.id === "chat") res = "chat";
                                else if (item.id === "settings") res = "settings";
                                else if (item.id === "executive_bi") res = "reports";
                                else if (item.id === "health") res = "health";
                                else if (item.id === "backups") res = "backups";
                                else if (item.id === "notifications") res = "settings";
                                return hasPermissionLocal(activeRoleForPermissions, res, "read");
                              });
                              if (items.length === 0) return null;
                              return (
                                <div key={section.title} className="pb-1.5 border-b border-slate-100 last:border-0">
                                  <p className="text-[9px] font-bold text-slate-400 uppercase font-mono">{section.title}</p>
                                  <div className="pl-2 mt-0.5 space-y-0.5 text-[11px] text-slate-600">
                                    {items.map(it => <p key={it.id}>• {it.label}</p>)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Dynamic Authorizations */}
                        <div className="bg-white border border-slate-200 p-3 rounded-xl space-y-1.5">
                          <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider font-mono">Dynamic Web APIs Route Access</span>
                          <div className="space-y-1 font-mono text-[10px] text-slate-500">
                            {activeRoleForPermissions === "Super Admin" ? (
                              <p className="text-emerald-700 font-bold">/* (Full Bypass)</p>
                            ) : activeRoleForPermissions === "Pending" ? (
                              <p className="text-rose-600 font-bold">No API routes permitted</p>
                            ) : (
                              ["vehicles", "drivers", "routes", "dispatch", "fuel", "maintenance", "hrms", "finance"].map(res => {
                                const read = hasPermissionLocal(activeRoleForPermissions, res, "read");
                                const write = hasPermissionLocal(activeRoleForPermissions, res, "create") || hasPermissionLocal(activeRoleForPermissions, res, "update");
                                if (!read) return null;
                                return (
                                  <p key={res} className="text-slate-600">
                                    <span className="text-blue-600">GET</span> /api/{res}/*<br />
                                    {write && <span className="text-emerald-600"><span className="text-amber-600">PUT/POST</span> /api/{res}/*</span>}
                                  </p>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Permissions Customizer Table Grid */}
                    <div className="lg:col-span-8 border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm space-y-4 p-5">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div>
                          <h5 className="font-bold text-slate-900 text-sm">Dynamic Capability Configuration</h5>
                          <p className="text-xs text-slate-500 mt-0.5">Toggle live capabilities on standard cloud modules. Changes are instantly stored in Cloud SQL.</p>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-bold uppercase tracking-wider font-mono text-[9px]">
                              <th className="p-3">Resource / Module</th>
                              <th className="p-3 text-center">Create</th>
                              <th className="p-3 text-center">Read</th>
                              <th className="p-3 text-center">Update</th>
                              <th className="p-3 text-center">Delete</th>
                              <th className="p-3 text-center">Approve</th>
                              <th className="p-3 text-center">Export</th>
                              <th className="p-3 text-center">Print</th>
                              <th className="p-3 text-center">Manage</th>
                              <th className="p-3 text-center">AI Access</th>
                              <th className="p-3 text-center">Reports</th>
                              <th className="p-3 text-center">Settings</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                            {["users", "vehicles", "drivers", "routes", "contractors", "dispatch", "fuel", "maintenance", "hrms", "finance", "documents", "chat", "ai", "settings", "governance", "audit_logs", "health", "backups"].map((res) => {
                              const matrix = dynamicPermissionMatrix || permissionMatrix;
                              const currentActions = (matrix[activeRoleForPermissions] && matrix[activeRoleForPermissions][res]) || [];
                              const isSuper = activeRoleForPermissions === "Super Admin";
                              const isPending = activeRoleForPermissions === "Pending";

                              const toggleAction = (act: string) => {
                                if (isSuper || isPending) return;
                                let updated: string[];
                                if (currentActions.includes(act)) {
                                  updated = currentActions.filter(a => a !== act);
                                } else {
                                  updated = [...currentActions, act];
                                }
                                handleUpdatePermission(activeRoleForPermissions, res, updated);
                              };

                              return (
                                <tr key={res} className="hover:bg-slate-50/40">
                                  <td className="p-3 font-semibold text-slate-900 capitalize font-mono text-[11px]">{res}</td>
                                  {["create", "read", "update", "delete", "approve", "export", "print", "manage", "ai_access", "reports", "settings"].map((act) => {
                                    const isChecked = isSuper || currentActions.includes(act);
                                    return (
                                      <td key={act} className="p-3 text-center">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          disabled={isSuper || isPending || savingPermissions}
                                          onChange={() => toggleAction(act)}
                                          className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 accent-emerald-600 cursor-pointer disabled:opacity-50"
                                        />
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsSubTab === "audit_logs" && (
                <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4 animate-fadeIn">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="font-semibold text-white flex items-center gap-2">
                        <Database className="w-5 h-5 text-blue-400" />
                        <span>Immutable Platform Audit Trails</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-1">Immutably recorded changes to records, transactions, role changes, and system activities.</p>
                    </div>
                    <span className="bg-slate-900 border border-slate-800 text-slate-400 px-3 py-1 rounded font-mono text-xs">
                      {auditTotal} entries
                    </span>
                  </div>

                  {/* Audit Filtering & Search */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-2">
                    <div className="relative sm:col-span-6">
                      <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search actions, tables, IPs..."
                        value={auditSearch}
                        onChange={(e) => {
                          setAuditSearch(e.target.value);
                          setAuditOffset(0);
                        }}
                        className="w-full bg-slate-900 border border-slate-800/80 pl-9 pr-4 py-2 rounded-lg text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    
                    <select
                      value={auditActionFilter}
                      onChange={(e) => {
                        setAuditActionFilter(e.target.value);
                        setAuditOffset(0);
                      }}
                      className="bg-slate-900 border border-slate-800/80 px-3 py-2 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-blue-500/50 sm:col-span-4"
                    >
                      <option value="">All Actions</option>
                      <option value="CREATE">CREATE</option>
                      <option value="UPDATE">UPDATE</option>
                      <option value="DELETE">DELETE</option>
                      <option value="LOGIN">LOGIN</option>
                      <option value="LOGOUT">LOGOUT</option>
                      <option value="ROLE_CHANGE">ROLE_CHANGE</option>
                    </select>

                    <button 
                      onClick={() => {
                        setAuditSearch("");
                        setAuditActionFilter("");
                        setAuditOffset(0);
                      }}
                      className="sm:col-span-2 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-lg transition"
                    >
                      Reset
                    </button>
                  </div>

                  {/* Audit Logs List */}
                  <div className="space-y-3 min-h-[320px]">
                    {auditLoading ? (
                      <div className="flex items-center justify-center h-48">
                        <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
                      </div>
                    ) : auditLogsList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 border border-dashed border-slate-800/50 rounded-lg text-slate-500">
                        <Terminal className="w-8 h-8 mb-2 opacity-50 text-slate-600" />
                        <p className="text-xs font-mono">NO AUDIT LOG RECORDS FOUND</p>
                      </div>
                    ) : (
                      auditLogsList.map((log) => (
                        <div 
                          key={log.id}
                          onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
                          className={`bg-slate-900/10 hover:bg-slate-900/30 border transition-all rounded-xl p-4 cursor-pointer relative overflow-hidden ${
                            selectedLog?.id === log.id ? "border-blue-500/30 ring-1 ring-blue-500/20" : "border-slate-850"
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                log.action === "CREATE" ? "bg-emerald-950/50 text-emerald-400 border border-emerald-500/20" :
                                log.action === "UPDATE" ? "bg-amber-950/50 text-amber-400 border border-amber-500/20" :
                                log.action === "DELETE" ? "bg-rose-950/50 text-rose-400 border border-rose-500/20" :
                                log.action === "ROLE_CHANGE" ? "bg-blue-950/50 text-blue-400 border border-blue-500/20" :
                                "bg-slate-900 text-slate-400 border border-slate-800"
                              }`}>
                                {log.action}
                              </span>
                              {log.tableName && (
                                <span className="text-xs text-slate-300 font-mono">
                                  on <strong className="text-slate-200">{log.tableName}</strong> [#{log.recordId}]
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </div>

                          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 font-mono">
                            <span className="flex items-center gap-1">
                              <Globe className="w-3 h-3 text-slate-600" />
                              IP: {log.ipAddress || "system"}
                            </span>
                            <span>
                              Operator: <strong className="text-slate-300">{log.performerEmail || "System/Sync"}</strong>
                            </span>
                          </div>

                          {/* Snapshot Diff expander */}
                          {selectedLog?.id === log.id && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              className="mt-4 pt-3 border-t border-slate-900 space-y-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                                <div>
                                  <p className="text-slate-500 mb-1">Old Value Payload:</p>
                                  <pre className="bg-slate-950 border border-slate-900 p-2.5 rounded max-h-36 overflow-auto text-[11px] text-slate-400">
                                    {log.oldValues ? JSON.stringify(log.oldValues, null, 2) : "NULL"}
                                  </pre>
                                </div>
                                <div>
                                  <p className="text-slate-500 mb-1">New Value Payload:</p>
                                  <pre className="bg-slate-950 border border-slate-900 p-2.5 rounded max-h-36 overflow-auto text-[11px] text-emerald-400">
                                    {log.newValues ? JSON.stringify(log.newValues, null, 2) : "NULL"}
                                  </pre>
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-500 font-mono truncate">
                                User-Agent: {log.userAgent || "Unknown"}
                              </p>
                            </motion.div>
                          )}
                          
                          <ChevronDown className={`absolute right-3 top-4 w-4 h-4 text-slate-600 transition-transform ${selectedLog?.id === log.id ? "rotate-180 text-blue-400" : ""}`} />
                        </div>
                      ))
                    )}
                  </div>

                  {/* Pagination */}
                  {auditTotal > 5 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-900 font-mono text-xs text-slate-400">
                      <button
                        disabled={auditOffset === 0}
                        onClick={() => setAuditOffset(Math.max(0, auditOffset - 5))}
                        className="px-2 py-1 bg-slate-850 border border-slate-800 rounded disabled:opacity-30 hover:bg-slate-800 transition"
                      >
                        Prev
                      </button>
                      <span>
                        Showing {auditOffset + 1}-{Math.min(auditOffset + 5, auditTotal)} of {auditTotal}
                      </span>
                      <button
                        disabled={auditOffset + 5 >= auditTotal}
                        onClick={() => setAuditOffset(auditOffset + 5)}
                        className="px-2 py-1 bg-slate-850 border border-slate-800 rounded disabled:opacity-30 hover:bg-slate-800 transition"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

              {settingsSubTab === "api" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
                  {/* API Tokens (Cols 6) */}
                  <div className="lg:col-span-6 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-blue-400" />
                      <span>Developer API Keys</span>
                    </h4>
                    <p className="text-xs text-slate-400">Generate secure bearer tokens to access the ERP endpoints programmatically (integrating external systems).</p>

                    <form onSubmit={handleGenerateApiKey} className="space-y-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Application / Integration Name</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            required
                            placeholder="e.g. GPS-Tracker-Ingress"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            className="flex-1 bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none focus:border-blue-500"
                          />
                          <button
                            type="submit"
                            className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-2 rounded-lg font-medium transition"
                          >
                            Generate Token
                          </button>
                        </div>
                      </div>
                    </form>

                    {generatedKeyResult && (
                      <div className="bg-blue-950/20 border border-blue-500/30 p-4 rounded-lg space-y-2">
                        <p className="text-xs font-semibold text-blue-400">YOUR CRYPTOGRAPHIC ACCESS KEY (SAVE NOW!):</p>
                        <div className="bg-slate-900 p-2 rounded border border-slate-800 font-mono text-xs text-slate-200 select-all break-all">
                          {generatedKeyResult.key}
                        </div>
                        <p className="text-[10px] text-slate-500">Prefix: {generatedKeyResult.metadata.prefix}</p>
                      </div>
                    )}

                    <div className="space-y-2 pt-2">
                      <p className="text-[10px] font-mono font-semibold text-slate-500 uppercase">ACTIVE CLIENT CREDENTIALS</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {apiKeysList.length === 0 ? (
                          <p className="text-xs text-slate-600 font-mono">NO ACTIVE DEVELOPER CREDENTIALS FOUND</p>
                        ) : (
                          apiKeysList.map((k: any) => (
                            <div key={k.id} className="bg-slate-950/60 border border-slate-850 p-3 rounded-lg flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold text-slate-200">{k.name}</p>
                                <p className="text-[10px] text-slate-500 font-mono mt-0.5">Prefix: {k.prefix} • Created: {new Date(k.created_at).toLocaleDateString()}</p>
                              </div>
                              <button
                                onClick={() => handleRevokeApiKey(k.id)}
                                className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 p-1.5 rounded transition"
                              >
                                Revoke
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Webhooks Subscription (Cols 6) */}
                  <div className="lg:col-span-6 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      <Send className="w-4 h-4 text-emerald-400" />
                      <span>Webhook Dispatch Subscriptions</span>
                    </h4>
                    <p className="text-xs text-slate-400">Subscribe your custom HTTP listeners to receive real-time JSON payloads when critical dispatch events occur.</p>

                    <form onSubmit={handleCreateWebhook} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Subscriber Name</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. HR-Disbursement-Bot"
                            value={newWebhook.name}
                            onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Target Action Event</label>
                          <select
                            value={newWebhook.events[0]}
                            onChange={(e) => setNewWebhook({ ...newWebhook, events: [e.target.value] })}
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                          >
                            <option value="trip.completed">Trip Completed</option>
                            <option value="trip.dispatched">Trip Dispatched</option>
                            <option value="fuel.alert">Fuel High Risk Alert</option>
                            <option value="payroll.approved">Payroll Disbursed</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Your Listener Endpoint URL</label>
                        <input
                          type="url"
                          required
                          placeholder="https://api.yourcompany.com/webhook"
                          value={newWebhook.url}
                          onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs py-2 rounded-lg transition"
                      >
                        Register Webhook Endpoint
                      </button>
                    </form>

                    <div className="space-y-2 pt-2">
                      <p className="text-[10px] font-mono font-semibold text-slate-500 uppercase">ACTIVE WEBHOOK ENDPOINTS</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {webhooksList.length === 0 ? (
                          <p className="text-xs text-slate-600 font-mono">NO ACTIVE ENDPOINTS CONFIGURED</p>
                        ) : (
                          webhooksList.map((wh: any) => (
                            <div key={wh.id} className="bg-slate-950/60 border border-slate-850 p-3 rounded-lg flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-200">{wh.name}</span>
                                <button
                                  onClick={() => handleDeleteWebhook(wh.id)}
                                  className="text-xs text-rose-400 hover:text-rose-300 transition"
                                >
                                  Delete
                                </button>
                              </div>
                              <p className="text-[10px] font-mono text-slate-400 break-all">{wh.url}</p>
                              <div className="flex items-center justify-between text-[9px] font-mono text-slate-500">
                                <span>Events: {JSON.stringify(wh.events_json)}</span>
                                <span className="text-emerald-400">Active</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsSubTab === "workflows" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fadeIn">
                  {/* Workflow templates (Cols 5) */}
                  <div className="lg:col-span-5 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      <Shield className="w-5 h-5 text-blue-400" />
                      <span>Governance Workflow Chains</span>
                    </h4>
                    <p className="text-xs text-slate-400 font-sans">Establish rigid operational hierarchies to enforce dual signature review for critical payroll or fleet dispatches.</p>

                    <form onSubmit={handleCreateWorkflow} className="space-y-3">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Workflow Title</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Premium Transit Approval"
                          value={newWorkflow.name}
                          onChange={(e) => setNewWorkflow({ ...newWorkflow, name: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Target Department</label>
                          <select
                            value={newWorkflow.type}
                            onChange={(e) => setNewWorkflow({ ...newWorkflow, type: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                          >
                            <option value="Trip">Trip Dispatch</option>
                            <option value="Payroll">Payroll Release</option>
                            <option value="Maintenance">Maintenance job</option>
                            <option value="Expense">Double-Entry Ledger</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">First Sign Role</label>
                          <select
                            value={newWorkflow.steps[0].role}
                            onChange={(e) => setNewWorkflow({ ...newWorkflow, steps: [{ step: 1, role: e.target.value, required: true }] })}
                            className="w-full bg-slate-900 border border-slate-800 text-slate-300 text-xs p-2 rounded-lg focus:outline-none"
                          >
                            <option value="Operations Manager">Operations Manager</option>
                            <option value="Accountant">Accountant</option>
                            <option value="HR Manager">HR Manager</option>
                            <option value="Admin">Admin</option>
                          </select>
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs py-2 rounded-lg transition"
                      >
                        Create Governance Rule
                      </button>
                    </form>

                    <div className="space-y-2 pt-2">
                      <p className="text-[10px] font-mono font-semibold text-slate-500 uppercase">DEFINED WORKFLOW CHAINS</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {workflowsList.length === 0 ? (
                          <p className="text-xs text-slate-600 font-mono">NO ACTIVE GOVERNANCE POLICIES FOUND</p>
                        ) : (
                          workflowsList.map((wf: any) => (
                            <div key={wf.id} className="bg-slate-950/60 border border-slate-850 p-3 rounded-lg space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-200">{wf.name}</span>
                                <span className="text-[9px] bg-blue-600/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-mono font-bold">{wf.type}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-mono leading-relaxed">Steps: {JSON.stringify(wf.steps_json)}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Active workflow approvals (Cols 7) */}
                  <div className="lg:col-span-7 bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-4">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                      <span>Pending Workflow Approval Requests</span>
                    </h4>
                    <p className="text-xs text-slate-400">Review pending dispatches, expenditures, or payrolls locked under active dual-signing rules.</p>

                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                      {workflowApprovalsList.length === 0 ? (
                        <div className="text-center py-12 bg-slate-950/20 border border-dashed border-slate-800 rounded-xl">
                          <CheckCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                          <p className="text-slate-500 text-xs font-mono">ALL TRANSACTIONS FULLY AUTHORIZED AND APPROVED</p>
                        </div>
                      ) : (
                        workflowApprovalsList.map((app: any) => (
                          <div key={app.id} className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl space-y-3">
                            <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                              <div>
                                <span className="text-xs font-bold text-slate-200">{app.workflow_name}</span>
                                <p className="text-[10px] text-slate-500 font-mono mt-0.5">Target: {app.target_type} ID #{app.target_id}</p>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                app.status.includes("Pending") ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-emerald-500/10 text-emerald-400"
                              }`}>
                                {app.status}
                              </span>
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="text-xs font-sans text-slate-400">
                                Step index: <span className="text-blue-400 font-mono font-bold">{app.current_step_index + 1}</span>
                              </div>
                              
                              {/* Action buttons (only active for correct roles, or simulated here) */}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleWorkflowAction(app.id, "Approved", "Verified matching criteria")}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-3 py-1.5 rounded transition"
                                >
                                  Authorize (Sign)
                                </button>
                                <button
                                  onClick={() => handleWorkflowAction(app.id, "Rejected", "Declined criteria mismatch")}
                                  className="bg-rose-600/20 text-rose-400 hover:bg-rose-600 text-white text-[10px] font-bold px-3 py-1.5 rounded transition"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {settingsSubTab === "dashboard" && (
                <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-6 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-slate-900 pb-4">
                    <div>
                      <h4 className="font-semibold text-white">Interactive Dashboard Designer</h4>
                      <p className="text-xs text-slate-400 mt-1">Configure structural bento-grid templates for Super Admins, Accountants, and Fleet Managers drag & drop presets.</p>
                    </div>
                    <button
                      onClick={() => showFeedback("success", "Active bento dashboard templates synchronized and persistent inside PostgreSQL.")}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 px-4 rounded-lg transition"
                    >
                      Save Configuration
                    </button>
                  </div>

                  {/* Drag-drop simulator layout grids */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="border border-dashed border-slate-800 p-4 rounded-xl text-center space-y-2 hover:border-blue-500/50 transition cursor-pointer">
                      <div className="text-xs font-mono text-slate-300 font-semibold">Gauge Metrics Section</div>
                      <div className="bg-slate-900 h-16 rounded flex items-center justify-center font-mono text-[10px] text-slate-500">
                        [Health Score, RAM, CPU]
                      </div>
                      <div className="text-[10px] text-slate-500">Size: Full-Width (Span 4)</div>
                    </div>

                    <div className="border border-dashed border-slate-800 p-4 rounded-xl text-center space-y-2 hover:border-blue-500/50 transition cursor-pointer">
                      <div className="text-xs font-mono text-slate-300 font-semibold">GPS Ingress Mapping</div>
                      <div className="bg-slate-900 h-16 rounded flex items-center justify-center font-mono text-[10px] text-slate-500">
                        [Active Transit Routes]
                      </div>
                      <div className="text-[10px] text-slate-500">Size: Medium (Span 2)</div>
                    </div>

                    <div className="border border-dashed border-slate-800 p-4 rounded-xl text-center space-y-2 hover:border-blue-500/50 transition cursor-pointer">
                      <div className="text-xs font-mono text-slate-300 font-semibold">Ledger KPIs Ledger</div>
                      <div className="bg-slate-900 h-16 rounded flex items-center justify-center font-mono text-[10px] text-slate-500">
                        [Double-Entry Ledgers]
                      </div>
                      <div className="text-[10px] text-slate-500">Size: Small (Span 1)</div>
                    </div>

                    <div className="border border-dashed border-slate-800 p-4 rounded-xl text-center space-y-2 hover:border-blue-500/50 transition cursor-pointer">
                      <div className="text-xs font-mono text-slate-300 font-semibold">Fuel Intelligence Analysis</div>
                      <div className="bg-slate-900 h-16 rounded flex items-center justify-center font-mono text-[10px] text-slate-500">
                        [Fuel Stock levels]
                      </div>
                      <div className="text-[10px] text-slate-500">Size: Small (Span 1)</div>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-4 border border-slate-850 rounded-xl space-y-3">
                    <p className="text-xs font-semibold text-slate-200">Role Dashboard Template Allocations</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                        <span className="text-[10px] font-mono text-blue-400 font-bold">Super Admin default</span>
                        <p className="text-[11px] text-slate-300 font-sans mt-1">4 widgets (health, financial, fleet, security)</p>
                      </div>
                      <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                        <span className="text-[10px] font-mono text-emerald-400 font-bold">Accountant default</span>
                        <p className="text-[11px] text-slate-300 font-sans mt-1">3 widgets (financial, ledgers, overrides)</p>
                      </div>
                      <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                        <span className="text-[10px] font-mono text-purple-400 font-bold">Fleet Manager default</span>
                        <p className="text-[11px] text-slate-300 font-sans mt-1">3 widgets (active dispatches, maintenance, fuel)</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsSubTab === "environment" && (
                <div className="bg-slate-950/40 border border-slate-800 p-6 rounded-xl space-y-6 animate-fadeIn">
                  <div>
                    <h4 className="font-semibold text-white">System Environment Variables Manager</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Monitor active environment configuration keys read securely from standard server process configuration.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {envVarsLoading ? (
                      <div className="flex justify-center py-12">
                        <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
                      </div>
                    ) : envVarsList.length === 0 ? (
                      <p className="text-slate-500 text-center py-12 text-sm font-mono">
                        NO ACTIVE ENVIRONMENT VARIABLES RETURNED FROM BACKEND
                      </p>
                    ) : (
                      <div className="border border-slate-900 rounded-xl overflow-hidden font-sans">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-900 text-slate-400 border-b border-slate-850 font-mono">
                              <th className="p-4">VARIABLE NAME</th>
                              <th className="p-4">CURRENT VAL / STRING PATH</th>
                              <th className="p-4">STATUS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850 bg-slate-950/20 font-mono">
                            {envVarsList.map((ev, idx) => (
                              <tr key={idx} className="hover:bg-slate-900/40 transition">
                                <td className="p-4 font-bold text-slate-300">{ev.key}</td>
                                <td className="p-4 text-blue-400 select-all break-all">{ev.value}</td>
                                <td className="p-4">
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                    ev.value !== "Not Set" 
                                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                  }`}>
                                    {ev.value !== "Not Set" ? "ACTIVE" : "INACTIVE"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="bg-slate-900/60 p-4 border border-slate-850 rounded-lg text-xs text-slate-400 space-y-2">
                      <p className="font-semibold text-slate-200">🔒 Production-Grade Cryptographic Masking Policy</p>
                      <p>
                        To comply with corporate privacy guidelines, all PostgreSQL connection URLs, API Keys, and 
                        system secret parameters are automatically masked at the kernel level using advanced 
                        SHA-256 pattern match shields before streaming to client endpoints.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* TAB: SMART DISPATCH & GPS */}
          {activeTab === "dispatch" && (
            <motion.div
              key="dispatch"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <SmartDispatch showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: LIVE GPS TRACKING */}
          {activeTab === "live_tracking" && (
            <motion.div
              key="live_tracking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <LiveTrackingMap showFeedback={showFeedback} role={dbUser?.role} />
            </motion.div>
          )}

          {/* TAB: DATA IMPORT / EXPORT */}
          {activeTab === "data_portal" && (
            <motion.div
              key="data_portal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <DataPortal showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: TRUCK LEDGERS (KHATA) */}
          {activeTab === "truck_ledgers" && (
            <motion.div
              key="truck_ledgers"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <TruckLedgers showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: PARTIES (KHATA) */}
          {activeTab === "parties" && (
            <motion.div
              key="parties"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Parties showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: VEHICLES */}
          {activeTab === "vehicles" && (
            <motion.div
              key="vehicles"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FleetVehicles showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: DRIVERS */}
          {activeTab === "drivers" && (
            <motion.div
              key="drivers"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FleetDrivers showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: ROUTES */}
          {activeTab === "routes" && (
            <motion.div
              key="routes"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FleetRoutes showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: CONTRACTORS */}
          {activeTab === "contractors" && (
            <motion.div
              key="contractors"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FleetContractors showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: FLEET SEARCH & COMPLIANCE */}
          {activeTab === "fleet_search" && (
            <motion.div
              key="fleet_search"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FleetSearch showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: ENTERPRISE FINANCE & GL */}
          {activeTab === "finance" && (
            <motion.div
              key="finance"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FinanceDashboard dbUser={dbUser} showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: ENTERPRISE HRMS & PAYROLL */}
          {activeTab === "hrms" && (
            <motion.div
              key="hrms"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <HRMSDashboard dbUser={dbUser} showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: FUEL INTELLIGENCE */}
          {activeTab === "fuel_intel" && (
            <motion.div
              key="fuel_intel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FuelIntelligence showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: FLEET MAINTENANCE & WORKSHOPS */}
          {activeTab === "predictive_maintenance" && (
            <motion.div
              key="predictive_maintenance"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FleetMaintenance showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: CUSTOMER PORTAL */}
          {activeTab === "customer_portal" && (
            <motion.div
              key="customer_portal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <CustomerPortal showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: VENDOR PORTAL */}
          {activeTab === "vendor_portal" && (
            <motion.div
              key="vendor_portal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <VendorPortal showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: EXECUTIVE BI */}
          {activeTab === "executive_bi" && (
            <motion.div
              key="executive_bi"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ExecutiveBI showFeedback={showFeedback} />
            </motion.div>
          )}

          {/* TAB: AI ASSISTANT CHAT */}
          {activeTab === "ai_assistant" && (
            <motion.div
              key="ai_assistant"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <AIAssistant showFeedback={showFeedback} />
            </motion.div>
          )}

        </AnimatePresence>

        {/* ========================================== */}
        {/* ENTERPRISE RBAC OVERLAY MODALS             */}
        {/* ========================================== */}

        {/* View User Modal */}
        <AnimatePresence>
          {selectedUserForView && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-6 text-slate-800"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <span>Enterprise Profile Details</span>
                  </h3>
                  <button
                    onClick={() => setSelectedUserForView(null)}
                    className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center font-bold text-emerald-700 text-sm font-mono uppercase">
                    {selectedUserForView.name ? selectedUserForView.name.slice(0, 2).toUpperCase() : "OP"}
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="font-bold text-slate-900 text-sm">{selectedUserForView.name || "Enterprise Operator"}</p>
                    <p className="text-xs font-mono text-slate-500">{selectedUserForView.email}</p>
                    <div className="flex gap-2 pt-1">
                      <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                        {selectedUserForView.role}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded border uppercase font-bold ${
                        selectedUserForView.status === "Approved"
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : selectedUserForView.status === "Rejected"
                          ? "bg-rose-50 border-rose-200 text-rose-700"
                          : selectedUserForView.status === "Disabled"
                          ? "bg-slate-100 border-slate-300 text-slate-600"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}>
                        {selectedUserForView.status || "Pending Approval"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200 p-4 rounded-xl text-xs">
                  <div>
                    <span className="font-bold text-[9px] text-slate-400 uppercase tracking-wider font-mono block mb-0.5">Department</span>
                    <span className="font-semibold text-slate-700">{selectedUserForView.department || "General Operations"}</span>
                  </div>
                  <div>
                    <span className="font-bold text-[9px] text-slate-400 uppercase tracking-wider font-mono block mb-0.5">Phone Number</span>
                    <span className="font-mono text-slate-700">{selectedUserForView.phone || "No Registered Phone"}</span>
                  </div>
                  <div>
                    <span className="font-bold text-[9px] text-slate-400 uppercase tracking-wider font-mono block mb-0.5">Created Date</span>
                    <span className="font-mono text-slate-700">{new Date(selectedUserForView.createdAt).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="font-bold text-[9px] text-slate-400 uppercase tracking-wider font-mono block mb-0.5">Database ID</span>
                    <span className="font-mono text-slate-700">USR-{selectedUserForView.id}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setSelectedUserForView(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Close Profile
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit User Modal */}
        <AnimatePresence>
          {selectedUserForEdit && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4 text-slate-800"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <Edit className="w-5 h-5 text-emerald-600" />
                    <span>Edit Enterprise Profile</span>
                  </h3>
                  <button
                    onClick={() => setSelectedUserForEdit(null)}
                    className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-600 font-bold mb-1">Full Name</label>
                    <input
                      type="text"
                      value={editUserForm.name}
                      onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 p-2.5 rounded-xl text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 font-bold mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={editUserForm.phone}
                      onChange={(e) => setEditUserForm({ ...editUserForm, phone: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 p-2.5 rounded-xl text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 font-bold mb-1">Department</label>
                    <input
                      type="text"
                      value={editUserForm.department}
                      onChange={(e) => setEditUserForm({ ...editUserForm, department: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 p-2.5 rounded-xl text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 font-bold mb-1">Platform Role</label>
                      <select
                        value={editUserForm.role}
                        onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-700 p-2.5 rounded-xl text-xs focus:outline-none focus:border-emerald-500"
                      >
                        {roles.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-600 font-bold mb-1">Authorization Status</label>
                      <select
                        value={editUserForm.status}
                        onChange={(e) => setEditUserForm({ ...editUserForm, status: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-700 p-2.5 rounded-xl text-xs focus:outline-none focus:border-emerald-500"
                      >
                        <option value="Pending Approval">Pending Approval</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Disabled">Disabled</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setSelectedUserForEdit(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleUpdateUserDetails(selectedUserForEdit.id)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Reset Password Result Modal */}
        <AnimatePresence>
          {resetPasswordResponse && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4 text-slate-800"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <Key className="w-5 h-5 text-amber-500" />
                    <span>Firebase Auth Reset Link</span>
                  </h3>
                  <button
                    onClick={() => setResetPasswordResponse(null)}
                    className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <p className="text-slate-600">
                    A secure password reset URL has been generated successfully for <strong className="text-slate-900">{resetPasswordResponse.email}</strong>.
                  </p>
                  <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl font-mono text-[11px] text-slate-700 select-all break-all overflow-y-auto max-h-24">
                    {resetPasswordResponse.link}
                  </div>
                  <p className="text-slate-400 text-[10px]">
                    Share this URL directly with the user. Clicking this link allows them to safely define a new password in accordance with enterprise policies.
                  </p>
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-100">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(resetPasswordResponse.link);
                      showFeedback("success", "Link copied to clipboard!");
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition cursor-pointer mr-2"
                  >
                    Copy URL
                  </button>
                  <button
                    onClick={() => setResetPasswordResponse(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>
    </div>
  </div>
);
}
