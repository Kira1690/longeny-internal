/**
 * Score-validation cases (P-W8-2) — lab panels a clinician scores by hand, to
 * set beside the engine's score.
 *
 * Chosen to find where the engine could mislead, not to agree with it: a
 * single out-of-range value hidden by several optimal ones, a pillar with one
 * marker carrying a whole score, a unit mismatch that silently drops the worst
 * value, a panel that is all borderline.
 */
export interface ValidationCase {
  id: string;
  about: string;
  readings: { code: string; value: number; unit: string }[];
}

export const VALIDATION_CASES: ValidationCase[] = [
  {
    id: 'sv-01',
    about: 'Everything optimal',
    readings: [
      { code: 'hba1c', value: 5.0, unit: '%' },
      { code: 'ldl_c', value: 85, unit: 'mg/dL' },
      { code: 'hdl_c', value: 65, unit: 'mg/dL' },
      { code: 'vitamin_d', value: 45, unit: 'ng/mL' },
    ],
  },
  {
    id: 'sv-02',
    about: 'Prediabetic HbA1c hidden among good lipids',
    readings: [
      { code: 'hba1c', value: 6.2, unit: '%' },
      { code: 'ldl_c', value: 80, unit: 'mg/dL' },
      { code: 'triglycerides', value: 90, unit: 'mg/dL' },
      { code: 'fasting_glucose', value: 88, unit: 'mg/dL' },
    ],
  },
  {
    id: 'sv-03',
    about: 'Severe vitamin D deficiency — environment pillar rests on one marker',
    readings: [
      { code: 'vitamin_d', value: 6, unit: 'ng/mL' },
      { code: 'hba1c', value: 5.1, unit: '%' },
    ],
  },
  {
    id: 'sv-04',
    about: 'Very high triglycerides scored the same as mildly high',
    readings: [
      { code: 'triglycerides', value: 620, unit: 'mg/dL' },
      { code: 'hba1c', value: 5.3, unit: '%' },
    ],
  },
  {
    id: 'sv-05',
    about: 'Worst value in the wrong unit is dropped from the score',
    readings: [
      { code: 'fasting_glucose', value: 7.8, unit: 'mmol/L' },
      { code: 'hba1c', value: 5.4, unit: '%' },
    ],
  },
  {
    id: 'sv-06',
    about: 'Everything borderline normal',
    readings: [
      { code: 'hba1c', value: 5.5, unit: '%' },
      { code: 'fasting_glucose', value: 97, unit: 'mg/dL' },
      { code: 'ldl_c', value: 125, unit: 'mg/dL' },
      { code: 'hdl_c', value: 42, unit: 'mg/dL' },
      { code: 'tsh', value: 3.8, unit: 'mIU/L' },
    ],
  },
  {
    id: 'sv-07',
    about: 'Low HDL is the only abnormal value',
    readings: [
      { code: 'hdl_c', value: 31, unit: 'mg/dL' },
      { code: 'ldl_c', value: 95, unit: 'mg/dL' },
      { code: 'hba1c', value: 5.0, unit: '%' },
    ],
  },
  {
    id: 'sv-08',
    about: 'Overt hypothyroid TSH',
    readings: [
      { code: 'tsh', value: 11.5, unit: 'mIU/L' },
      { code: 'hba1c', value: 5.2, unit: '%' },
    ],
  },
  {
    id: 'sv-09',
    about: 'Only one marker at all',
    readings: [{ code: 'ldl_c', value: 190, unit: 'mg/dL' }],
  },
  {
    id: 'sv-10',
    about: 'Metabolic syndrome pattern',
    readings: [
      { code: 'hba1c', value: 6.0, unit: '%' },
      { code: 'fasting_glucose', value: 118, unit: 'mg/dL' },
      { code: 'triglycerides', value: 240, unit: 'mg/dL' },
      { code: 'hdl_c', value: 34, unit: 'mg/dL' },
      { code: 'ldl_c', value: 150, unit: 'mg/dL' },
    ],
  },
];
