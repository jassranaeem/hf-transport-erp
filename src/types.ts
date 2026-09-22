export interface DbUser {
  id: number;
  uid: string;
  email: string;
  name: string | null;
  role: string;
  status?: string;
  phone?: string | null;
  department?: string | null;
  authProvider?: string;
  requestedRole?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: number;
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "ROLE_CHANGE";
  tableName: string | null;
  recordId: number | null;
  oldValues: any;
  newValues: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  performedBy: number | null;
  performerEmail: string | null;
  performerName: string | null;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  service: string;
  version: string;
}

export interface Branch {
  id: number;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  createdAt: string;
}

export interface SystemSetting {
  id: number;
  key: string;
  value: any;
  createdAt: string;
  updatedAt: string;
}

export interface FileStorage {
  id: number;
  name: string;
  mimeType: string | null;
  size: number | null;
  path: string;
  category: string;
  version: number;
  parentId: number | null;
  createdAt: string;
}

export interface Notification {
  id: number;
  userId: number | null;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  channel: string;
  createdAt: string;
}

export interface ChatRoom {
  id: number;
  name: string | null;
  type: "one-to-one" | "group";
  module: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  roomId: number;
  userId: number;
  message: string | null;
  fileId: number | null;
  isRead: boolean;
  createdAt: string;
  senderEmail?: string;
  senderName?: string;
}

export interface EnterpriseHealth {
  cpuUsage: string;
  ramUsage: string;
  diskUsage: string;
  databaseStatus: "ONLINE" | "OFFLINE";
  redisStatus: string;
  socketStatus: string;
  queueStatus: string;
  apiStatus: string;
  emailStatus: string;
  whatsAppStatus: string;
  gpsStatus: string;
  cloudSqlStatus: "CONNECTED" | "DISCONNECTED";
  lastBackup: string;
  appVersion: string;
  systemUptime: string;
  healthScore: number;
  latencyMs: number;
}

