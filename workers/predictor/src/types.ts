export type PrizeType =
  | "first"
  | "first_near"
  | "front_three"
  | "last_three"
  | "last_two";

export interface HistoricalNumber {
  drawDate: string;   // ISO YYYY-MM-DD
  prizeType: PrizeType;
  number: string;
  position: number;
}

export interface Prediction {
  number: string;
  score: number;      // 0..1
  rank: number;
  model: string;
  reason?: string;    // สำหรับแสดงใน UI ว่าทำไมเลขนี้ถูกเลือก
}

/** Tunable hyperparameters per prize type — populated by the tuner workflow,
 * read by the predictor at request time. Missing fields fall back to defaults
 * baked into predict(). */
export interface PredictParams {
  frequency?: { windowSize?: number; halfLife?: number };
  digitPosition?: { windowSize?: number };
  /** Ensemble weights — relative, will be re-normalized after empty models are dropped. */
  weights?: {
    frequency?: number;
    gap?: number;
    markov?: number;
    digit_position?: number;
  };
}
