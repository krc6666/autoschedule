export interface ApplicationPreferences {
  loadScheduleDate(): string | null;
  saveScheduleDate(date: string): void;
  loadScheduleZoom(): number | null;
  saveScheduleZoom(zoom: number): void;
}
