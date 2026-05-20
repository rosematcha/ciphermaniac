// Folder key for the rolling online-meta aggregate. Matches the upstream
// `reports/{name}/` path on R2 exactly, so it doubles as a tournament-list
// entry and a fetch path.
export const ONLINE_META_NAME = 'Online - Last 14 Days';

// Display label for the online meta. The hyphen→em-dash swap is cosmetic;
// the storage key still uses the plain dash above.
export const ONLINE_META_LABEL = 'Online — Last 14 Days';
