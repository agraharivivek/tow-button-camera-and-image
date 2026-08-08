"use client";

import { useState } from "react";
import type { QuestionNode } from "@/lib/strapiTypes";
import { type CapturedPhotoAsset } from "@/lib/native/camera";
import { CameraGalleryPicker } from "@/components/tasks/CameraGalleryPicker";
import { apiClient } from "@/services/apiClient";

export type AnswerValue = string | number | boolean | string[] | number[] | null;

interface Props {
  question: QuestionNode;
  index: number;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  onPhotoGeolocation?: (geo: Array<{ mediaId: number; latitude: number; longitude: number }>) => void;
}

/** Renders the right input for a question based on its answerType. */
export function QuestionRenderer({ question, index, value, onChange, onPhotoGeolocation }: Props) {
  const at = question.answerType ?? "text";
  const [uploading, setUploading] = useState(false);

  const renderBody = () => {
    switch (at) {
      case "boolean":
        return (
          <div className="toggle-row">
            <button
              type="button"
              className={`toggle ${value === true ? "on" : ""}`}
              onClick={() => onChange(true)}
            >
              Yes
            </button>
            <button
              type="button"
              className={`toggle ${value === false ? "off" : ""}`}
              onClick={() => onChange(false)}
            >
              No
            </button>
          </div>
        );

      case "number":
      case "percent":
        return (
          <input
            className="field-input"
            type="number"
            inputMode="numeric"
            placeholder={at === "percent" ? "0–100" : "0"}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        );

      case "price":
        return (
          <input
            className="field-input"
            type="number"
            inputMode="decimal"
            placeholder="$0.00"
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        );

      case "long_text":
        return (
          <textarea
            className="field-textarea"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "single_select": {
        const opts = question.answerOptions ?? [];
        return (
          <div className="opt-chips">
            {opts.map((o) => (
              <button
                type="button"
                key={o.id}
                className={`opt ${value === o.title ? "selected" : ""}`}
                onClick={() => onChange(o.title ?? "")}
              >
                {o.title}
              </button>
            ))}
          </div>
        );
      }

      case "multi_select": {
        const opts = question.answerOptionsMultiselect ?? [];
        const arr = Array.isArray(value) ? (value as string[]) : [];
        const toggle = (t: string) =>
          onChange(arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t]);
        return (
          <div className="opt-chips">
            {opts.map((o) => (
              <button
                type="button"
                key={o.id}
                className={`opt ${arr.includes(o.title ?? "") ? "selected" : ""}`}
                onClick={() => toggle(o.title ?? "")}
              >
                {o.title}
              </button>
            ))}
          </div>
        );
      }

      case "photo":
      case "video": {
        const ids = Array.isArray(value) ? (value as number[]) : [];
        const add = async (captured: CapturedPhotoAsset[]) => {
          console.log("[GEO-DEBUG][QuestionRenderer:add:start]", {
            existingIds: ids,
          });
          console.log("[GEO-DEBUG][QuestionRenderer:add:captured]", {
            count: captured.length,
            files: captured.map((c) => c.file.name),
            geo: captured.map((c) => c.geo ?? null),
          });
          if (!captured.length) return;
          setUploading(true);
          try {
            const uploaded = await apiClient.upload<Array<{ id: number }>>(captured.map((c) => c.file));
            console.log("[GEO-DEBUG][QuestionRenderer:add:uploaded]", {
              ids: uploaded.map((u) => u.id),
            });
            onChange([...ids, ...uploaded.map((u) => u.id)]);

            const geo = uploaded
              .map((u, idx) => {
                const meta = captured[idx]?.geo;
                if (!meta) return null;
                return {
                  mediaId: u.id,
                  latitude: meta.latitude,
                  longitude: meta.longitude,
                };
              })
              .filter((g): g is { mediaId: number; latitude: number; longitude: number } => !!g);
            console.log("[GEO-DEBUG][QuestionRenderer:add:mapped-geo]", geo);
            if (geo.length) onPhotoGeolocation?.(geo);
          } catch (error) {
            console.warn("[GEO-DEBUG][QuestionRenderer:add:error]", error);
            alert("Photo upload failed. Check your connection and try again.");
          } finally {
            setUploading(false);
          }
        };
        return (
          <div className="photo-strip">
            {ids.map((id, i) => (
              <span key={id} className="pill">📎 Photo {i + 1}</span>
            ))}
            <CameraGalleryPicker onSelect={add} disabled={uploading} />
          </div>
        );
      }

      case "date":
      case "time":
      case "datetime":
        return (
          <input
            className="field-input"
            type={at === "datetime" ? "datetime-local" : at}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case "text":
      default:
        return (
          <input
            className="field-input"
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
    }
  };

  return (
    <div className="question">
      <div className="q-row">
        <span className="q-num">{index + 1}</span>
        <div style={{ flex: 1 }}>
          <div className="q-title">{question.title}</div>
          {question.required && <div className="q-required">REQUIRED</div>}
          {question.helpText && <div className="q-help">{question.helpText}</div>}
          <div className="q-body">{renderBody()}</div>
        </div>
      </div>
    </div>
  );
}
