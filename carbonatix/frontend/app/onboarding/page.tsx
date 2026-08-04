"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import UploadDropzone, { type FieldMeta } from "@/components/twin/UploadDropzone";
import { putCompany, postSuggestCap } from "@/lib/api";
import {
  buildCompanyInput,
  buildSuggestCapInput,
  computeImpliedIntensity,
  type CapHelperFormValues,
  type SiteSpecFormValues,
} from "@/lib/onboarding";

/** Candidate.field (snake_case, the backend wire value -- see
 * `app/ingestion/mapping.py`'s `FIELDS_BY_PROFILE["site_spec"]`) -> this
 * form's field, plus how to label and display it. */
const SITE_SPEC_FIELD_LABELS: Record<string, FieldMeta> = {
  ef_captive_pltu: {
    label: "Faktor emisi PLTU captive",
    unit: "tCO₂e/MWh",
    isPercent: false,
  },
  dryer_thermal_efficiency: {
    label: "Efisiensi termal dryer",
    unit: "%",
    isPercent: true,
  },
  sec_eaf_kwh_per_t_alloy: {
    label: "Energi spesifik EAF",
    unit: "kWh/ton alloy",
    isPercent: false,
  },
};

/** Maps a candidate's field name onto the key this page's form state uses
 * for it -- the two diverge for percentage fields, which the form holds as
 * a percentage rather than the API's fraction. */
const CANDIDATE_FIELD_TO_FORM_KEY: Record<string, keyof FormState> = {
  ef_captive_pltu: "efCaptivePltu",
  dryer_thermal_efficiency: "dryerThermalEfficiencyPercent",
  sec_eaf_kwh_per_t_alloy: "secEafKwhPerTAlloy",
};

/** All numeric fields are held as the raw string the input shows, so an
 * in-progress or empty entry never has to be a stray `NaN`. */
interface FormState {
  name: string;
  technology: string;
  efCaptivePltu: string;
  dryerThermalEfficiencyPercent: string;
  secEafKwhPerTAlloy: string;
  alloyNickelGradePercent: string;
  kilnThermalEfficiencyPercent: string;
  capTco2e: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  technology: "RKEF",
  efCaptivePltu: "",
  dryerThermalEfficiencyPercent: "",
  secEafKwhPerTAlloy: "",
  alloyNickelGradePercent: "",
  kilnThermalEfficiencyPercent: "",
  capTco2e: "",
};

interface HelperState {
  open: boolean;
  wetOreInputTons: string;
  moistureContentPercent: string;
  nickelGradePercent: string;
  reductantBiocokePercent: string;
  powerMixCaptiveCoalPercent: string;
  powerMixHydroGridPercent: string;
  reductionTargetPercent: string;
  pending: boolean;
  error: string | null;
  baselineTco2e: number | null;
}

const EMPTY_HELPER: HelperState = {
  open: false,
  wetOreInputTons: "",
  moistureContentPercent: "",
  nickelGradePercent: "",
  reductantBiocokePercent: "",
  powerMixCaptiveCoalPercent: "",
  powerMixHydroGridPercent: "",
  reductionTargetPercent: "",
  pending: false,
  error: null,
  baselineTco2e: null,
};

const NUMBER_INPUT_CLASS =
  "rounded border border-black/[.15] bg-transparent px-3 py-2 text-sm text-black outline-none focus:border-black dark:border-white/[.2] dark:text-zinc-50 dark:focus:border-white";
const LABEL_CLASS = "text-sm font-medium text-black dark:text-zinc-50";

function toNumber(value: string): number {
  return value.trim() === "" ? NaN : Number(value);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [helper, setHelper] = useState<HelperState>(EMPTY_HELPER);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setHelperField<K extends keyof HelperState>(key: K, value: HelperState[K]) {
    setHelper((prev) => ({ ...prev, [key]: value }));
  }

  function handleAcceptCandidate(field: string, displayValue: number) {
    const formKey = CANDIDATE_FIELD_TO_FORM_KEY[field];
    if (!formKey) return;
    setField(formKey, String(displayValue));
  }

  async function handleCalculateCap() {
    setHelper((prev) => ({ ...prev, pending: true, error: null }));

    const captive = toNumber(helper.powerMixCaptiveCoalPercent);
    const hydro = toNumber(helper.powerMixHydroGridPercent);
    const parsed: CapHelperFormValues = {
      wetOreInputTons: toNumber(helper.wetOreInputTons),
      moistureContentPercent: toNumber(helper.moistureContentPercent),
      nickelGradePercent: toNumber(helper.nickelGradePercent),
      reductantBiocokePercent: toNumber(helper.reductantBiocokePercent),
      powerMixCaptiveCoalPercent: captive,
      powerMixHydroGridPercent: hydro,
      reductionTargetPercent: toNumber(helper.reductionTargetPercent),
    };

    if (Object.values(parsed).some((v) => !Number.isFinite(v))) {
      setHelper((prev) => ({
        ...prev,
        pending: false,
        error: "Isi semua bidang interval dengan angka yang valid.",
      }));
      return;
    }
    if (Math.abs(captive + hydro - 100) > 0.01) {
      setHelper((prev) => ({
        ...prev,
        pending: false,
        error: "Bauran daya (captive coal + hidro/grid) harus berjumlah 100%.",
      }));
      return;
    }

    try {
      const result = await postSuggestCap(buildSuggestCapInput(parsed));
      setField("capTco2e", String(result.capTco2e));
      setHelper((prev) => ({
        ...prev,
        pending: false,
        error: null,
        baselineTco2e: result.baselineTco2e,
      }));
    } catch (err) {
      setHelper((prev) => ({
        ...prev,
        pending: false,
        error: err instanceof Error ? err.message : "Gagal menghitung kuota.",
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const parsed: SiteSpecFormValues = {
      name: form.name,
      technology: form.technology,
      efCaptivePltu: toNumber(form.efCaptivePltu),
      dryerThermalEfficiencyPercent: toNumber(form.dryerThermalEfficiencyPercent),
      secEafKwhPerTAlloy: toNumber(form.secEafKwhPerTAlloy),
      alloyNickelGradePercent: toNumber(form.alloyNickelGradePercent),
      kilnThermalEfficiencyPercent: toNumber(form.kilnThermalEfficiencyPercent),
      capTco2e: toNumber(form.capTco2e),
    };

    const numericFields: [string, number][] = [
      ["Faktor emisi PLTU captive", parsed.efCaptivePltu],
      ["Efisiensi termal dryer", parsed.dryerThermalEfficiencyPercent],
      ["Energi spesifik EAF", parsed.secEafKwhPerTAlloy],
      ["Kadar nikel alloy", parsed.alloyNickelGradePercent],
      ["Efisiensi termal kiln", parsed.kilnThermalEfficiencyPercent],
      ["Kuota karbon", parsed.capTco2e],
    ];
    const invalid = numericFields.find(([, v]) => !Number.isFinite(v));
    if (invalid) {
      setSubmitError(`Isi "${invalid[0]}" dengan angka yang valid.`);
      return;
    }

    setSubmitting(true);
    try {
      await putCompany(buildCompanyInput(parsed));
      router.push("/twin");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Gagal menyimpan profil perusahaan.",
      );
      setSubmitting(false);
    }
  }

  const impliedIntensity = computeImpliedIntensity(
    toNumber(form.capTco2e),
    toNumber(helper.wetOreInputTons),
  );

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10 dark:bg-black">
      <div className="w-full max-w-2xl rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="mb-1 text-2xl font-semibold text-black dark:text-zinc-50">
          Spesifikasi Situs
        </h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Nilai-nilai yang jarang berubah pada smelter Anda. Data operasional harian diisi
          nanti pada twin 3D.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="name" className={LABEL_CLASS}>
                Nama perusahaan
              </label>
              <input
                id="name"
                required
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                className={NUMBER_INPUT_CLASS}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="technology" className={LABEL_CLASS}>
                Teknologi
              </label>
              <input
                id="technology"
                required
                value={form.technology}
                onChange={(e) => setField("technology", e.target.value)}
                className={NUMBER_INPUT_CLASS}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="efCaptivePltu" className={LABEL_CLASS}>
                  Faktor emisi PLTU captive (tCO₂e/MWh)
                </label>
                <input
                  id="efCaptivePltu"
                  type="number"
                  step="any"
                  min={0}
                  required
                  value={form.efCaptivePltu}
                  onChange={(e) => setField("efCaptivePltu", e.target.value)}
                  className={NUMBER_INPUT_CLASS}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="dryerThermalEfficiency" className={LABEL_CLASS}>
                  Efisiensi termal dryer (%)
                </label>
                <input
                  id="dryerThermalEfficiency"
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  required
                  value={form.dryerThermalEfficiencyPercent}
                  onChange={(e) => setField("dryerThermalEfficiencyPercent", e.target.value)}
                  className={NUMBER_INPUT_CLASS}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="secEafKwhPerTAlloy" className={LABEL_CLASS}>
                  Energi spesifik EAF (kWh/ton alloy)
                </label>
                <input
                  id="secEafKwhPerTAlloy"
                  type="number"
                  step="any"
                  min={0}
                  required
                  value={form.secEafKwhPerTAlloy}
                  onChange={(e) => setField("secEafKwhPerTAlloy", e.target.value)}
                  className={NUMBER_INPUT_CLASS}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="alloyNickelGrade" className={LABEL_CLASS}>
                  Kadar nikel alloy (%)
                </label>
                <input
                  id="alloyNickelGrade"
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  required
                  value={form.alloyNickelGradePercent}
                  onChange={(e) => setField("alloyNickelGradePercent", e.target.value)}
                  className={NUMBER_INPUT_CLASS}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="kilnThermalEfficiency" className={LABEL_CLASS}>
                  Efisiensi termal kiln (%)
                </label>
                <input
                  id="kilnThermalEfficiency"
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  required
                  value={form.kilnThermalEfficiencyPercent}
                  onChange={(e) => setField("kilnThermalEfficiencyPercent", e.target.value)}
                  className={NUMBER_INPUT_CLASS}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="capTco2e" className={LABEL_CLASS}>
                  Kuota karbon (tCO₂e per periode)
                </label>
                <input
                  id="capTco2e"
                  type="number"
                  step="any"
                  min={0}
                  required
                  value={form.capTco2e}
                  onChange={(e) => setField("capTco2e", e.target.value)}
                  className={NUMBER_INPUT_CLASS}
                />
              </div>
              <button
                type="button"
                onClick={() => setHelperField("open", !helper.open)}
                className="rounded-full border border-black/[.15] px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-black/[.04] dark:border-white/[.2] dark:text-zinc-50 dark:hover:bg-white/[.08]"
              >
                Hitung dari baseline
              </button>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Kuota adalah alokasi absolut untuk periode ini, bukan turunan dari volume bijih --
              volume produksi tidak dikurangkan dari kedua sisi perbandingan kepatuhan.
            </p>

            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {impliedIntensity === null
                ? "Buka “Hitung dari baseline” dan isi volume bijih basah untuk melihat intensitas kuota yang tersirat."
                : `Intensitas kuota yang tersirat: ${impliedIntensity.toFixed(4)} tCO₂e/ton bijih basah (dari volume interval di bawah).`}
            </p>

            {helper.open && (
              <div className="mt-2 flex flex-col gap-3 rounded border border-black/[.08] p-3 dark:border-white/[.145]">
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Masukkan satu interval operasional nominal dan target penurunan, lalu hitung
                  kuota yang tersirat. Hasilnya mengisi bidang di atas, tetapi tetap dapat
                  diubah -- nilai yang tersimpan selalu berupa angka absolut.
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="helperWetOre" className={LABEL_CLASS}>
                      Bijih basah masuk (ton)
                    </label>
                    <input
                      id="helperWetOre"
                      type="number"
                      step="any"
                      min={0}
                      value={helper.wetOreInputTons}
                      onChange={(e) => setHelperField("wetOreInputTons", e.target.value)}
                      className={NUMBER_INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="helperMoisture" className={LABEL_CLASS}>
                      Kadar air (%)
                    </label>
                    <input
                      id="helperMoisture"
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      value={helper.moistureContentPercent}
                      onChange={(e) => setHelperField("moistureContentPercent", e.target.value)}
                      className={NUMBER_INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="helperNickelGrade" className={LABEL_CLASS}>
                      Kadar nikel bijih (%)
                    </label>
                    <input
                      id="helperNickelGrade"
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      value={helper.nickelGradePercent}
                      onChange={(e) => setHelperField("nickelGradePercent", e.target.value)}
                      className={NUMBER_INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="helperBiocoke" className={LABEL_CLASS}>
                      Reduktan biocoke (%)
                    </label>
                    <input
                      id="helperBiocoke"
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      value={helper.reductantBiocokePercent}
                      onChange={(e) => setHelperField("reductantBiocokePercent", e.target.value)}
                      className={NUMBER_INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="helperCaptiveCoal" className={LABEL_CLASS}>
                      Bauran daya -- captive coal (%)
                    </label>
                    <input
                      id="helperCaptiveCoal"
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      value={helper.powerMixCaptiveCoalPercent}
                      onChange={(e) =>
                        setHelperField("powerMixCaptiveCoalPercent", e.target.value)
                      }
                      className={NUMBER_INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="helperHydroGrid" className={LABEL_CLASS}>
                      Bauran daya -- hidro/grid (%)
                    </label>
                    <input
                      id="helperHydroGrid"
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      value={helper.powerMixHydroGridPercent}
                      onChange={(e) => setHelperField("powerMixHydroGridPercent", e.target.value)}
                      className={NUMBER_INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="helperReductionTarget" className={LABEL_CLASS}>
                      Target penurunan dari baseline (%)
                    </label>
                    <input
                      id="helperReductionTarget"
                      type="number"
                      step="any"
                      min={0}
                      max={99.9}
                      value={helper.reductionTargetPercent}
                      onChange={(e) => setHelperField("reductionTargetPercent", e.target.value)}
                      className={NUMBER_INPUT_CLASS}
                    />
                  </div>
                </div>

                {helper.error && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {helper.error}
                  </p>
                )}
                {helper.baselineTco2e !== null && !helper.error && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Baseline interval ini: {helper.baselineTco2e.toFixed(2)} tCO₂e.
                  </p>
                )}

                <button
                  type="button"
                  disabled={helper.pending}
                  onClick={handleCalculateCap}
                  className="self-start rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
                >
                  {helper.pending ? "Menghitung..." : "Hitung"}
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={LABEL_CLASS}>Unggah dokumen spesifikasi situs (opsional)</span>
            <UploadDropzone
              profile="site_spec"
              fieldLabels={SITE_SPEC_FIELD_LABELS}
              onAccept={handleAcceptCandidate}
            />
          </div>

          {submitError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {submitting ? "Menyimpan..." : "Simpan dan lanjutkan"}
          </button>
        </form>
      </div>
    </div>
  );
}
