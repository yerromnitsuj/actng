import { useRef, useState } from "react";
import { api } from "../api/client.js";
import { useStore } from "../state/store.js";
import { Button } from "./ui.js";

/**
 * Claims and exposure imports. Claims imports REPLACE the project's loss run
 * (a loss run is a point-in-time extract); the copy says so plainly.
 */
export default function ImportPanel({ projectId }: { projectId: string }) {
  const loadWorkspace = useStore((s) => s.loadWorkspace);
  const loadProjects = useStore((s) => s.loadProjects);
  const [busy, setBusy] = useState<"claims" | "exposures" | "rates" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const claimsInput = useRef<HTMLInputElement>(null);
  const exposuresInput = useRef<HTMLInputElement>(null);
  const ratesInput = useRef<HTMLInputElement>(null);

  const handle = async (kind: "claims" | "exposures" | "rates", file: File) => {
    setBusy(kind);
    setError(null);
    setStatus(null);
    try {
      if (kind === "claims") {
        const result = await api.importClaims(projectId, file);
        setStatus(
          `Imported ${result.imported.toLocaleString()} snapshot rows (${result.claimCount.toLocaleString()} claims). Existing claim data was replaced.`,
        );
      } else if (kind === "exposures") {
        const result = await api.importExposures(projectId, file);
        setStatus(`Imported ${result.imported} exposure period(s).`);
      } else {
        const result = await api.importRateHistory(projectId, file);
        setStatus(`Imported ${result.imported} rate change(s); the history was replaced.`);
      }
      await loadWorkspace(projectId);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 border border-dashed border-hairline-strong bg-paper px-3 py-2.5">
          <div>
            <p className="text-[0.85rem] font-medium text-ink">Loss run (claims)</p>
            <p className="text-[0.72rem] text-ink-faint">
              CSV or Excel - claim_id, accident_date, report_date, evaluation_date, paid_to_date,
              case_reserve, status. Replaces existing claim data.
            </p>
          </div>
          <input
            ref={claimsInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handle("claims", file);
              e.target.value = "";
            }}
          />
          <Button
            kind="secondary"
            disabled={busy !== null}
            onClick={() => claimsInput.current?.click()}
          >
            {busy === "claims" ? "Importing..." : "Choose file"}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 border border-dashed border-hairline-strong bg-paper px-3 py-2.5">
          <div>
            <p className="text-[0.85rem] font-medium text-ink">Exposure / premium</p>
            <p className="text-[0.72rem] text-ink-faint">
              CSV or Excel - origin, earned_premium. Required for Bornhuetter-Ferguson.
            </p>
          </div>
          <input
            ref={exposuresInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handle("exposures", file);
              e.target.value = "";
            }}
          />
          <Button
            kind="secondary"
            disabled={busy !== null}
            onClick={() => exposuresInput.current?.click()}
          >
            {busy === "exposures" ? "Importing..." : "Choose file"}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 border border-dashed border-hairline-strong bg-paper px-3 py-2.5">
          <div>
            <p className="text-[0.85rem] font-medium text-ink">Rate-change history</p>
            <p className="text-[0.72rem] text-ink-faint">
              CSV or Excel - effective_date, rate_change (e.g. 0.05 = +5%). Replaces the stored
              history; drives parallelogram on-leveling.
            </p>
          </div>
          <input
            ref={ratesInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handle("rates", file);
              e.target.value = "";
            }}
          />
          <Button
            kind="secondary"
            disabled={busy !== null}
            onClick={() => ratesInput.current?.click()}
          >
            {busy === "rates" ? "Importing..." : "Choose file"}
          </Button>
        </div>
      </div>
      {status ? <p className="text-[0.8rem] text-verdigris">{status}</p> : null}
      {error ? <p className="text-[0.8rem] text-oxblood">{error}</p> : null}
    </div>
  );
}
