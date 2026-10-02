// Version constants shared by browser and Node.
// MODEL version lives in config/model.json (model_version) so formula changes are tracked with their parameters.
export const APP_VERSION = '1.0.0';
// Schema versions are WRITTEN into every normalized envelope (server/sync-engine.js, server/import-service.js) and into
// dataset.json (server/dataset-builder.js). Nothing reads them back yet and no migration code exists: when you bump
// one, add handling for the older shape to its readers in the same change (or force a rebuild), since files written
// by an older version stay on users' disks.
// Bump when the shape of data/normalized/*.json envelopes changes.
export const NORMALIZED_SCHEMA_VERSION = 1;
// Bump when the shape of data/calculated/dataset.json changes.
export const DATASET_SCHEMA_VERSION = 1;
