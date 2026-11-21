/**
 * The model the app ships. current.json is the one place that names it: the
 * web app imports it here and the Python scripts read it through
 * big2_ai/models/current.py.
 */
import current from "./current.json";

export const MODEL: string = current.model;
export const PARENT_MODEL: string = current.parent;
export const MODEL_URLS = { manifest: `/model/${MODEL}.json`, weights: `/model/${MODEL}.bin` };
