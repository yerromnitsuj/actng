import { useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { Button, Section, fmt0 } from "./ui.js";
import type {
  ApplyEvidence,
  PromotionAwaiting,
  PromotionComplete,
  PromotionFailed,
  PromotionGate,
  RationaleEvidence,
  ReplayVerifyEvidence,
  StudyIntakeEvidence,
} from "../api/types.js";

/**
 * Import study: a notebook-authored StudyDoc walks the four-gate promotion
 * chain (study-intake -> replay-verify -> rationale -> apply). Every gate
 * renders its evidence and takes a human decision with a verbatim rationale;
 * nothing touches the workspace until the apply gate. A paused promotion
 * survives a server restart - the store restores it on project open.
 */

const GATES: { id: PromotionGate; label: string }[] = [
  { id: "study-intake", label: "Intake" },
  { id: "replay-verify", label: "Replay" },
  { id: "rationale", label: "Rationale" },
  { id: "apply", label: "Apply" },
];

/** Tolerances are tiny decimals; exponent form reads better than 0.000001. */
function fmtTol(v: number | null): string {
  if (v === null) return "(none stated)";
  if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(0).replace("e-", "e-");
  return String(v);
}

function Kicker({ children }: { children: string }) {
  return (
    <p className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
      {children}
    </p>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  const styles: Record<string, string> = {
    agree: "bg-verdigris-soft text-verdigris",
    "verified-by-value": "bg-gold-soft text-[#7a5c1d]",
    disagree: "bg-oxblood-soft text-oxblood",
    "not-comparable": "bg-paper text-ink-soft border border-hairline",
  };
  const label = verdict ?? "not refereed";
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] ${
        styles[label] ?? "bg-paper text-ink-soft border border-hairline"
      }`}
    >
      {label}
    </span>
  );
}

function ReplayLabelChip({ label }: { label: "replayed-exact" | "verified-by-value" }) {
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-[0.66rem] font-semibold tracking-[0.04em] ${
        label === "replayed-exact"
          ? "bg-steel-soft text-steel"
          : "bg-gold-soft text-[#7a5c1d]"
      }`}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Gate evidence blocks

function IntakeEvidence({ evidence }: { evidence: StudyIntakeEvidence }) {
  const tol = evidence.replayTolerance;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-[0.92rem] font-semibold text-ink">{evidence.study.title}</p>
        <p className="text-[0.78rem] text-ink-soft">
          {evidence.study.analyst ? `${evidence.study.analyst} - ` : ""}
          {evidence.study.sourceRef ?? "no source reference"}
          {" - "}
          <span className="num text-ink-faint">{evidence.study.integrity}</span>
        </p>
        <p className="text-[0.82rem] leading-relaxed text-ink-soft">{evidence.study.summary}</p>
      </div>

      {/* Replay tolerance: FIRST and prominent, per spec 6 Gate 1. */}
      <div
        className={`rounded-sm border px-3 py-2.5 ${
          tol.exceedsTenTimesProfileDefault
            ? "border-gold bg-gold-soft"
            : "border-hairline-strong bg-paper"
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <Kicker>Replay tolerance</Kicker>
          {tol.exceedsTenTimesProfileDefault ? (
            <span className="rounded-sm bg-gold px-1.5 py-0.5 text-[0.66rem] font-bold uppercase tracking-[0.08em] text-ink">
              &gt; 10x profile default
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[0.8rem] text-ink">
          <span>
            stated <span className="num font-semibold">{fmtTol(tol.stated)}</span>
          </span>
          <span>
            {tol.profileId} default{" "}
            <span className="num font-semibold">{fmtTol(tol.profileDefault)}</span>
          </span>
          <span>
            host ceiling <span className="num font-semibold">{fmtTol(tol.ceiling)}</span>
          </span>
          <span>
            effective <span className="num font-semibold">{fmtTol(tol.effective)}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Kicker>ASOP 23 data review</Kicker>
        {evidence.dataReview.map((entry, i) => {
          const s = entry.report.summary;
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 text-[0.78rem]">
              <span className="text-ink-soft">
                {entry.triangles.map((t) => t.measure).join(" + ")}
              </span>
              <span className="rounded-sm border border-hairline bg-paper px-1.5 py-0.5 text-[0.66rem] uppercase tracking-[0.08em] text-ink-faint">
                {entry.mode}
              </span>
              <span className="num text-ink-soft">
                {s.pass} pass
                {s.warning > 0 ? (
                  <span className="text-[#7a5c1d]"> - {s.warning} warning</span>
                ) : null}
                {s.fail > 0 ? <span className="text-oxblood"> - {s.fail} FAIL</span> : null}
                {s.notEvaluated > 0 ? ` - ${s.notEvaluated} not evaluated` : null}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <Kicker>Selections and segments</Kicker>
        {evidence.segments.map((seg, i) => {
          const coherent = evidence.coherence.find(
            (c) => c.selectionIntegrity === seg.selectionIntegrity,
          )?.coherence.coherent;
          return (
            <p key={i} className="text-[0.78rem] text-ink-soft">
              selection <span className="num text-ink-faint">{seg.selectionIntegrity}</span>
              {" -> "}
              <span className="font-medium text-ink">{seg.target}</span>
              {Object.keys(seg.labels).length > 0
                ? ` (${Object.entries(seg.labels)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ")})`
                : " (no segment labels)"}
              {" - "}
              {coherent === false ? (
                <span className="font-semibold text-oxblood">incoherent</span>
              ) : (
                <span className="text-verdigris">coherent</span>
              )}
            </p>
          );
        })}
      </div>

      {/* Verification-scope disclosure: what the gates checked, and the
          workspace-binding judgment they deliberately leave to the human. */}
      <p className="text-[0.72rem] italic leading-relaxed text-ink-faint">
        {evidence.workspaceBindingNote}
      </p>

      {evidence.warnings.length > 0 ? (
        <div className="rounded-sm border border-gold bg-gold-soft px-3 py-2">
          <Kicker>Warnings</Kicker>
          {evidence.warnings.map((w, i) => (
            <p key={i} className="text-[0.76rem] text-[#6b4f16]">
              {w}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReplayEvidenceBlock({ evidence }: { evidence: ReplayVerifyEvidence }) {
  return (
    <div className="flex flex-col gap-3">
      {evidence.hardBlocked ? (
        <div className="rounded-sm border border-oxblood bg-oxblood-soft px-3 py-2.5">
          <p className="text-[0.8rem] font-semibold uppercase tracking-[0.08em] text-oxblood">
            Hard block - a supporting result disagrees
          </p>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-oxblood">
            The gate cannot accept this study: abort and fix it upstream. Tolerance editing is
            not an escape hatch.
          </p>
        </div>
      ) : null}

      <p className="text-[0.8rem] leading-relaxed text-ink-soft">{evidence.verification}</p>

      {evidence.replays.map((replay, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-sm border border-hairline bg-paper px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Kicker>Replay</Kicker>
            <span className="num text-[0.76rem] text-ink-soft">
              ultimate {fmt0(replay.replayTotals.ultimate)} - unpaid{" "}
              {fmt0(replay.replayTotals.unpaid)} - tolerance{" "}
              {fmtTol(evidence.effectiveTolerance)}
            </span>
          </div>
          {replay.verifiedByValueOnly ? (
            <p className="text-[0.76rem] font-medium text-[#7a5c1d]">
              Every interval is verified by value only: the values were applied as stated, not
              independently recomputed.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {replay.targets.map((t, j) => (
              <span key={j} className="inline-flex items-center gap-1 text-[0.72rem] text-ink-soft">
                <span className="num">{t.target}</span>
                <ReplayLabelChip label={t.label} />
              </span>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-1.5">
        <Kicker>Cross-engine referee</Kicker>
        {evidence.crosschecks.length === 0 ? (
          <p className="text-[0.78rem] italic text-ink-faint">
            No supporting results travelled with the study; nothing to referee.
          </p>
        ) : (
          evidence.crosschecks.map((check, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-[0.78rem] text-ink-soft">
              <span className="font-medium text-ink">
                {check.engine.name} {check.engine.version}
              </span>
              <VerdictBadge verdict={check.verdict} />
              {check.reason ? <span className="italic">{check.reason}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ApplyEvidenceBlock({ evidence }: { evidence: ApplyEvidence }) {
  return (
    <div className="flex flex-col gap-3">
      <table className="ledger w-full text-[0.8rem]">
        <thead>
          <tr className="text-left text-[0.68rem] uppercase tracking-[0.1em] text-ink-faint">
            <th className="py-1 pr-3 font-semibold">Target</th>
            <th className="py-1 pr-3 font-semibold">Selection</th>
            <th className="num py-1 pr-3 text-right font-semibold">Factors</th>
            <th className="num py-1 text-right font-semibold">Tail</th>
          </tr>
        </thead>
        <tbody>
          {evidence.applications.map((a, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-3 font-medium text-ink">{a.segmentTarget}</td>
              <td className="num py-1.5 pr-3 text-ink-soft">{a.selectionIntegrity}</td>
              <td className="num py-1.5 pr-3 text-right">{a.developmentCount}</td>
              <td className="num py-1.5 text-right">{a.tailFactor.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[0.78rem] text-ink-soft">
        Applying reruns the analysis as{" "}
        <span className="font-medium text-ink">{evidence.analysisLabel}</span> and records the
        ledger with source <span className="num text-ink-faint">{evidence.ledgerSource}</span>.
      </p>
      <p className="text-[0.78rem] font-medium text-oxblood">This mutates the workspace.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The decision form (keyed by runId+gate so state resets per gate)

function GateDecision({ promotion }: { promotion: PromotionAwaiting }) {
  const advancePromotion = useStore((s) => s.advancePromotion);
  const busy = useStore((s) => s.promotionBusy);
  const isRationaleGate = promotion.gate === "rationale";
  const rationaleEvidence = isRationaleGate ? (promotion.evidence as RationaleEvidence) : null;
  const hardBlocked =
    promotion.gate === "replay-verify" &&
    (promotion.evidence as ReplayVerifyEvidence).hardBlocked;

  const [rationale, setRationale] = useState(rationaleEvidence?.draftRationale ?? "");
  const [attestation, setAttestation] = useState("");

  const rationaleOk = rationale.trim() !== "";
  const attestationOk = !isRationaleGate || attestation.trim() !== "";
  const ready = rationaleOk && attestationOk && !busy;

  const decide = (decision: "accept" | "abort" | "approve" | "apply") => {
    void advancePromotion({
      gate: promotion.gate,
      decision,
      rationale,
      ...(isRationaleGate ? { attestation } : {}),
    });
  };

  const proceedLabel =
    promotion.gate === "study-intake"
      ? "Accept and continue"
      : promotion.gate === "replay-verify"
        ? "Accept verification"
        : promotion.gate === "rationale"
          ? "Approve rationale"
          : "Apply to workspace";
  const proceedDecision =
    promotion.gate === "rationale" ? "approve" : promotion.gate === "apply" ? "apply" : "accept";

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3">
      <label className="flex flex-col gap-1">
        <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          {isRationaleGate ? "Rationale (recorded verbatim in the ledger)" : "Decision rationale"}
        </span>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={isRationaleGate ? 6 : 2}
          maxLength={4000}
          placeholder="Why this decision - the audit trail records it verbatim"
          className="w-full resize-y rounded-sm border border-hairline-strong bg-panel px-3 py-2 text-[0.82rem] leading-relaxed text-ink outline-none focus:border-steel"
        />
      </label>
      {isRationaleGate ? (
        <label className="flex flex-col gap-1">
          <span className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
            Attestation (required - recorded verbatim)
          </span>
          <input
            value={attestation}
            onChange={(e) => setAttestation(e.target.value)}
            maxLength={1000}
            placeholder="Rationale authored and reviewed by <name, credentials>"
            className="w-full rounded-sm border border-hairline-strong bg-panel px-3 py-2 text-[0.82rem] text-ink outline-none focus:border-steel"
          />
        </label>
      ) : null}
      <div className="flex items-center gap-2">
        {hardBlocked ? (
          <Button kind="danger" disabled={!ready} onClick={() => decide("abort")}>
            {busy ? "Working..." : "Abort promotion (only available action)"}
          </Button>
        ) : (
          <>
            <Button kind="primary" disabled={!ready} onClick={() => decide(proceedDecision)}>
              {busy ? "Working..." : proceedLabel}
            </Button>
            <Button kind="danger" disabled={!ready} onClick={() => decide("abort")}>
              Abort
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States

function GateCard({ promotion }: { promotion: PromotionAwaiting }) {
  const activeIndex = GATES.findIndex((g) => g.id === promotion.gate);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        {GATES.map((gate, i) => (
          <div key={gate.id} className="flex items-center gap-1.5">
            {i > 0 ? <span className="h-px w-4 bg-hairline-strong" /> : null}
            <span
              className={`rounded-sm px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.1em] ${
                i < activeIndex
                  ? "bg-verdigris-soft text-verdigris"
                  : i === activeIndex
                    ? "bg-ink text-paper"
                    : "bg-paper text-ink-faint border border-hairline"
              }`}
            >
              {gate.label}
            </span>
          </div>
        ))}
      </div>

      <p className="border-l-2 border-gold pl-3 text-[0.82rem] italic leading-relaxed text-ink-soft">
        {promotion.recommendation}
      </p>

      {promotion.gate === "study-intake" ? (
        <IntakeEvidence evidence={promotion.evidence as StudyIntakeEvidence} />
      ) : promotion.gate === "replay-verify" ? (
        <ReplayEvidenceBlock evidence={promotion.evidence as ReplayVerifyEvidence} />
      ) : promotion.gate === "rationale" ? (
        <p className="text-[0.8rem] leading-relaxed text-ink-soft">
          Review and edit the draft below - the final text you approve is recorded verbatim in
          the assumption ledger, together with your attestation.
        </p>
      ) : (
        <ApplyEvidenceBlock evidence={promotion.evidence as ApplyEvidence} />
      )}

      <GateDecision key={`${promotion.runId}-${promotion.gate}`} promotion={promotion} />
    </div>
  );
}

function DoneCard({ promotion }: { promotion: PromotionComplete }) {
  const dismissPromotion = useStore((s) => s.dismissPromotion);
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`rounded-sm border px-3 py-2.5 ${
          promotion.applied
            ? "border-verdigris bg-verdigris-soft"
            : "border-hairline-strong bg-paper"
        }`}
      >
        <p
          className={`text-[0.85rem] font-semibold ${
            promotion.applied ? "text-verdigris" : "text-ink-soft"
          }`}
        >
          {promotion.applied
            ? "Promotion applied - the workspace selections changed and the analysis reran."
            : `Promotion aborted at the ${promotion.abortedAt ?? "unknown"} gate - nothing was applied.`}
        </p>
        {promotion.applied ? (
          <p className="mt-1 text-[0.78rem] text-ink-soft">
            The promotion trail and the assumption ledger (rationale and attestation verbatim)
            were saved to Notes.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        {promotion.trail.map((t, i) => (
          <p key={i} className="text-[0.78rem] text-ink-soft">
            <span className="font-semibold uppercase tracking-[0.08em] text-ink">{t.stage}</span>
            {": "}
            {t.decision}
            {t.rationale && !t.skipped ? (
              <span className="italic text-ink-faint"> - {t.rationale}</span>
            ) : null}
          </p>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {promotion.applied ? (
          <Button
            kind="secondary"
            onClick={() =>
              document
                .getElementById("ex-notes")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            View ledger note
          </Button>
        ) : null}
        <Button kind="ghost" onClick={dismissPromotion}>
          Done
        </Button>
      </div>
    </div>
  );
}

function FailedCard({ promotion }: { promotion: PromotionFailed }) {
  const dismissPromotion = useStore((s) => s.dismissPromotion);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-sm border border-oxblood bg-oxblood-soft px-3 py-2.5">
        <p className="text-[0.8rem] font-semibold text-oxblood">
          Promotion failed - {promotion.error.code}
        </p>
        <p className="mt-1 text-[0.8rem] leading-relaxed text-oxblood">
          {promotion.error.message}
        </p>
      </div>
      <div>
        <Button kind="ghost" onClick={dismissPromotion}>
          Start over
        </Button>
      </div>
    </div>
  );
}

function UploadCard() {
  const importStudy = useStore((s) => s.importStudy);
  const setPromotionError = useStore((s) => s.setPromotionError);
  const busy = useStore((s) => s.promotionBusy);
  const input = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setPromotionError(`${file.name} is not valid JSON; expected a StudyDoc document`);
      return;
    }
    await importStudy(parsed);
  };

  return (
    <div className="flex items-center justify-between gap-3 border border-dashed border-hairline-strong bg-paper px-3 py-2.5">
      <div>
        <p className="text-[0.85rem] font-medium text-ink">Study document (JSON)</p>
        <p className="text-[0.72rem] text-ink-faint">
          An actuarial-interchange StudyDoc exported from a notebook (Python: save_study).
          Import starts the four-gate promotion: intake, replay verification, rationale with
          attestation, apply. Nothing changes until the final gate.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <Button kind="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Importing..." : "Choose file"}
      </Button>
    </div>
  );
}

export default function ImportStudyPanel() {
  const promotion = useStore((s) => s.promotion);
  const promotionError = useStore((s) => s.promotionError);

  return (
    <Section
      title="Import study"
      kicker="notebook selections, governed promotion"
      id="ex-study"
    >
      <div className="flex flex-col gap-3">
        {promotionError ? (
          <div
            role="alert"
            className="rounded-sm border border-oxblood bg-oxblood-soft px-3 py-2 text-[0.8rem] text-oxblood"
          >
            {promotionError}
          </div>
        ) : null}
        {promotion === null ? (
          <UploadCard />
        ) : promotion.status === "awaiting-decision" ? (
          <GateCard promotion={promotion} />
        ) : promotion.status === "complete" ? (
          <DoneCard promotion={promotion} />
        ) : (
          <FailedCard promotion={promotion} />
        )}
      </div>
    </Section>
  );
}
