import { ENV_MAINTENANCE_MODE } from "@/lib/env";
import { getBoolSetting, setBoolSetting } from "@/lib/appSettings";

type MaintenanceError = Error & { status?: number; code?: string };
export type MaintenanceSource = "env" | "db" | "env+db";

const MAINTENANCE_KEY = "maintenance_mode";

export async function getMaintenanceSetting() {
  const dbMode = await getBoolSetting(MAINTENANCE_KEY, false);

  if (ENV_MAINTENANCE_MODE) {
    return {
      maintenanceMode: true,
      source: dbMode ? ("env+db" as MaintenanceSource) : ("env" as MaintenanceSource),
      updatedAt: null as Date | null,
    };
  }

  return {
    maintenanceMode: dbMode,
    source: "db" as MaintenanceSource,
    updatedAt: null as Date | null,
  };
}

export async function isMaintenanceMode(): Promise<boolean> {
  const setting = await getMaintenanceSetting();
  return setting.maintenanceMode;
}

export async function setMaintenanceMode(value: boolean) {
  const dbMode = await setBoolSetting(MAINTENANCE_KEY, value);
  return {
    maintenanceMode: ENV_MAINTENANCE_MODE || dbMode,
    updatedAt: null as Date | null,
  };
}

export async function assertNotInMaintenance(): Promise<void> {
  if (!(await isMaintenanceMode())) return;

  const err = new Error("Servicio en mantenimiento. Intenta de nuevo en unos minutos.") as MaintenanceError;
  err.status = 503;
  err.code = "MAINTENANCE";
  throw err;
}
