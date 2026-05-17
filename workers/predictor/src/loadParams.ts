import type { PrizeType, PredictParams } from "./types";

/**
 * Fetch tuned hyperparameters from D1 for a given prize type.
 * Returns undefined if no row exists or the JSON is malformed — predict()
 * will then use DEFAULT_PARAMS.
 */
export async function loadModelParams(
  db: D1Database,
  prizeType: PrizeType,
): Promise<PredictParams | undefined> {
  const row = await db
    .prepare("SELECT params_json FROM model_params WHERE prize_type = ?")
    .bind(prizeType)
    .first<{ params_json: string }>();
  if (!row?.params_json) return undefined;
  try {
    return JSON.parse(row.params_json) as PredictParams;
  } catch {
    return undefined;
  }
}
