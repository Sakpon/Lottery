import type { HistoricalNumber, Prediction, PrizeType, PredictParams } from "./types";
import { frequencyModel } from "./models/frequency";
import { gapModel } from "./models/gap";
import { markovModel } from "./models/markov";
import { digitPositionModel } from "./models/digitPosition";
import { ensemble } from "./models/ensemble";

export type { HistoricalNumber, Prediction, PrizeType, PredictParams };

/** Defaults — used when no tuned params have been written to `model_params`. */
export const DEFAULT_PARAMS: Required<{
  frequency: { windowSize: number; halfLife: number };
  digitPosition: { windowSize: number };
  weights: { frequency: number; gap: number; markov: number; digit_position: number };
}> = {
  frequency: { windowSize: 60, halfLife: 30 },
  digitPosition: { windowSize: 120 },
  weights: { frequency: 0.35, gap: 0.20, markov: 0.20, digit_position: 0.25 },
};

/**
 * เรียกใช้โมเดลทั้งหมดและรวมผลเป็น ensemble
 * เลือก strategy ตามประเภทรางวัล: เลข 2 ตัว ใช้ Markov + gap + freq; 3 ตัว ใช้ digit-pos + gap + freq
 *
 * `params` is optional — pass tuned hyperparameters loaded from the
 * model_params table to override defaults. Each field falls back independently.
 */
export function predict(
  history: HistoricalNumber[],
  prizeType: PrizeType,
  topK = 10,
  params?: PredictParams,
): { models: Record<string, Prediction[]>; ensemble: Prediction[] } {
  const fWin = params?.frequency?.windowSize ?? DEFAULT_PARAMS.frequency.windowSize;
  const fHalf = params?.frequency?.halfLife ?? DEFAULT_PARAMS.frequency.halfLife;
  const dpWin = params?.digitPosition?.windowSize ?? DEFAULT_PARAMS.digitPosition.windowSize;
  const w = {
    frequency: params?.weights?.frequency ?? DEFAULT_PARAMS.weights.frequency,
    gap: params?.weights?.gap ?? DEFAULT_PARAMS.weights.gap,
    markov: params?.weights?.markov ?? DEFAULT_PARAMS.weights.markov,
    digit_position: params?.weights?.digit_position ?? DEFAULT_PARAMS.weights.digit_position,
  };

  const freq = frequencyModel(history, { topK, windowSize: fWin, halfLife: fHalf });
  const gap = gapModel(history, { topK });
  const markov = prizeType === "last_two" ? markovModel(history, { topK }) : [];
  const digitPos = prizeType !== "last_two"
    ? digitPositionModel(history, { topK, windowSize: dpWin })
    : [];

  const inputs = [
    { predictions: freq, weight: w.frequency },
    { predictions: gap, weight: w.gap },
    { predictions: markov, weight: w.markov },
    { predictions: digitPos, weight: w.digit_position },
  ].filter((x) => x.predictions.length > 0);

  const combined = ensemble(inputs, { topK });

  return {
    models: {
      frequency: freq,
      gap,
      markov,
      digit_position: digitPos,
    },
    ensemble: combined,
  };
}
