import { Server as SocketIOServer, Socket } from "socket.io";
import { LoggerService } from "../logger/logger.ts";
import { db } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { eq } from "drizzle-orm";

export class SocketServer {
  private static io: SocketIOServer | null = null;
  private static connectedUsers = new Map<string, { socketId: string; user: any }>();

  public static getActiveConnectionsCount(): number {
    return this.connectedUsers.size;
  }

  public static init(httpServer: any) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    console.log("[SocketServer] Real-time communication layer initialized");

    this.io.on("connection", (socket: Socket) => {
      const email = socket.handshake.query.email as string;
      const userId = socket.handshake.query.userId as string;

      if (email) {
        // Query PostgreSQL database directly to retrieve the immutable true role and user ID
        db.select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
          .then((dbUsers) => {
            const dbUserObj = dbUsers[0];
            const resolvedRole = dbUserObj ? dbUserObj.role : "Pending";
            const resolvedId = dbUserObj ? dbUserObj.id : (userId ? parseInt(userId) : null);

            this.connectedUsers.set(email, {
              socketId: socket.id,
              user: { id: resolvedId, email, role: resolvedRole },
            });
            
            console.log(`[SocketServer] User connected: ${email} (Role resolved from PostgreSQL: ${resolvedRole})`);
            this.broadcastConnectedUsers();
          })
          .catch((err) => {
            console.error(`[SocketServer] Database error looking up role for ${email}:`, err);
            this.connectedUsers.set(email, {
              socketId: socket.id,
              user: { id: userId ? parseInt(userId) : null, email, role: "Pending" },
            });
            this.broadcastConnectedUsers();
          });
      }

      // Handle custom chat and typing events
      socket.on("chat:join_room", (roomId: string) => {
        socket.join(`room:${roomId}`);
        console.log(`[SocketServer] Socket ${socket.id} joined chat room:${roomId}`);
      });

      socket.on("chat:typing", (data: { roomId: string; email: string; typing: boolean }) => {
        socket.to(`room:${data.roomId}`).emit("chat:typing", data);
      });

      socket.on("disconnect", () => {
        if (email) {
          this.connectedUsers.delete(email);
          console.log(`[SocketServer] User disconnected: ${email}`);
          this.broadcastConnectedUsers();
        }
      });
    });
  }

  /**
   * Close all sockets and the io server (graceful shutdown).
   */
  public static close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.io) return resolve();
      this.io.close(() => {
        this.io = null;
        this.connectedUsers.clear();
        resolve();
      });
    });
  }

  /**
   * Broadcasts the list of currently connected online users to everyone
   */
  private static broadcastConnectedUsers() {
    if (!this.io) return;
    const usersList = Array.from(this.connectedUsers.values()).map(cu => cu.user);
    this.io.emit("system:connected_users", usersList);
  }

  /**
   * Generic emit wrapper to send events to all connected clients
   */
  public static emit(event: string, payload: any) {
    if (!this.io) {
      console.warn("[SocketServer] Socket.io not initialized. Skipping real-time broadcast:", event);
      return;
    }
    this.io.emit(event, payload);
  }

  /**
   * Emit an event specifically to a chat room
   */
  public static emitToRoom(room: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(room).emit(event, payload);
  }

  /**
   * Expose online status of users
   */
  public static isUserOnline(email: string): boolean {
    return this.connectedUsers.has(email);
  }

  /**
   * Real-time events support:
   * vehicle_moved, gps_updated, trip_started, etc.
   */
  public static broadcastVehicleMoved(data: { vehicleId: number; lat: number; lng: number; speed: number }) {
    this.emit("vehicle:moved", data);
  }

  public static broadcastGpsUpdated(data: { vehicleId: number; lastGpsTime: string }) {
    this.emit("gps:updated", data);
  }

  public static broadcastTripStarted(data: { tripId: number; vehicleId: number; driverName: string }) {
    this.emit("trip:started", data);
  }

  public static broadcastTripCompleted(data: { tripId: number; routeName: string }) {
    this.emit("trip:completed", data);
  }

  public static broadcastDriverAssigned(data: { tripId: number; driverId: number; driverName: string }) {
    this.emit("driver:assigned", data);
  }

  public static broadcastInvoiceGenerated(data: { invoiceId: number; amount: number; customerName: string }) {
    this.emit("invoice:generated", data);
  }

  public static broadcastMaintenanceReminder(data: { vehicleId: number; description: string; dueDate: string }) {
    this.emit("maintenance:reminder", data);
  }

  public static broadcastEmergencyAlert(data: { vehicleId: number; alertType: string; lat: number; lng: number }) {
    this.emit("emergency:alert", data);
  }

  public static broadcastNewChatMessage(roomId: number, message: any) {
    this.emitToRoom(`room:${roomId}`, "chat:message", message);
    this.emit("chat:global_message", { roomId, message });
  }

  public static broadcastLiveDashboardUpdate(stats: any) {
    this.emit("dashboard:update", stats);
  }

  public static broadcastNotification(userId: number | null, notification: any) {
    this.emit("notification:new", { userId, notification });
  }
}
