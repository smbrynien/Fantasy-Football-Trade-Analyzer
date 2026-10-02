// Version constants shared by browser and Node.
// MODEL version lives in config/model.json (model_version) so formula changes are tracked with their parameters.
export const APP_VERSION = '1.0.0';
// Bump when the shape of data/normalized/*.json envelopes changes. Readers must handle older versions (see js/core/schema.js migrate*).
export const NORMALIZED_SCHEMA_VERSION = 1;
// Bump when the shape of data/calculated/dataset.json changes.
export const DATASET_SCHEMA_VERSION = 1;
