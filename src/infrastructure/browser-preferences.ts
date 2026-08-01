import type { ApplicationPreferences } from "../app/application-preferences";

const SCHEDULE_DATE_KEY = "autoschedule.scheduleDate";
const SCHEDULE_ZOOM_KEY = "autoschedule.scheduleZoom";

export function createBrowserPreferences(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage
): ApplicationPreferences {
  return {
    loadScheduleDate: () => storage.getItem(SCHEDULE_DATE_KEY),
    saveScheduleDate: (date) => storage.setItem(SCHEDULE_DATE_KEY, date),
    loadScheduleZoom: () => {
      const value = Number(storage.getItem(SCHEDULE_ZOOM_KEY));
      return Number.isFinite(value) && value > 0 ? value : null;
    },
    saveScheduleZoom: (zoom) =>
      storage.setItem(SCHEDULE_ZOOM_KEY, String(zoom)),
  };
}
