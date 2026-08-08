"use client";

import { useState } from "react";
import {
  type ResolvedTask,
  type QuestionnaireTask,
  type QuestionNode,
  type ActionTask,
  type PhotoTask,
  type CountTask,
  taskTitle,
  taskTypeLabel,
} from "@/lib/strapiTypes";
import { blocksToText } from "@/lib/blocks";
import { QuestionRenderer, type AnswerValue } from "@/components/tasks/QuestionRenderer";
import { type CapturedPhotoAsset } from "@/lib/native/camera";
import { getCurrentPosition } from "@/lib/native/geo";
import { titleCase } from "@/lib/day";
import { CameraGalleryPicker } from "@/components/tasks/CameraGalleryPicker";

export interface TaskCompletePayload {
  answers: Record<string, unknown>;
  photos?: File[];
}

interface Props {
  resolved: ResolvedTask;
  completed: boolean;
  saving: boolean;
  onComplete: (payload: TaskCompletePayload) => void;
  storeId?: number;
  campaignAnswerHistory?: Record<string, unknown>;
}

function shouldSkipOnce(
  q: QuestionNode,
  history: Record<string, unknown>,
): boolean {
  if (!q.askOncePerCampaign) return false;
  const effectiveKey = q.key ?? `q${q.id}`;
  if (!(effectiveKey in history)) return false;
  const prev = history[effectiveKey];
  // skipCondition is only meaningful for boolean questions
  const cond = q.answerType === "boolean" ? (q.skipCondition ?? "answered") : "answered";
  if (cond === "answered") return true;
  if (cond === "answered_yes") return prev === true;
  if (cond === "answered_no") return prev === false;
  return false;
}

export function TaskRenderer({ resolved, completed, saving, onComplete, storeId, campaignAnswerHistory = {} }: Props) {
  const { task } = resolved;
  const instructions = blocksToText(task.instructions);

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoGeo, setPhotoGeo] = useState<Array<{ fileName: string; latitude: number; longitude: number }>>([]);
  const [questionPhotoGeo, setQuestionPhotoGeo] = useState<
    Record<string, Array<{ mediaId: number; latitude: number; longitude: number }>>
  >({});
  const [gps, setGps] = useState<string | null>(null);
  const [countValue, setCountValue] = useState<string>("");
  const [noteValue, setNoteValue] = useState<string>("");
  const [qStep, setQStep] = useState(0);

  const setAnswer = (key: string, v: AnswerValue) =>
    setAnswers((prev) => ({ ...prev, [key]: v }));

  const addPhotos = async (assets: CapturedPhotoAsset[]) => {
    console.log("[GEO-DEBUG][TaskRenderer:addPhotos:start]");
    console.log("[GEO-DEBUG][TaskRenderer:addPhotos:assets]", {
      count: assets.length,
      files: assets.map((a) => a.file.name),
      geo: assets.map((a) => a.geo ?? null),
    });
    if (!assets.length) return;

    setPhotos((p) => [...p, ...assets.map((a) => a.file)]);
    const withGeo = assets
      .filter((a) => !!a.geo)
      .map((a) => ({
        fileName: a.file.name,
        latitude: a.geo!.latitude,
        longitude: a.geo!.longitude,
      }));
    console.log("[GEO-DEBUG][TaskRenderer:addPhotos:withGeo]", withGeo);
    if (withGeo.length) setPhotoGeo((prev) => [...prev, ...withGeo]);
  };

  const header = (
    <div className="task-head">
      <div>
        <div className="task-title">{taskTitle(task)}</div>
      </div>
      {completed ? (
        <span className="badge badge--done">DONE</span>
      ) : (
        task.priority && <span className={`badge badge--${task.priority}`}>{task.priority}</span>
      )}
    </div>
  );

  const completeBtn = (payload: () => TaskCompletePayload, label = "Mark complete", extraDisabled = false) => (
    <button
      type="button"
      className="btn-primary"
      disabled={saving || completed || extraDisabled}
      onClick={() => onComplete(payload())}
    >
      {completed ? "Completed" : saving ? "Saving…" : label}
    </button>
  );

  const isAnswered = (v: AnswerValue): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return true;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "number") return !isNaN(v);
    if (typeof v === "string") return v.trim().length > 0;
    return false;
  };

  const photoStrip = (
    <div className="photo-strip">
      {photos.map((f, i) => (
        <span key={i} className="pill">📷 {f.name}</span>
      ))}
      <CameraGalleryPicker onSelect={addPhotos} />
    </div>
  );

  let body: React.ReactNode = null;

  switch (task.__component) {
    case "tasks.questionnaire-task": {
      const q = task as QuestionnaireTask;
      const allQuestions = q.questions ?? [];

      const isVisible = (question: (typeof allQuestions)[number]) => {
        if (!question.showIf) return true;
        const { questionKey, operator, value } = question.showIf;
        if (value === "*") return true;
        const actual = String(answers[questionKey] ?? "");
        return operator === "eq" ? actual === value : actual !== value;
      };

      const visibleQuestions = allQuestions.filter((question) => {
        if (!isVisible(question)) return false;
        if (shouldSkipOnce(question, campaignAnswerHistory)) return false;
        return true;
      });
      const safeStep = Math.min(qStep, Math.max(0, visibleQuestions.length - 1));
      const currentQ = visibleQuestions[safeStep];
      const isLast = safeStep === visibleQuestions.length - 1;

      const submitAnswers = () => {
        console.log("[GEO-DEBUG][TaskRenderer:submitAnswers:start]", {
          answers,
          questionPhotoGeo,
        });
        const visibleKeys = new Set(visibleQuestions.map((qn) => qn.key ?? `q${qn.id}`));
        const base: Record<string, unknown> = Object.fromEntries(
          Object.entries(answers).filter(([k]) => visibleKeys.has(k))
        );
        for (const key of visibleKeys) {
          const geo = questionPhotoGeo[key];
          console.log("[GEO-DEBUG][TaskRenderer:submitAnswers:questionGeo]", { key, geo });
          if (geo?.length) base[`${key}__photoGeo`] = geo;
        }
        console.log("[GEO-DEBUG][TaskRenderer:submitAnswers:final]", base);
        return base;
      };

      const currentKey = currentQ?.key ?? `q${currentQ?.id}`;
      const currentBlocked = !!currentQ?.required && !isAnswered(answers[currentKey] ?? null);
      const allRequiredAnswered = visibleQuestions.every((qn) =>
        !qn.required || isAnswered(answers[qn.key ?? `q${qn.id}`] ?? null)
      );

      body = (
        <>
          {resolved.upc && (
            <div className="task-upc-banner">
              {resolved.upc.name && <div className="task-upc-banner__name">{resolved.upc.name}</div>}
              <div className="task-upc-banner__code">UPC: {resolved.upc.code}</div>
            </div>
          )}

          {instructions && <div className="task-instructions">{instructions}</div>}

          {visibleQuestions.length > 0 && (
            <div className="q-step-bar">
              <span className="q-step-count">
                {safeStep + 1} / {visibleQuestions.length}
              </span>
              <div className="q-step-track">
                <div
                  className="q-step-fill"
                  style={{ width: `${Math.round(((safeStep + 1) / visibleQuestions.length) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {currentQ && (
            <QuestionRenderer
              key={currentQ.id}
              question={currentQ}
              index={safeStep}
              value={answers[currentQ.key ?? `q${currentQ.id}`] ?? null}
              onChange={(v) => setAnswer(currentQ.key ?? `q${currentQ.id}`, v)}
              onPhotoGeolocation={(geo) => {
                const key = currentQ.key ?? `q${currentQ.id}`;
                setQuestionPhotoGeo((prev) => ({
                  ...prev,
                  [key]: [...(prev[key] ?? []), ...geo],
                }));
              }}
            />
          )}

          <div className="q-nav">
            <button
              type="button"
              className="btn-ghost"
              disabled={safeStep === 0}
              onClick={() => setQStep((s) => Math.max(0, s - 1))}
            >
              ← Back
            </button>
            {isLast ? (
              completeBtn(() => ({ answers: submitAnswers() }), "Submit answers 123", !allRequiredAnswered)
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={currentBlocked}
                onClick={() => setQStep((s) => s + 1)}
              >
                Next →
              </button>
            )}
          </div>
        </>
      );
      break;
    }
    case "tasks.action-task": {
      const a = task as ActionTask;
      body = (
        <>
          {a.actionType && <div className="section-label">{titleCase(a.actionType)}</div>}
          {instructions && <div className="task-instructions">{instructions}</div>}
          {a.requiresPhoto && photoStrip}
          {completeBtn(() => ({
            answers: {
              actionType: a.actionType,
              ...(photoGeo.length ? { photoGeo } : {}),
            },
            photos,
          }))}
        </>
      );
      break;
    }
    case "tasks.photo-task": {
      const p = task as PhotoTask;
      body = (
        <>
          <div className="section-label">
            {titleCase(p.photoType ?? "photo")} · {p.requiredPhotoCount ?? 1} required
          </div>
          {instructions && <div className="task-instructions">{instructions}</div>}
          {photoStrip}
          {p.requireGps && (
            <button
              type="button"
              className="chip"
              style={{ marginTop: 8 }}
              onClick={async () => {
                const c = await getCurrentPosition();
                console.log("[GEO-DEBUG][TaskRenderer:getCurrentPosition]", c);
                setGps(c ? `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}` : "unavailable");
              }}
            >
              📍 {gps ?? "Capture GPS"}
            </button>
          )}
          {completeBtn(() => {
            const payload = {
              answers: {
                photoType: p.photoType,
                gps,
                photoCount: photos.length,
                ...(photoGeo.length ? { photoGeo } : {}),
              },
              photos,
            };
            console.log("[GEO-DEBUG][TaskRenderer:photoTask:payload]", payload);
            return payload;
          })}
        </>
      );
      break;
    }
    case "tasks.count-task": {
      const c = task as CountTask;
      body = (
        <>
          <div className="section-label">Count · {titleCase(c.countType ?? "units")}</div>
          {instructions && <div className="task-instructions">{instructions}</div>}
          <input
            className="field-input"
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={countValue}
            onChange={(e) => setCountValue(e.target.value)}
          />
          {completeBtn(() => ({ answers: { count: countValue === "" ? null : Number(countValue), countType: c.countType } }))}
        </>
      );
      break;
    }
    case "tasks.note-task": {
      body = (
        <>
          {instructions && <div className="task-instructions">{instructions}</div>}
          <textarea
            className="field-textarea"
            placeholder="Add your note…"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
          />
          {completeBtn(() => ({ answers: { note: noteValue } }))}
        </>
      );
      break;
    }
  }

  return (
    <div className="merch-card task-card">
      {header}
      {body}
    </div>
  );
}
