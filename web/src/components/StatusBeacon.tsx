interface StatusBeaconProps {
  tone: "active" | "progress" | "critical" | "neutral";
  label: string;
  pulse?: boolean;
}

const TONE_STYLES: Record<StatusBeaconProps["tone"], { dot: string; ring: string; text: string }> = {
  active: { dot: "bg-status-active", ring: "ring-status-active/25", text: "text-status-active" },
  progress: { dot: "bg-status-progress", ring: "ring-status-progress/25", text: "text-status-progress" },
  critical: { dot: "bg-status-critical", ring: "ring-status-critical/25", text: "text-status-critical" },
  neutral: { dot: "bg-ink-faint", ring: "ring-ink-faint/20", text: "text-ink-secondary" },
};

// The app's signature element: a small beacon light, echoing the rotating
// warning beacons on the vehicles this system tracks. Used consistently for
// every status readout — equipment, faults, alerts — so a user learns the
// vocabulary once and reads it everywhere.
export function StatusBeacon({ tone, label, pulse }: StatusBeaconProps) {
  const styles = TONE_STYLES[tone];
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`relative flex h-2.5 w-2.5 items-center justify-center rounded-full ring-4 ${styles.ring}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${styles.dot} ${pulse ? "animate-pulse" : ""}`} />
      </span>
      <span className={`text-sm font-medium ${styles.text}`}>{label}</span>
    </span>
  );
}

export function equipmentStatusTone(status: string): StatusBeaconProps["tone"] {
  if (status === "active") return "active";
  if (status === "grounded") return "critical";
  if (status === "under_maintenance") return "progress";
  return "neutral";
}

export function faultStatusTone(status: string): StatusBeaconProps["tone"] {
  if (status === "open") return "critical";
  if (status === "in_progress") return "progress";
  if (status === "resolved") return "active";
  return "neutral";
}

export function severityTone(severity: string): StatusBeaconProps["tone"] {
  return severity === "critical" ? "critical" : "progress";
}
