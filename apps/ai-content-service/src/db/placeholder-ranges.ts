/**
 * Placeholder reference ranges — test values, not clinical ones.
 *
 * One list, used by the dev seed and by the score-validation sheet, so the
 * numbers a clinician is shown next to a score are the numbers that produced
 * it. Replaced by clinically reviewed ranges; never edited into looking real.
 */
export const PLACEHOLDER_SOURCE =
  'PLACEHOLDER — not clinically reviewed; replace before clinical use';

export interface PlaceholderRange {
  code: string;
  name: string;
  unit: string;
  pillar: 'nutrition' | 'movement' | 'sleep' | 'stress' | 'environment';
  nLow: number | null;
  nHigh: number | null;
  oLow: number | null;
  oHigh: number | null;
}

export const PLACEHOLDER_RANGES: PlaceholderRange[] = [
  {
    code: 'hba1c',
    name: 'HbA1c',
    unit: '%',
    pillar: 'nutrition',
    nLow: 4.0,
    nHigh: 5.6,
    oLow: 4.5,
    oHigh: 5.2,
  },
  {
    code: 'fasting_glucose',
    name: 'Fasting glucose',
    unit: 'mg/dL',
    pillar: 'nutrition',
    nLow: 70,
    nHigh: 99,
    oLow: 75,
    oHigh: 90,
  },
  {
    code: 'ldl_c',
    name: 'LDL cholesterol',
    unit: 'mg/dL',
    pillar: 'nutrition',
    nLow: null,
    nHigh: 130,
    oLow: null,
    oHigh: 100,
  },
  {
    code: 'hdl_c',
    name: 'HDL cholesterol',
    unit: 'mg/dL',
    pillar: 'movement',
    nLow: 40,
    nHigh: null,
    oLow: 60,
    oHigh: null,
  },
  {
    code: 'triglycerides',
    name: 'Triglycerides',
    unit: 'mg/dL',
    pillar: 'nutrition',
    nLow: null,
    nHigh: 150,
    oLow: null,
    oHigh: 100,
  },
  {
    code: 'vitamin_d',
    name: 'Vitamin D (25-OH)',
    unit: 'ng/mL',
    pillar: 'environment',
    nLow: 20,
    nHigh: 100,
    oLow: 30,
    oHigh: 60,
  },
  {
    code: 'tsh',
    name: 'TSH',
    unit: 'mIU/L',
    pillar: 'stress',
    nLow: 0.4,
    nHigh: 4.0,
    oLow: 1.0,
    oHigh: 2.5,
  },
];
